/**
 * Build script for the dsh-terminal plugin.
 *
 * Emits two artifacts from the source tree:
 *  - `lib/index.js`  — the Node/host half (ESM): registers the `/terminal`
 *    WebSocket upgrade route and owns node-pty shell processes.
 *  - `lib/client.js` — the browser half (CJS closure): the `window.__ModuleLoader__`
 *    handoff the dsh client module table expects, bundling xterm.js inline.
 *
 * Everything under `@deepseek-ai/*`, the react family, and node-only runtime
 * packages (`node-pty`, `ws`) stays EXTERNAL: at runtime they resolve through
 * the profile's healed `node_modules` fallback (host) or the shell's seeded
 * module table (browser). Only xterm.js (and its addon) is inlined into the
 * browser bundle because the module table does not carry it.
 *
 * The build invokes the native esbuild binary directly (stdio inherit) rather
 * than the JS API: the JS API spawns a service process over a pipe, which the
 * development sandbox denies.
 *
 * The two builders are exported so the dev watcher (`watch.mjs`) reuses the
 * exact same pipeline. Both commit their output with
 * {@link commitIfChanged}: when the freshly built bytes equal the artifact
 * already on disk, the file is left untouched, so a change that only touches
 * one half does not re-trigger the other half's HMR chain (host cordis HMR
 * watches `lib/index.js`; the client-hmr poll watches `lib/client.js`).
 */
import { spawnSync } from 'node:child_process'
import { globSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Browser platform modules seeded by the shell's module table (do not inline). */
const PLATFORM_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

const PLUGIN_ID = 'dsh-terminal'

function esbuildBinary() {
  // Pick the platform-native esbuild binary (pnpm installs one optional
  // platform package per OS/arch, e.g. @esbuild/linux-x64 on Linux). The
  // binary sits at the package root on Windows (esbuild.exe) and under
  // bin/ elsewhere.
  const key = `${process.platform}-${process.arch}`
  const exe = process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild'
  const matches = globSync(`node_modules/.pnpm/@esbuild+${key}@*/node_modules/@esbuild/${key}/${exe}`)
  if (matches.length > 0) return matches[0]
  const fallback = globSync(`node_modules/@esbuild/${key}/${exe}`)
  if (fallback.length > 0) return fallback[0]
  throw new Error(`esbuild native binary not found for ${key} — run \`pnpm install\` first`)
}

function run(args) {
  const result = spawnSync(esbuildBinary(), args, { stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

/**
 * Move `tmp` onto `target` only when their bytes differ; always remove `tmp`.
 * @param tmp - freshly built artifact path.
 * @param target - committed artifact path.
 * @returns true when the target was (re)written, false when it was already up to date.
 */
function commitIfChanged(tmp, target) {
  let changed = true
  try {
    changed = !readFileSync(tmp).equals(readFileSync(target))
  } catch (_missingTarget) {
    changed = true
  }
  if (changed) writeFileSync(target, readFileSync(tmp))
  unlinkSync(tmp)
  return changed
}

/** Build the Node/host half into `lib/index.js`. @returns whether the artifact changed. */
export function buildHost() {
  mkdirSync('lib', { recursive: true })
  const tmp = `lib/index.tmp.${process.pid}.js`
  run([
    'src/index.ts',
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--target=node20',
    '--external:node-pty',
    '--external:ws',
    '--external:@deepseek-ai/*',
    `--outfile=${tmp}`,
  ])
  return commitIfChanged(tmp, 'lib/index.js')
}

/** Build the browser half into `lib/client.js`. @returns whether the artifact changed. */
export function buildClient() {
  mkdirSync('lib', { recursive: true })
  const clientTmp = `lib/client.tmp.${process.pid}.js`
  run([
    'src/client/index.ts',
    '--bundle',
    '--format=cjs',
    '--platform=browser',
    '--target=es2020',
    '--jsx=automatic',
    ...PLATFORM_EXTERNALS.flatMap(specifier => [`--external:${specifier}`]),
    '--define:process.env.NODE_ENV="production"',
    '--loader:.css=text',
    `--outfile=${clientTmp}`,
  ])

  const body = readFileSync(clientTmp, 'utf8')
  const banner = `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {\n`
    + 'var module = { exports: {} };\n'
    + 'var exports = module.exports;\n'
  const footer = 'return module.exports;\n} });\n'
  const wrapped = `lib/client.wrap.tmp.${process.pid}.js`
  writeFileSync(wrapped, banner + body + footer)
  unlinkSync(clientTmp)
  return commitIfChanged(wrapped, 'lib/client.js')
}

/** Build both halves. @returns `{ host, client }` change flags. */
export function buildAll() {
  const host = buildHost()
  const client = buildClient()
  return { host, client }
}

// CLI entry: `node build.mjs` (also keeps `pnpm run build` behavior).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildAll()
}
