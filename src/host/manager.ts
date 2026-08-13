/**
 * Host-side PTY manager for the terminal plugin. One `node-pty` shell per
 * browser terminal id; a WebSocket owns its terminals and tears them all down
 * when the socket closes (page unload / tab close).
 *
 * The shell choice is a deployment fact, not a product tunable: `powershell.exe`
 * on Windows (always present, matches node-pty's ConPTY default), otherwise the
 * ambient login shell. `DSH_TERMINAL_SHELL` overrides for local experimentation.
 */
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

function defaultShell(): string {
  const override = process.env.DSH_TERMINAL_SHELL
  if (override !== undefined && override !== '') return override
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL !== undefined && process.env.SHELL !== '' ? process.env.SHELL : 'bash'
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
    try {
      const pty = spawn(defaultShell(), [], {
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
