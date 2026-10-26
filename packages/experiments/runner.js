/**
 * runner.js
 * AgentTrust — Experiment orchestrator.
 *
 * Runs all five scenarios against five agents and writes structured JSON to results/.
 *
 * Modes (AGENTRUST_MODE):
 *   local   (default) five in-process libp2p nodes on 127.0.0.1
 *   docker  five containers driven through their HTTP control API
 *           (set BOOTSTRAP/ISSUER/DELEGATEE/VERIFIER/ATTACKER_CONTROL_URL)
 *
 * Usage:
 *   node packages/experiments/runner.js
 *
 * Output:
 *   results/experiment-run-<timestamp>.json
 *   (override the directory with AGENTRUST_RESULTS_DIR)
 */

import { writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname }         from 'path'
import { fileURLToPath }            from 'url'

import { createLocalAgents }        from './lib/localFactory.js'
import { createDockerAgents }       from './lib/remoteFactory.js'
import { runScenario01 }            from './scenario-01-delegation-chain.js'
import { runScenario02 }            from './scenario-02-revocation-timing.js'
import { runScenario03 }            from './scenario-03-sybil-probe.js'
import { runScenario04 }            from './scenario-04-multihop-chain.js'
import { runScenario05 }            from './scenario-05-concurrent-revocation.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const MODES = {
  local: createLocalAgents,
  docker: createDockerAgents
}

async function main () {
  const mode = process.env.AGENTRUST_MODE ?? 'local'
  const createAgents = MODES[mode]
  if (!createAgents) throw new Error(`Unknown AGENTRUST_MODE '${mode}' (expected: ${Object.keys(MODES).join(', ')})`)

  console.log('\n╔══════════════════════════════════════════════╗')
  console.log('║  AgentTrust — Experiment Runner              ║')
  console.log('║  Track 4 · libp2p Resilient Networking 2026  ║')
  console.log('╚══════════════════════════════════════════════╝\n')

  const runId      = new Date().toISOString().replace(/[:.]/g, '-')
  const resultsDir = process.env.AGENTRUST_RESULTS_DIR ?? resolve(__dirname, '../../results')
  mkdirSync(resultsDir, { recursive: true })

  console.log(`── Starting agents (mode: ${mode}) ───────────────`)
  const { agents, stop } = await createAgents()
  const { issuer, delegatee, verifier, attacker } = agents

  const suite = {
    runId,
    mode,
    startedAt:   new Date().toISOString(),
    environment: { nodeVersion: process.version, meshNodes: Object.keys(agents).length },
    scenarios:   [],
    summary:     null
  }

  const scenarios = [
    ['01: Delegation Chain',        () => runScenario01({ issuer, delegatee, verifier })],
    ['02: Revocation Timing',       () => runScenario02({ issuer, delegatee, verifier })],
    ['03: Sybil Probe',             () => runScenario03({ issuer, delegatee, verifier, attacker })],
    ['04: Chain Integrity',         () => runScenario04({ issuer, delegatee, verifier })],
    ['05: Concurrent Revocation',   () => runScenario05({ issuer, delegatee, verifier })]
  ]

  for (const [title, run] of scenarios) {
    console.log(`\n── Running Scenario ${title} ──`)
    suite.scenarios.push(await run())
  }

  const passed = suite.scenarios.filter(s => s.result?.passed).length
  const total  = suite.scenarios.length

  suite.summary = {
    total,
    passed,
    failed:      total - passed,
    allPassed:   passed === total,
    finishedAt:  new Date().toISOString()
  }

  for (const s of suite.scenarios) {
    console.log(`${s.result.passed ? 'PASS' : 'FAIL'}  ${s.id} — ${s.result.reason}`)
  }
  console.log(`\nResults: ${passed}/${total} scenarios passed`)

  const outPath = resolve(resultsDir, `experiment-run-${runId}.json`)
  writeFileSync(outPath, JSON.stringify(suite, null, 2))
  console.log(`[Runner] Results written to: ${outPath}`)

  await stop()
  console.log('[Runner] Done.')

  process.exit(suite.summary.allPassed ? 0 : 1)
}

main().catch(err => {
  console.error('[Runner] Fatal error:', err)
  process.exit(1)
})
