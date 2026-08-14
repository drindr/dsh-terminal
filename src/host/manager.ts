/**
 * Host-side PTY manager for the terminal plugin. One `node-pty` shell per
 * browser terminal id; a WebSocket owns its terminals and tears them all down
 * when the socket closes (page unload / tab close).
 *
 * The shell choice is a deployment fact, not a product tunable: on Windows we
 * prefer PowerShell 7 (`pwsh`) whenever it is installed and fall back to the
 * always-present Windows PowerShell 5.1 (`powershell.exe`) bootstrapped into
 * UTF-8 mode; everywhere else we use the ambient login shell.
 * `DSH_TERMINAL_SHELL` overrides for local experimentation.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn, type IPty } from 'node-pty'
import type { WebSocket } from 'ws'

interface TerminalSession {
  readonly pty: IPty
  dispose(): void
}

/** Client → host message vocabulary. */
interface Inbound {
  type: 'create' | 'input' | 'resize' | 'close'
  terminalId?: string
  data?: string
  cols?: number
  rows?: number
  cwd?: string
}

interface ShellCommand {
  file: string
  args: string[]
}

/**
 * UTF-8 bootstrap for the Windows PowerShell 5.1 fallback (see `windowsShell`).
 *
 * Makes the two things that produce CJK mojibake under a Chinese locale work:
 * - `Get-Content` (the `cat` alias) reads BOM-less files with the ANSI code
 *   page (CP936/GBK) by default, decoding UTF-8 bytes into garble like
 *   `使用用户所用的语言回复` → `浣跨敤鐢ㄦ埛…`. Pin its default Encoding to
 *   UTF-8 so `cat` of UTF-8 agent presets/yaml/json renders correctly.
 * - Cmdlet and external-program output is (re)encoded per the console code
 *   page; forcing `$OutputEncoding` and `[Console]::OutputEncoding` to UTF-8
 *   keeps whatever reaches the ConPTY side UTF-8.
 */
const POWERSHELL_51_UTF8_BOOTSTRAP = [
  '-NoExit',
  '-Command',
  '$PSDefaultParameterValues[\'Get-Content:Encoding\']=\'UTF8\';'
    + '$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8',
]

function defaultShell(): ShellCommand {
  const override = process.env.DSH_TERMINAL_SHELL
  if (override !== undefined && override !== '') return { file: override, args: [] }
  if (process.platform === 'win32') return windowsShell()
  const ambient = process.env.SHELL !== undefined && process.env.SHELL !== '' ? process.env.SHELL : 'bash'
  return { file: ambient, args: [] }
}

/**
 * Windows shell selection.
 *
 * PowerShell 7 (`pwsh`) is preferred whenever it is installed: it reads files
 * as UTF-8 and writes UTF-8 to the console by default, so Chinese text in file
 * output arrives intact. Windows PowerShell 5.1 instead decodes BOM-less files
 * with the ANSI code page (CP936 on a Chinese locale) and re-encodes console
 * output through the same page, garbling CJK (`cat` of a UTF-8 preset yaml).
 *
 * Without pwsh we keep `powershell.exe` (always present, matches node-pty's
 * ConPTY default) but spawn it with `POWERSHELL_51_UTF8_BOOTSTRAP` so its
 * defaults stop garbling CJK. `DSH_TERMINAL_SHELL` skips both paths entirely.
 */
function windowsShell(): ShellCommand {
  // 1. PowerShell 7 from its standard install roots, then PATH.
  const roots = [
    process.env.ProgramFiles ?? 'C:\\Program Files',
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
  ]
  for (const root of roots) {
    const pwsh = path.join(root, 'PowerShell', '7', 'pwsh.exe')
    if (existsSync(pwsh)) return { file: pwsh, args: ['-NoLogo'] }
  }
  if (onPath('pwsh')) return { file: 'pwsh', args: ['-NoLogo'] }

  // 2. Windows PowerShell 5.1 fallback, bootstrapped into UTF-8 mode.
  return { file: 'powershell.exe', args: POWERSHELL_51_UTF8_BOOTSTRAP }
}

/**
 * True when `name` can resolve to an executable on PATH (PATHEXT-aware).
 * node-pty spawns `pwsh` by PATH, but `existsSync` itself does not probe PATH
 * or apply PATHEXT, so this is checked before falling through to the 5.1 shell.
 */
function onPath(name: string): boolean {
  const dirs = (process.env.PATH ?? '').split(';').filter((dir) => dir !== '')
  const extensions = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').toLowerCase().split(';').filter((ext) => ext !== '')
  return dirs.some((dir) => extensions.some((ext) => existsSync(path.join(dir, name + ext))))
}

/** Track one socket's live shells, idempotently tearing them down on close. */
export class TerminalManager {
  private readonly terminals = new Map<WebSocket, Map<string, TerminalSession>>()

  /** Adopt one upgraded socket and own its terminal lifecycle. */
  attach(ws: WebSocket): void {
    ws.on('message', (raw) => { this.onMessage(ws, raw) })
    ws.once('close', () => { this.disposeSocket(ws) })
    // 'error' is followed by 'close'; swallow it so one bad socket cannot crash the host.
    ws.on('error', () => {})
  }

  private onMessage(ws: WebSocket, raw: WebSocket.RawData): void {
    let message: Inbound
    try {
      message = JSON.parse(raw.toString()) as Inbound
    } catch (_malformed) {
      return
    }
    switch (message.type) {
      case 'create': this.create(ws, message); break
      case 'input': this.write(ws, message); break
      case 'resize': this.resize(ws, message); break
      case 'close': this.close(ws, message); break
    }
  }

  private send(ws: WebSocket, message: Record<string, unknown>): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
  }

  private bySocket(ws: WebSocket): Map<string, TerminalSession> {
    const existing = this.terminals.get(ws)
    if (existing !== undefined) return existing
    const created = new Map<string, TerminalSession>()
    this.terminals.set(ws, created)
    return created
  }

  private create(ws: WebSocket, message: Inbound): void {
    const id = message.terminalId
    if (id === undefined) return
    const bySocket = this.bySocket(ws)
    if (bySocket.has(id)) return
    const cols = clamp(message.cols ?? 80, 2, 500)
    const rows = clamp(message.rows ?? 24, 1, 200)
    const shell = defaultShell()
    try {
      const pty = spawn(shell.file, shell.args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: message.cwd !== undefined && message.cwd !== '' ? message.cwd : process.cwd(),
        env: process.env as Record<string, string>,
      })
      const onData = pty.onData((data) => { this.send(ws, { type: 'data', terminalId: id, data }) })
      const onExit = pty.onExit(({ exitCode }) => {
        this.send(ws, { type: 'exit', terminalId: id, exitCode })
        bySocket.delete(id)
        onData.dispose()
        onExit.dispose()
      })
      bySocket.set(id, {
        pty,
        dispose: () => {
          onData.dispose()
          onExit.dispose()
          try { pty.kill() } catch (_alreadyExited) { /* exit callback is authoritative */ }
        },
      })
    } catch (error: unknown) {
      this.send(ws, { type: 'error', terminalId: id, message: error instanceof Error ? error.message : String(error) })
    }
  }

  private write(ws: WebSocket, message: Inbound): void {
    if (message.terminalId === undefined || message.data === undefined) return
    this.bySocket(ws).get(message.terminalId)?.pty.write(message.data)
  }

  private resize(ws: WebSocket, message: Inbound): void {
    if (message.terminalId === undefined) return
    const cols = clamp(message.cols ?? 80, 2, 500)
    const rows = clamp(message.rows ?? 24, 1, 200)
    this.bySocket(ws).get(message.terminalId)?.pty.resize(cols, rows)
  }

  private close(ws: WebSocket, message: Inbound): void {
    if (message.terminalId === undefined) return
    const bySocket = this.bySocket(ws)
    const session = bySocket.get(message.terminalId)
    if (session === undefined) return
    bySocket.delete(message.terminalId)
    session.dispose()
  }

  private disposeSocket(ws: WebSocket): void {
    const bySocket = this.terminals.get(ws)
    if (bySocket === undefined) return
    this.terminals.delete(ws)
    for (const session of bySocket.values()) session.dispose()
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

