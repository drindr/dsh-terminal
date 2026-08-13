/**
 * dsh-terminal host half: mounts the `/terminal` WebSocket upgrade route on the
 * web server and owns every terminal process behind it. The browser half ships
 * via `exports["./client"]`, discovered through the package.json `dsh.client`
 * declaration. This plugin carries no agent-loop surface — it only extends the
 * GUI transport.
 */
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'
import type { Context } from '@deepseek-ai/cordis'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { TerminalManager } from './host/manager.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServer
  }
}

/** The exact upgrade pathname the browser half connects to. */
export const TERMINAL_UPGRADE_PATH = '/terminal'

/** Required services for route registration. */
export const inject = ['webServer']

/**
 * Host plugin body: register the WebSocket route and tear down all terminals
 * when the fiber disposes (update / shutdown).
 * @param ctx - Cordis context carrying the web server service.
 */
export function apply(ctx: Context): void {
  const manager = new TerminalManager()
  const server = new WebSocketServer({ noServer: true })

  const disposeRoute = ctx.webServer.registerUpgrade({
    path: TERMINAL_UPGRADE_PATH,
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!trusted(req)) {
        socket.destroy()
        return
      }
      server.handleUpgrade(req, socket, head, (ws) => { manager.attach(ws) })
    },
  })

  ctx.effect(() => () => {
    disposeRoute()
    for (const client of server.clients) client.terminate()
    server.close()
  }, 'dsh-terminal teardown')
}

/**
 * Minimal same-origin fence for the terminal upgrade, mirroring the connection
 * plugin's `isTrustedApiRequest` posture: reject an explicit cross-site browser
 * marker, then require any attached Origin to equal the request authority. The
 * web server already binds loopback by default; this closes the confused-deputy
 * upgrade path without importing the connection package's full trust module.
 * @param req - upgrade request.
 * @returns true when the request may proceed.
 */
function trusted(req: IncomingMessage): boolean {
  if (header(req.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(req.headers, 'origin')
  if (origin === undefined) return true
  const host = header(req.headers, 'host')
  if (host === undefined) return false
  try {
    return new URL(origin).host === new URL(`http://${host}`).host
  } catch (_malformed) {
    return false
  }
}

function header(headers: IncomingMessage['headers'], name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}
