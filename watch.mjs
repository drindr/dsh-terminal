/**
 * Dev watcher for the dsh-terminal plugin — the "hot reload" glue.
 *
 * Watches the source tree (`src/**`) and tsdown config, and re-runs the
 * same tsdown pipeline as `pnpm run build` on every change (debounced). The two
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
import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const TSDOWN = fileURLToPath(import.meta.resolve('tsdown/run'))
const WATCH_PATHS = ['src', 'tsdown.config.ts']

// A fresh process also reloads config edits, without caching imported modules.
function buildAll() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSDOWN], { cwd: ROOT, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`tsdown exited with ${signal ?? code}`))
    })
  })
}
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
    await buildAll()
    console.log(`[watch] rebuilt in ${Date.now() - started}ms — ${new Date().toLocaleTimeString()}`)
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
    // Watch the root directory for config replacements (editors often rename).
    const watcher = watch(new URL(path === 'src' ? 'src/' : './', import.meta.url), { recursive: path === 'src' })
    watcher.on('change', (_eventType, file) => {
      if (path === 'src' ? interested(file) : file === path) trigger(`${path}/${file}`)
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

console.log('[watch] dev watcher ready — HMR requires host and client watchers in dsh web.')
void run()
