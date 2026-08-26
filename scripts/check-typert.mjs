/**
 * Fail when the vendored Typert artifact no longer matches the Host surface it was generated from.
 *
 * A stale artifact is not a build error — it is a silent wire mismatch: the browser validates
 * arguments and results against schemas that no longer describe what the Host sends. This check is
 * the only thing standing between an edit to `src/host/` and that failure reaching a user.
 */
import { readFile } from 'node:fs/promises'
import {
  FINGERPRINT_FILE, ROOT, declaredEndpoints, fingerprint, generatedEndpoints,
} from './typert-fingerprint.mjs'

const REGENERATE = 'run `node scripts/regen-typert.mjs <path-to-deepseek-harness>` and commit generated/'

// Compared as SETS, not as sequences. The generator emits invocations in alphabetical order while
// `src/host/` declares them in source order, so an ordered comparison reports a mismatch every time
// the two happen to disagree — which says nothing about whether the artifact is current.
const declared = await declaredEndpoints()
const generated = await generatedEndpoints()
const missing = declared.filter(name => !generated.includes(name))
const extra = generated.filter(name => !declared.includes(name))
if (missing.length > 0 || extra.length > 0) {
  console.error('typert: endpoints differ.')
  if (missing.length > 0) console.error(`  declared in src/host but absent from generated/: ${missing.join(', ')}`)
  if (extra.length > 0) console.error(`  carried by generated/ but no longer declared: ${extra.join(', ')}`)
  console.error(`  ${REGENERATE}`)
  process.exit(1)
}

let recorded
try {
  recorded = (await readFile(new URL(FINGERPRINT_FILE, `file://${ROOT}`), 'utf8')).trim()
} catch {
  // No fingerprint at all means the artifact predates this check, which is indistinguishable from
  // stale — refuse rather than assume it happens to be current.
  console.error(`typert: ${FINGERPRINT_FILE} is missing; ${REGENERATE}`)
  process.exit(1)
}

const current = await fingerprint()
if (recorded !== current) {
  console.error(`typert: the Host surface changed since generated/ was produced.\n  ${REGENERATE}`)
  console.error('  (a comment-only edit trips this too — regenerating is cheap and always correct)')
  process.exit(1)
}
console.log(`typert: artifact matches the Host surface (${declared.length} endpoint(s))`)
