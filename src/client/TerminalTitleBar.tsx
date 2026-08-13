/** Title bar: terminal selector (dropdown), new, close-current, close-panel. */
import type { TerminalMeta } from './store.ts'

interface TerminalTitleBarProps {
  terminals: TerminalMeta[]
  activeId: string | null
  onSelect(id: string): void
  onNew(): void
  onCloseCurrent(): void
  onClosePanel(): void
}

export function TerminalTitleBar({
  terminals, activeId, onSelect, onNew, onCloseCurrent, onClosePanel,
}: TerminalTitleBarProps) {
  return (
    <div className="dsh-terminal-titlebar">
      <select
        className="dsh-terminal-select"
        aria-label="选择终端"
        value={activeId ?? ''}
        onChange={(event) => { onSelect(event.target.value) }}
      >
        {terminals.map(terminal => (
          <option key={terminal.id} value={terminal.id}>
            {terminal.title}
          </option>
        ))}
      </select>
      <div className="dsh-terminal-spacer" />
      <button
        type="button"
        className="dsh-terminal-action"
        aria-label="新建终端"
        title="新建终端"
        onClick={onNew}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="dsh-terminal-action"
        aria-label="关闭当前终端"
        title="关闭当前终端"
        disabled={activeId === null}
        onClick={onCloseCurrent}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="dsh-terminal-action"
        aria-label="关闭面板"
        title="关闭面板"
        onClick={onClosePanel}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}
