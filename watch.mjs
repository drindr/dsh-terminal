/**
 * Dev watcher for the dsh-terminal plugin — the "hot reload" glue.
 *
 * Watches the source tree (`src/**`) and this build script, and re-runs the
 * exact build pipeline from `build.mjs` on every change (debounced). The two
 * HMR chains already mounted by the running `dsh web` instance then pick the
 * rebuilt artifacts up without a restart or a page refresh:
 *
 *  - `lib/index.js`  → cordis-plugin-hmr (host): reloads the `dsh-terminal`
 *    fiber when the bundle changes. Requires the profile's `hmr` row to watch
 *    this package's real path (see `~/.dsh/profiles/web/cordis.patch.yml`),
 *    because the row's default `ignored` list skips node_modules paths.
 *  - `lib/client.js` → dsh-client-hmr: polls the bundle, re-hashes it and
 *    broadcasts a `rebuilt` SSE frame; the browser half hot-swaps the module.
 *
 * Usage: `pnpm run dev` (or `node watch.mjs`).
 */
import { watch } from 'node:fs'
import { relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildAll } from './build.mjs'

const WATCH_PATHS = ['src', 'build.mjs']
const DEBOUNCE_MS = 100

let timer
let running = false
let queued = false

function trigger(reason) {
  console.log(`[watch] ${reason} — rebuilding…`)
  clearTimeout(timer)
  timer = setTimeout(run, DEBOUNCE_MS)
}

async function run() {
  if (running) {
    queued = true
    return
  }
  running = true
  const started = Date.now()
  try {
    const { host, client } = buildAll()
    const parts = [
      `host ${host ? 'changed' : 'unchanged'}`,
      `client ${client ? 'changed' : 'unchanged'}`,
    ]
    console.log(`[watch] rebuilt in ${Date.now() - started}ms (${parts.join(', ')}) — ${new Date().toLocaleTimeString()}`)
  } catch (error) {
    console.error('[watch] build failed:', error instanceof Error ? error.message : error)
  }
  running = false
  if (queued) {
    queued = false
    trigger('queued change')
  }
}

const interested = (file) =>
  file !== undefined &&
  /\.(ts|tsx|css|mjs)$/.test(file) &&
  !file.includes('lib/')

for (const path of WATCH_PATHS) {
  try {
    const watcher = watch(path, { recursive: path === 'src' })
    watcher.on('change', (_eventType, file) => {
      if (interested(file)) trigger(`${path}/${file}`)
    })
    watcher.on('error', (error) => {
      console.error(`[watch] watcher error on ${path}:`, error)
    })
    console.log(`[watch] watching ${path}/…`)
  } catch (error) {
    console.error(`[watch] cannot watch ${path}:`, error)
    process.exitCode = 1
  }
}

console.log('[watch] dev watcher ready — edit src/** and the plugin hot-reloads (host fiber + client bundle).')
