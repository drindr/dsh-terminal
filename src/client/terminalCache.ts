/**
 * Page-global cache of live xterm.js instances, keyed by terminal id.
 *
 * `TerminalView` used to own the `Terminal` it rendered: every panel unmount
 * (session switch, panel close, active-terminal switch) disposed the xterm
 * instance and its whole scrollback, and the host PTY's output in between was
 * dropped while no handlers were registered. Re-mounting then showed an empty
 * terminal attached to a long-running shell — content went inconsistent with
 * what the session actually did.
 *
 * This cache moves instance ownership out of the view: a terminal is created
 * once, subscribes to the controller once (so output keeps accumulating in the
 * buffer while detached), and views only attach/detach its DOM element. Entries
 * die on host exit/error or when the panel explicitly closes the terminal.
 */
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { TerminalHandlers } from './controller.ts'

/** Controller-facing wiring a cached terminal needs at creation time. */
export interface TerminalWiring {
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  subscribe(id: string, handlers: TerminalHandlers): () => void
  /** Store hook: drop the terminal's row (host exit/error or panel close). */
  onExit(id: string): void
}

export interface CachedTerminal {
  terminal: Terminal
  fit: FitAddon
}

interface CacheEntry extends CachedTerminal {
  dispose(): void
}

const cache = new Map<string, CacheEntry>()

/**
 * Return the live terminal for `id`, creating it (and its controller
 * subscription) on first use. The wiring of the first call sticks for the
 * entry's lifetime — terminal ids are page-unique, so later mounts of the
 * same id carry equivalent closures.
 */
export function acquireTerminal(id: string, wiring: TerminalWiring): CachedTerminal {
  const existing = cache.get(id)
  if (existing !== undefined) return existing

  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'Consolas, "Cascadia Mono", Menlo, monospace',
    theme: { background: 'transparent' },
    scrollback: 2000,
  })
  const fit = new FitAddon()
  terminal.loadAddon(fit)

  const onData = terminal.onData((data) => { wiring.write(id, data) })
  const onResize = terminal.onResize(({ cols, rows }) => { wiring.resize(id, cols, rows) })
  const unsubscribe = wiring.subscribe(id, {
    onOutput: (data) => { terminal.write(data) },
    onExit: () => { disposeTerminal(id); wiring.onExit(id) },
    onError: () => { disposeTerminal(id); wiring.onExit(id) },
  })

  cache.set(id, {
    terminal,
    fit,
    dispose: () => {
      unsubscribe()
      onResize.dispose()
      onData.dispose()
      terminal.dispose()
    },
  })
  return { terminal, fit }
}

/**
 * Destroy the cached terminal for `id` (unsubscribe + dispose). Idempotent.
 * Called from the exit/error frames and from the panel's close action, whose
 * trailing host exit frame then finds no handlers and is dropped.
 */
export function disposeTerminal(id: string): void {
  const entry = cache.get(id)
  if (entry === undefined) return
  cache.delete(id)
  entry.dispose()
}
