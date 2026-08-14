/**
 * Browser-side terminal controller: one WebSocket to `/terminal` per page and
 * the routing table between host PTY output and per-terminal callbacks. It owns
 * no rendering — xterm.js instances live in `TerminalView` and register their
 * callbacks here.
 */

/** Callbacks one `TerminalView` registers for its terminal id. */
export interface TerminalHandlers {
  onOutput(data: string): void
  onExit(exitCode: number | null): void
  onError(message: string): void
}

/** Host → client message vocabulary. */
interface HostMessage {
  type: 'data' | 'exit' | 'error'
  terminalId: string
  data?: string
  exitCode?: number | null
  message?: string
}

export class TerminalController {
  private socket: WebSocket | null = null
  private readonly handlers = new Map<string, TerminalHandlers>()
  private readonly outbox: string[] = []

  /** Open (or reuse) the page's terminal socket, flushing queued sends on open. */
  private connect(): WebSocket {
    if (this.socket !== null) return this.socket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/terminal`)
    socket.addEventListener('open', () => {
      for (const message of this.outbox) socket.send(message)
      this.outbox.length = 0
    })
    socket.addEventListener('message', (event) => { this.onMessage(event) })
    socket.addEventListener('close', () => { this.socket = null })
    this.socket = socket
    return socket
  }

  /** Send once the socket is OPEN; queue while it is still connecting. */
  private send(message: unknown): void {
    const socket = this.connect()
    const encoded = JSON.stringify(message)
    if (socket.readyState === WebSocket.OPEN) socket.send(encoded)
    else this.outbox.push(encoded)
  }

  /**
   * Ask the host to spawn a shell and return its globally-unique local id.
   * Display numbering is the per-session store's concern (`addTerminal`), not
   * this page-global controller's: a shared counter here would leak across
   * sessions and never recycle freed numbers.
   */
  create(cols: number, rows: number, cwd?: string): string {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    this.send({
      type: 'create',
      terminalId: id,
      cols,
      rows,
      ...(cwd !== undefined && cwd !== '' ? { cwd } : {}),
    })
    return id
  }

  /** Forward keystrokes to the host PTY. */
  write(id: string, data: string): void {
    this.send({ type: 'input', terminalId: id, data })
  }

  /** Forward a terminal geometry change to the host PTY. */
  resize(id: string, cols: number, rows: number): void {
    this.send({ type: 'resize', terminalId: id, cols, rows })
  }

  /** Close one host PTY (idempotent — the exit frame deletes it too). */
  close(id: string): void {
    this.send({ type: 'close', terminalId: id })
  }

  /** Register a terminal's callbacks; returns the unsubscriber. */
  subscribe(id: string, handlers: TerminalHandlers): () => void {
    this.handlers.set(id, handlers)
    return () => { this.handlers.delete(id) }
  }

  private onMessage(event: MessageEvent): void {
    let message: HostMessage
    try {
      message = JSON.parse(String(event.data)) as HostMessage
    } catch (_malformed) {
      return
    }
    const handlers = this.handlers.get(message.terminalId)
    if (handlers === undefined) return
    if (message.type === 'data' && message.data !== undefined) handlers.onOutput(message.data)
    else if (message.type === 'exit') handlers.onExit(message.exitCode ?? null)
    else if (message.type === 'error') handlers.onError(message.message ?? 'terminal error')
  }
}

