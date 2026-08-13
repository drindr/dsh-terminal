/** Tool-row button beside the context meter that toggles the terminal panel. */
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { TerminalStore } from './store.ts'

export type TerminalToggleButtonProps =
  PropsRuntime<'conversation.input.right'> & PropsStore<TerminalStore>

export function TerminalToggleButton({ useStore, actions }: TerminalToggleButtonProps) {
  const open = useStore(state => state.open)
  const label = open ? '收起终端' : '打开终端'
  return (
    <button
      type="button"
      className="dsh-terminal-toggle"
      aria-label={label}
      aria-pressed={open}
      title={`${label}（Ctrl+\`）`}
      onClick={() => { actions.toggle() }}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4 5.5l3 2.5-3 2.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9.5 10.5h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </button>
  )
}
