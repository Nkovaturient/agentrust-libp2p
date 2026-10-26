/**
 * index.js
 * AgentTrust — Docker container entry point.
 *
 * Reads ROLE from environment and starts the matching agent, then exposes
 * its HTTP control API. Each non-bootstrap role dials the bootstrap node.
 */

import { multiaddr } from '@multiformats/multiaddr'
import { startControlServer } from './controlServer.js'
import { startAttacker } from './roles/attacker.js'
import { startBootstrap } from './roles/bootstrap.js'
import { startDelegatee } from './roles/delegatee.js'
import { startIssuer } from './roles/issuer.js'
import { startVerifier } from './roles/verifier.js'

const ROLE           = process.env.ROLE ?? 'verifier'
const BOOTSTRAP_ADDR = process.env.BOOTSTRAP_ADDR ?? ''
const CONTROL_PORT   = Number(process.env.CONTROL_PORT ?? 8080)

const STARTERS = {
  bootstrap: startBootstrap,
  issuer:    startIssuer,
  delegatee: startDelegatee,
  verifier:  startVerifier,
  attacker:  startAttacker
}

const bootstrapPeers = BOOTSTRAP_ADDR ? [BOOTSTRAP_ADDR] : []

async function main () {
  const start = STARTERS[ROLE]
  if (!start) throw new Error(`Unknown ROLE '${ROLE}' (expected: ${Object.keys(STARTERS).join(', ')})`)

  console.log(`\n[AgentTrust] Starting as role: ${ROLE}`)
  if (bootstrapPeers.length) {
    console.log(`[AgentTrust] Bootstrap: ${bootstrapPeers[0]}`)
  }

  const node = await start(bootstrapPeers)
  const { libp2p, trustManager } = node

  // Peer discovery alone does not guarantee a connection; dial explicitly.
  for (const addr of bootstrapPeers) {
    await libp2p.dial(multiaddr(addr))
  }

  startControlServer({ role: ROLE, port: CONTROL_PORT, ...node })
  console.log(`[AgentTrust:${ROLE}] Control API on :${CONTROL_PORT}`)

  process.on('SIGTERM', async () => {
    console.log(`[AgentTrust:${ROLE}] SIGTERM received — stopping.`)
    await libp2p.stop()
    process.exit(0)
  })

  setInterval(() => {
    const stats = trustManager.stats()
    console.log(`[AgentTrust:${ROLE}] heartbeat | revoked: ${stats.revokedCount} | peers: ${stats.knownPeers}`)
  }, 30_000)
}

main().catch(err => {
  console.error('[AgentTrust] Fatal:', err)
  process.exit(1)
})
