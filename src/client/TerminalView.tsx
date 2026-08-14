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

    // Register the geometry listener BEFORE the first fit: the mount-time fit()
    // fires onResize synchronously, and only a registered listener forwards it.
    const onData = terminal.onData((data) => { write(terminalId, data) })
    const onResize = terminal.onResize(({ cols, rows }) => { resize(terminalId, cols, rows) })
    const unsubscribe = subscribe(terminalId, {
      onOutput: (data) => { terminal.write(data) },
      onExit: () => { onExit(terminalId) },
      onError: () => { onExit(terminalId) },
    })

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
      unsubscribe()
      onResize.dispose()
      onData.dispose()
      terminal.dispose()
    }
  }, [terminalId, write, resize, subscribe, onExit])

  return <div ref={containerRef} className="dsh-terminal-view" />
}
