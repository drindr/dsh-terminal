/**
 * Client-side terminal store: per-session viewing state shared by the panel
 * (`conversation.composer.dock`) and the toggle button
 * (`conversation.input.right`). Live terminal processes are NOT store data —
 * they live in the controller's WebSocket, keyed by terminal id.
 */
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Store-facing metadata for one terminal row. Exited terminals are removed, never marked. */
export interface TerminalMeta {
  id: string
  title: string
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
      addTerminal: (d, meta: TerminalMeta) => { d.terminals.push(meta); d.activeId = meta.id },
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
