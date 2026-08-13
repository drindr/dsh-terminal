/** Injects the xterm.js stylesheet and the panel stylesheet exactly once. */
import xtermCss from '@xterm/xterm/css/xterm.css'
import panelCss from './styles.css'

const STYLES: ReadonlyArray<readonly [id: string, css: string]> = [
  ['xterm', xtermCss],
  ['panel', panelCss],
]

/** Install owned `<style>` tags; idempotent under re-evaluation. */
export function installStyles(): void {
  for (const [id, css] of STYLES) {
    const key = `dsh-terminal:${id}`
    if (document.querySelector(`style[data-dsh-terminal="${key}"]`) !== null) continue
    const tag = document.createElement('style')
    tag.dataset.dshTerminal = key
    tag.textContent = css
    document.head.appendChild(tag)
  }
}

/** Remove every style tag this plugin installed. */
export function removeStyles(): void {
  document.querySelectorAll('style[data-dsh-terminal]').forEach(tag => tag.remove())
}
