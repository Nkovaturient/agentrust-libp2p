/**
 * Submission gate: unit tests, one local experiment run, and a check that the
 * committed canonical results file still records a full pass.
 *
 * Usage: npm run verify
 * Does not replace results/experiment-run-canonical.json.
 */

import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function run (command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`[verify] ${command} ${args.join(' ')} exited ${result.status}`)
    process.exit(result.status ?? 1)
  }
}

run('npm', ['test'])
run('node', ['packages/experiments/runner.js'])

const canonicalPath = resolve(root, 'results/experiment-run-canonical.json')
const canonical = JSON.parse(readFileSync(canonicalPath, 'utf8'))
if (canonical.summary?.allPassed !== true || canonical.scenarios?.length !== 5) {
  console.error('[verify] results/experiment-run-canonical.json is missing a 5/5 pass')
  process.exit(1)
}

console.log(`[verify] canonical ${canonical.runId} allPassed=true (${canonical.mode})`)
