/**
 * dsh-terminal browser half: mounts the terminal panel under the composer
 * (`conversation.composer.dock`) and the toggle button in the composer tool
 * row (`conversation.input.right`), sharing one per-session store.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TerminalController } from './controller.ts'
import { createTerminalStore } from './store.ts'
import { installStyles, removeStyles } from './styles.ts'
import { TerminalPanel, type TerminalPanelInjected } from './TerminalPanel.tsx'
import { TerminalToggleButton } from './TerminalToggleButton.tsx'

/** Required services for slot registration. */
export const inject = ['slots']

/** Mounts the browser half.
 * @param ctx - Client Cordis context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new TerminalController()
  const store = createTerminalStore()

  ctx.effect(() => {
    installStyles()
    return () => { removeStyles() }
  }, 'dsh-terminal: styles')

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'terminal',
    order: 100,
    store,
    inject: (_sessionId, actions): TerminalPanelInjected => ({
      newTerminal: (cwd) => {
        const created = controller.create(80, 24, cwd)
        actions.addTerminal({ id: created.id, title: created.title })
        return created.id
      },
      write: (id, data) => { controller.write(id, data) },
      resize: (id, cols, rows) => { controller.resize(id, cols, rows) },
      closeTerminal: (id) => { controller.close(id); actions.removeTerminal(id) },
      subscribe: (id, handlers) => controller.subscribe(id, handlers),
    }),
  }, TerminalPanel))

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'terminal',
    order: 100,
    store,
  }, TerminalToggleButton))
}
