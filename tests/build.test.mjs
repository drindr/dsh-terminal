import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { appendFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = fileURLToPath(new URL('../', import.meta.url))
const cli = fileURLToPath(import.meta.resolve('tsdown/run'))

test('tsdown builds and watcher preserve independent HMR artifacts', { timeout: 30000 }, async (t) => {
  // Isolate all edits/artifacts from the installed plugin and running GUI.
  const dir = mkdtempSync(join(root, '.build-test-'))
  let watcher
  t.after(async () => {
    if (watcher && watcher.exitCode === null) {
      const exited = once(watcher, 'exit')
      watcher.kill()
      await exited
    }
    rmSync(dir, { recursive: true, force: true })
  })
  for (const path of ['src', 'package.json', 'tsdown.config.ts', 'watch.mjs']) {
    cpSync(join(root, path), join(dir, path), { recursive: true })
  }
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction')
  const build = () => spawnSync(process.execPath, [cli], { cwd: dir, encoding: 'utf8' })
  const artifact = (name) => join(dir, 'lib', `${name}.js`)
  const snapshot = () => Object.fromEntries(['index', 'client'].map(name => [name, {
    bytes: readFileSync(artifact(name)), mtime: statSync(artifact(name), { bigint: true }).mtimeNs,
  }]))
  const succeeds = () => {
    const result = build()
    assert.equal(result.status, 0, result.stdout + result.stderr)
  }

  succeeds()
  assert.deepEqual(readdirSync(join(dir, 'lib')).sort(), ['client.js', 'index.js'])
  for (const name of ['index', 'client']) {
    assert.equal(spawnSync(process.execPath, ['--check', artifact(name)]).status, 0)
  }
  let registration
  runInNewContext(readFileSync(artifact('client'), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { registration = value } } },
  })
  assert.equal(registration.id, 'dsh-terminal')
  assert.equal(typeof registration.factory, 'function')
  const requires = [...readFileSync(artifact('client'), 'utf8').matchAll(/require\("([^"]+)"\)/g)].map(match => match[1])
  assert.ok(requires.includes('@deepseek-ai/dsh-client-store'))
  assert.ok(requires.every(name => ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-store'].includes(name)), requires.join(', '))
  const initial = snapshot()
  succeeds()
  assert.deepEqual(snapshot(), initial, 'no-op build must preserve bytes and mtimes')

  appendFileSync(join(dir, 'src/client/styles.css'), '\n.dsh-build-test { color: red; }\n')
  succeeds()
  const clientChanged = snapshot()
  assert.deepEqual(clientChanged.index, initial.index)
  assert.notDeepEqual(clientChanged.client.bytes, initial.client.bytes)
  appendFileSync(join(dir, 'src/index.ts'), '\nconsole.log("host-build-test")\n')
  succeeds()
  const hostChanged = snapshot()
  assert.deepEqual(hostChanged.client, clientChanged.client)
  assert.notDeepEqual(hostChanged.index.bytes, clientChanged.index.bytes)

  const clientSource = join(dir, 'src/client/index.ts')
  const validSource = readFileSync(clientSource, 'utf8')
  appendFileSync(clientSource, '\nconst invalid = ;\n')
  assert.notEqual(build().status, 0, 'build failures must propagate a nonzero exit')
  assert.deepEqual(snapshot(), hostChanged, 'failed client build must not rewrite either artifact')
  writeFileSync(clientSource, validSource)

  let output = ''
  const waiters = new Set()
  // Deliberately launch outside the fixture cwd to check absolute path handling.
  watcher = spawn(process.execPath, [join(dir, 'watch.mjs')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  const receive = (chunk) => {
    output += chunk
    for (const check of waiters) check()
  }
  watcher.stdout.on('data', receive)
  watcher.stderr.on('data', receive)
  const waitFor = (text, after = 0) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(check)
      reject(new Error(`Timed out waiting for ${text}:\n${output}`))
    }, 10000)
    const check = () => {
      if (!output.slice(after).includes(text)) return
      clearTimeout(timer)
      waiters.delete(check)
      resolve()
    }
    waiters.add(check)
    check()
  })
  await waitFor('[watch] rebuilt in')
  assert.deepEqual(snapshot(), hostChanged, 'initial watcher build is also a no-op')
  let offset = output.length
  appendFileSync(clientSource, '\nconst invalid = ;\n')
  await waitFor('[watch] build failed:', offset)
  offset = output.length
  writeFileSync(clientSource, validSource + '\nconsole.log("watch-recovered")\n')
  await waitFor('[watch] rebuilt in', offset)
  assert.match(readFileSync(artifact('client'), 'utf8'), /watch-recovered/)
  assert.deepEqual(snapshot().index, hostChanged.index)

  offset = output.length
  const config = join(dir, 'tsdown.config.ts')
  writeFileSync(`${config}.new`, readFileSync(config, 'utf8').replace("const id = 'dsh-terminal'", "const id = 'dsh-terminal-test'"))
  renameSync(`${config}.new`, config)
  await waitFor('[watch] rebuilt in', offset)
  assert.match(readFileSync(artifact('client'), 'utf8'), /id: "dsh-terminal-test"/)
})
