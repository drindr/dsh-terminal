/** One xterm.js instance bound to a host PTY, attached while visible. */
import { useEffect, useRef } from 'react'
import type { TerminalHandlers } from './controller.ts'
import { acquireTerminal } from './terminalCache.ts'

interface TerminalViewProps {
  terminalId: string
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  subscribe(id: string, handlers: TerminalHandlers): () => void
  onExit(id: string): void
}

/**
 * Attaches the cached xterm instance for `terminalId` to the DOM. The instance
 * itself (buffer, scrollback, controller subscription) lives in
 * `terminalCache` and survives unmounts, so switching sessions, closing the
 * panel, or switching the active terminal no longer wipes the content — this
 * effect only re-parents `terminal.element` and re-syncs the geometry.
 */
export function TerminalView({ terminalId, write, resize, subscribe, onExit }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

    const { terminal, fit } = acquireTerminal(terminalId, { write, resize, subscribe, onExit })

    // First attach opens the terminal into the live container; later attaches
    // re-parent the existing element (renderer, canvas, buffer all intact).
    if (terminal.element === null || terminal.element === undefined) terminal.open(container)
    else container.appendChild(terminal.element)

    // Fit the terminal to the panel and push the resulting geometry to the
    // host PTY. The PTY was spawned at the create-time default (80x24), so the
    // shell must learn the real panel size or long output (`cat` of a wide
    // file) keeps wrapping prematurely at column 80. fit() early-returns while
    // the first render has not measured its cell size yet, so retry on the next
    // frame and once the document fonts resolve; the ResizeObserver below
    // covers later panel/window size changes.
    let disposed = false
    const fitAndSync = (): void => {
      if (disposed) return
      try {
        fit.fit()
      } catch (_unmeasured) {
        // The panel is still sizing on first paint; a later retry refits.
      }
      if (terminal.cols > 0 && terminal.rows > 0) resize(terminalId, terminal.cols, terminal.rows)
    }
    fitAndSync()
    const frameId = requestAnimationFrame(fitAndSync)
    document.fonts.ready.then(() => fitAndSync()).catch(() => {})

    const observer = new ResizeObserver(fitAndSync)
    observer.observe(container)

    return () => {
      disposed = true
      cancelAnimationFrame(frameId)
      observer.disconnect()
      // Deliberately NOT disposing the terminal: the cache entry keeps the
      // buffer and the controller subscription alive for the next attach.
    }
  }, [terminalId, write, resize, subscribe, onExit])

  return <div ref={containerRef} className="dsh-terminal-view" />
}
