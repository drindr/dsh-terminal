/**
 * tsdown build for dsh-terminal (replaces the legacy esbuild build.mjs).
 *
 * Emits two artifacts from the source tree, same contract as before:
 *  - `lib/index.js`  — the Node/host half (ESM): registers the `/terminal`
 *    WebSocket upgrade route and owns node-pty shell processes.
 *  - `lib/client.js` — the browser half (CJS closure factory): the
 *    `window.__ModuleLoader__.load({ id, factory })` handoff the dsh client
 *    module table expects, bundling xterm.js inline.
 *
 * Platform packages (`@deepseek-ai/*`, the react family, `node-pty`, `ws`)
 * stay EXTERNAL: at runtime they resolve through the profile's healed
 * `node_modules` fallback (host) or the shell's seeded module table (browser).
 * Only xterm.js (and its addon) is inlined into the browser bundle because the
 * module table does not carry it. Plain `.css` imports (including the package
 * stylesheet `@xterm/xterm/css/xterm.css`) are inlined as raw text — the old
 * esbuild `--loader:.css=text` — because `src/client/styles.ts` installs the
 * `<style>` tags itself.
 */
import { readFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'

/** Module-table handoff id: the loader entry name (the package name). */
const id = 'dsh-terminal'

/** Browser platform modules seeded by the shell's module table (do not inline). */
const CLIENT_EXTERNALS = [
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
  '@deepseek-ai/dsh-client-store',
]

/** Config location = plugin package root (node_modules lives here too). */
const ROOT = fileURLToPath(new URL('.', import.meta.url))

/** Virtual-id wrapper keeping plain CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Inline `.css` as a raw default-export string (old `--loader:.css=text`). */
const cssTextPlugin = {
  name: 'dsh-css-text',
  resolveId(source: string, importer: string | undefined) {
    if (!source.endsWith('.css')) return null
    const abs = source.startsWith('.')
      ? (importer === undefined ? source : resolvePath(dirname(importer), source))
      : resolvePath(ROOT, 'node_modules', source)
    return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
  },
  async load(this: { addWatchFile(file: string): void }, virtualId: string) {
    if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
    const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    this.addWatchFile(fileId)
    const text = await readFile(fileId, 'utf8')
    return `export default ${JSON.stringify(text)};`
  },
}

export default [
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: [/^@deepseek-ai\//, 'node-pty', 'ws'] },
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2020',
    dts: false,
    clean: false,
    deps: {
      neverBundle: [...CLIENT_EXTERNALS],
      alwaysBundle: (source: string) => (CLIENT_EXTERNALS.includes(source) ? false : true),
      // The module table does not carry xterm.js, so it (and its addon) must
      // be bundled — explicitly whitelist what the client is allowed to inline.
      onlyBundle: ['@xterm/xterm', '@xterm/addon-fit'],
    },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    inputOptions: {
      resolve: { conditionNames: ['browser', 'import', 'require', 'default'] },
    },
    plugins: [cssTextPlugin],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]
