/**
 * Client-side terminal store: per-session viewing state shared by the panel
 * (`conversation.input.dock`) and the toggle button
 * (`conversation.input.right`). Live terminal processes are NOT store data —
 * they live in the controller's WebSocket, keyed by terminal id.
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'

/** Store-facing metadata for one terminal row. Exited terminals are removed, never marked. */
export interface TerminalMeta {
  id: string
  title: string
  /** Session-local display number (1, 2, …); recycled when a row closes. */
  number: number
}

interface TerminalStoreState {
  open: boolean
  height: number
  terminals: TerminalMeta[]
  activeId: string | null
}

/** Shared per-session store handle, created once in `apply`. */
export function createTerminalStore() {
  return defineStore({
    init: (): TerminalStoreState => ({ open: false, height: 300, terminals: [], activeId: null }),
    actions: {
      toggle: (d) => { d.open = !d.open },
      openPanel: (d) => { d.open = true },
      closePanel: (d) => { d.open = false },
      setHeight: (d, height: number) => { d.height = height },
      /**
       * Add a terminal row, numbering it inside this session's list: the
       * smallest positive integer no other open terminal in this session uses,
       * so closing terminal N frees N for the next creation. Store instances
       * are session-scoped (`conversation.input.dock` declares
       * `scope: 'session'`), which restarts numbering per session.
       */
      addTerminal: (d, id: string) => {
        const used = new Set(d.terminals.map(terminal => terminal.number))
        let number = 1
        while (used.has(number)) number += 1
        d.terminals.push({ id, title: `终端 ${number}`, number })
        d.activeId = id
      },
      removeTerminal: (d, id: string) => {
        d.terminals = d.terminals.filter(terminal => terminal.id !== id)
        if (d.activeId === id) d.activeId = d.terminals[0]?.id ?? null
      },
      setActive: (d, id: string) => { d.activeId = id },
    },
  })
}

/** The handle type the panel/button registrations declare as their `store`. */
export type TerminalStore = ReturnType<typeof createTerminalStore>
