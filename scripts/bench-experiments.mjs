/**
 * Runs the local experiment suite RUNS times and aggregates timing metrics
 * (median / min / max across runs) into results/bench-summary.json.
 * Raw per-run files are kept in results/bench/.
 *
 * Usage: npm run experiment:bench
 */

import { spawnSync } from 'child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { summarize } from '../packages/experiments/lib/timing.js'

const RUNS = 5
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const resultsDir = resolve(root, 'results')
const benchDir = resolve(resultsDir, 'bench')

rmSync(benchDir, { recursive: true, force: true })
mkdirSync(benchDir, { recursive: true })

for (let i = 1; i <= RUNS; i++) {
  const run = spawnSync('node', ['packages/experiments/runner.js'], {
    cwd: root,
    env: { ...process.env, AGENTRUST_MODE: 'local', AGENTRUST_RESULTS_DIR: benchDir },
    stdio: 'ignore'
  })
  console.log(`run ${i}/${RUNS}: exit ${run.status}`)
}

const files = readdirSync(benchDir).filter(name => name.endsWith('.json')).sort()
const suites = files.map(name => JSON.parse(readFileSync(resolve(benchDir, name), 'utf8')))
const scenario = (suite, prefix) => suite.scenarios.find(s => s.id.startsWith(prefix))
const across = (pick) => summarize(suites.map(pick))

const depths = scenario(suites[0], '01').metrics.depths.map(entry => entry.depth)

const summary = {
  generatedAt: new Date().toISOString(),
  mode: 'local',
  runs: suites.length,
  nodeVersion: suites[0].environment.nodeVersion,
  allRunsPassed: suites.length === RUNS && suites.every(suite => suite.summary.allPassed),
  medianOfPerRunMedians: {
    verifyMsByDepth: Object.fromEntries(depths.map(depth => [
      depth,
      across(suite => scenario(suite, '01').metrics.depths.find(entry => entry.depth === depth).verifyMs.median)
    ])),
    revocationPropagationMs: across(suite => scenario(suite, '02').metrics.propagationMs.median),
    concurrentRevocationMs: across(suite => scenario(suite, '05').metrics.allRevokedMs)
  },
  runFiles: files.map(name => `bench/${name}`)
}

writeFileSync(resolve(resultsDir, 'bench-summary.json'), JSON.stringify(summary, null, 2))
console.log(`wrote results/bench-summary.json (all runs passed: ${summary.allRunsPassed})`)
