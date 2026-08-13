/** One xterm.js instance bound to a host PTY. */
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { TerminalHandlers } from './controller.ts'

interface TerminalViewProps {
  terminalId: string
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  subscribe(id: string, handlers: TerminalHandlers): () => void
  onExit(id: string): void
}

export function TerminalView({ terminalId, write, resize, subscribe, onExit }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Consolas, "Cascadia Mono", Menlo, monospace',
      theme: { background: 'transparent' },
      scrollback: 2000,
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container)
    try {
      fit.fit()
    } catch (_unmeasured) {
      // The panel is still sizing on first paint; the ResizeObserver refits.
    }

    const onData = terminal.onData((data) => { write(terminalId, data) })
    const onResize = terminal.onResize(({ cols, rows }) => { resize(terminalId, cols, rows) })
    const unsubscribe = subscribe(terminalId, {
      onOutput: (data) => { terminal.write(data) },
      onExit: () => { onExit(terminalId) },
      onError: () => { onExit(terminalId) },
    })

    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch (_unmeasured) {
        // Ignore transient zero-size measurements during the drag.
      }
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      unsubscribe()
      onResize.dispose()
      onData.dispose()
      terminal.dispose()
    }
  }, [terminalId, write, resize, subscribe, onExit])

  return <div ref={containerRef} className="dsh-terminal-view" />
}
