/**
 * Regenerate `generated/` from a deepseek-harness checkout.
 *
 * The Typert generator only runs inside that workspace (it is seeded from the harness's own
 * `tsconfig.host.json`), and it names artifacts after the workspace package, so this script stages
 * the Host sources there as `@deepseek-ai/dsh-usage-info`, builds, copies the artifacts back, and
 * rewrites them onto this package's name. Everything it touches in the harness is restored.
 *
 * Usage: node scripts/regen-typert.mjs <path-to-deepseek-harness>
 */
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FINGERPRINT_FILE, fingerprint } from './typert-fingerprint.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const HARNESS = process.argv[2]
/** Package name the harness must use: its path aliases only resolve `@deepseek-ai/dsh-*`. */
const STAGED = '@deepseek-ai/dsh-usage-info'
const OWN = '@achasoft/dsh-usage-info'
const STAGE_DIR = 'packages/usage-info/usage-info'
/** Harness files this script edits; each is restored from git before it exits. */
const TOUCHED = ['tsconfig.base.json', 'tsconfig.host.json', 'pnpm-lock.yaml']

if (HARNESS === undefined || !existsSync(join(HARNESS, 'tsconfig.host.json'))) {
  console.error('usage: node scripts/regen-typert.mjs <path-to-deepseek-harness>')
  process.exit(1)
}
const run = (cmd, args, cwd = HARNESS) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: process.env })

// A dirty tree would make the restore below indistinguishable from discarding the user's work.
if (execFileSync('git', ['status', '--porcelain'], { cwd: HARNESS, encoding: 'utf8' }).trim() !== '') {
  console.error(`refusing to run: ${HARNESS} has uncommitted changes. Commit or stash them first.`)
  process.exit(1)
}

const stage = join(HARNESS, STAGE_DIR)
try {
  console.log(`staging Host sources into ${STAGE_DIR} as ${STAGED}`)
  await mkdir(join(stage, 'src'), { recursive: true })
  await cp(join(ROOT, 'src/host'), join(stage, 'src'), { recursive: true })
  await cp(join(ROOT, 'src/balance'), join(stage, 'src/balance'), { recursive: true })
  // The staged package is flat: every `src/host/*.ts` becomes `src/*.ts`, so each one's reach into
  // the sibling seam directory shifts up a level. Applied to ALL of them, not just the entry: any
  // host module left pointing at `../balance/` fails to resolve and takes the whole build with it.
  // The rewrite is length-preserving per line, which is what keeps the emitted sourceLocation line
  // numbers equal to the ones in this package's own `src/host/index.ts`.
  for (const file of await readdir(join(ROOT, 'src/host'))) {
    const staged = join(stage, 'src', file)
    await writeFile(staged, (await readFile(staged, 'utf8')).replaceAll('../balance/', './balance/'))
  }

  const version = JSON.parse(await readFile(join(HARNESS, 'package.json'), 'utf8')).version
  await writeFile(join(stage, 'package.json'), `${JSON.stringify({
    name: STAGED, version, private: true, type: 'module',
    main: 'lib/index.js', types: 'lib/types/index.d.ts',
    exports: {
      '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
      './types': { types: './lib/types/types.d.ts', default: './lib/types/types.js' },
      './typert': { types: './lib/typert.host.d.ts', default: './lib/typert.host.js' },
      './remote': { types: './lib/typert.remote-client.d.ts', default: './lib/typert.remote-client.js' },
    },
    // The generator refuses a package that would not publish what it just emitted: it requires
    // BOTH typert exports above and all four artifacts listed here (generator/src/workspace.ts,
    // validateExport). The staged package is thrown away, but the check does not know that.
    files: [
      'lib/typert.host.js', 'lib/typert.host.d.ts',
      'lib/typert.remote-client.js', 'lib/typert.remote-client.d.ts',
    ],
    dependencies: { '@deepseek-ai/schemastery': 'workspace:^' },
    peerDependencies: {
      '@deepseek-ai/cordis': 'workspace:^',
      '@deepseek-ai/dsh-credentials': 'workspace:^',
      '@deepseek-ai/dsh-settings': 'workspace:^',
      '@deepseek-ai/dsh-typert-protocol': 'workspace:^',
    },
    devDependencies: {
      '@deepseek-ai/cordis': 'workspace:^',
      '@deepseek-ai/dsh-credentials': 'workspace:^',
      '@deepseek-ai/dsh-settings': 'workspace:^',
      '@deepseek-ai/dsh-typert-protocol': 'workspace:^',
    },
  }, null, 2)}\n`)
  await writeFile(join(stage, 'tsconfig.json'), `${JSON.stringify({
    extends: '../../../tsconfig.base.json',
    compilerOptions: { rootDir: 'src', outDir: 'lib/types' },
    include: ['src'],
    references: [
      '../../../vendor/cosmokit', '../../../vendor/cordis', '../../../vendor/schemastery',
      '../../credentials/credentials', '../../settings/settings', '../../typert/protocol',
    ].map(path => ({ path })),
  }, null, 2)}\n`)

  // Register the new group so `@deepseek-ai/dsh-usage-info[/types]` resolves, and add the project ref.
  const base = join(HARNESS, 'tsconfig.base.json')
  let baseText = await readFile(base, 'utf8')
  baseText = baseText.replace(
    '        "./packages/todo/*/src",\n',
    '        "./packages/todo/*/src",\n        "./packages/usage-info/*/src",\n',
  ).replace(
    '      "@deepseek-ai/dsh-goal/types":',
    `      "${STAGED}/types": ["./packages/usage-info/usage-info/src/types.ts"],\n      "@deepseek-ai/dsh-goal/types":`,
  )
  await writeFile(base, baseText)
  const host = join(HARNESS, 'tsconfig.host.json')
  await writeFile(host, (await readFile(host, 'utf8')).replace(
    '    { "path": "./packages/todo/tool-todo" },\n',
    `    { "path": "./packages/todo/tool-todo" },\n    { "path": "./${STAGE_DIR}" },\n`,
  ))

  console.log('building the harness Host face (several minutes)')
  run('pnpm', ['install', '--silent'])
  run('npx', ['tsc', '-b', 'tsconfig.host.json'])
  run('npx', ['tsdown', '--env.DSH_BUILD_FACE', 'host'])

  console.log('copying artifacts back and rewriting onto ' + OWN)
  await mkdir(join(ROOT, 'generated'), { recursive: true })
  for (const file of ['typert.host.js', 'typert.host.d.ts', 'typert.remote-client.js', 'typert.remote-client.d.ts']) {
    const text = (await readFile(join(stage, 'lib', file), 'utf8'))
      .replaceAll(`${STAGED}/types`, '../src/host/types.ts')
      .replaceAll(STAGED, OWN)
    await writeFile(join(ROOT, 'generated', file), text)
  }
  await writeFile(join(ROOT, FINGERPRINT_FILE), `${await fingerprint()}\n`)
  console.log('done — review `git diff generated/` before committing')
} finally {
  console.log('restoring the harness checkout')
  await rm(stage, { recursive: true, force: true })
  await rm(join(HARNESS, 'packages/usage-info'), { recursive: true, force: true })
  execFileSync('git', ['checkout', '--', ...TOUCHED], { cwd: HARNESS, stdio: 'inherit' })
  run('pnpm', ['install', '--silent'])
}
