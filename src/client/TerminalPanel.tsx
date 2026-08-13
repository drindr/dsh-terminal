/** The resizable terminal panel docked under the composer card. */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { TerminalHandlers } from './controller.ts'
import type { TerminalStore } from './store.ts'
import { TerminalView } from './TerminalView.tsx'
import { TerminalTitleBar } from './TerminalTitleBar.tsx'

/** Registrant business face: controller operations wired to the store. */
export interface TerminalPanelInjected {
  /** Spawn a host PTY, add it to the store, and return its id. */
  newTerminal(): string
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  /** Kill the host PTY and drop its store row. */
  closeTerminal(id: string): void
  subscribe(id: string, handlers: TerminalHandlers): () => void
}

export type TerminalPanelProps =
  PropsRuntime<'conversation.composer.dock'> & PropsStore<TerminalStore> & TerminalPanelInjected

const MIN_HEIGHT = 120
const MAX_HEIGHT = 720

/** Whether the focused element consumes text (composer, select, textarea). */
function isTypingTarget(element: Element | null): boolean {
  if (element === null || !(element instanceof HTMLElement)) return false
  if (element.isContentEditable) return true
  const tag = element.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

export function TerminalPanel(props: TerminalPanelProps) {
  const { useStore, actions, newTerminal, write, resize, closeTerminal, subscribe } = props
  const open = useStore(state => state.open)
  const height = useStore(state => state.height)
  const terminals = useStore(state => state.terminals)
  const activeId = useStore(state => state.activeId)
  const heightRef = useRef(height)
  heightRef.current = height
  const wasOpenRef = useRef(false)

  // Auto-spawn only on the open transition (false → true) with no terminals;
  // when the last terminal disappears while the panel is already open, close
  // the panel instead of spawning a replacement.
  useEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = open
    if (!open || terminals.length > 0) return
    if (wasOpen) actions.closePanel()
    else newTerminal()
  }, [open, terminals.length, newTerminal, actions])

  // Global Ctrl+` toggles the panel while a session is current.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.key !== '`') return
      if (isTypingTarget(document.activeElement)) return
      event.preventDefault()
      actions.toggle()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [actions])

  if (!open) return null

  const active = terminals.find(terminal => terminal.id === activeId) ?? null

  const onDragStart = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const startY = event.clientY
    const startHeight = heightRef.current
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent): void => {
      actions.setHeight(clamp(startHeight + (startY - move.clientY)))
    }
    const onUp = (): void => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  return (
    <section className="dsh-terminal" style={{ height }}>
      <div className="dsh-terminal-drag" role="separator" aria-orientation="horizontal" onPointerDown={onDragStart} />
      <TerminalTitleBar
        terminals={terminals}
        activeId={activeId}
        onSelect={id => { actions.setActive(id) }}
        onNew={() => { newTerminal() }}
        onCloseCurrent={() => { if (active !== null) closeTerminal(active.id) }}
        onClosePanel={() => { actions.closePanel() }}
      />
      {active === null
        ? <div className="dsh-terminal-empty">无终端</div>
        : (
          <TerminalView
            terminalId={active.id}
            write={write}
            resize={resize}
            subscribe={subscribe}
            onExit={actions.removeTerminal}
          />
        )}
    </section>
  )
}

function clamp(value: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(value)))
}
