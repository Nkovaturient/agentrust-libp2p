/**
 * Scenario 01 — chains of depth 1–8 verify, depth 9 is rejected,
 * and the verifier never opens a connection to the issuer.
 */

import { makeHopAgents, registerKnownPeers } from './lib/agents.js'
import { buildChain } from './lib/chain.js'
import { measureAsync, summarize } from './lib/timing.js'

const MAX_DEPTH = 8
const REPETITIONS = 5

async function verifyAtDepth ({ issuer, delegatee, verifier, hops, depth }) {
  const delegators = depth === 1 ? [] : [delegatee, ...hops.slice(0, depth - 2)]
  const chain = await buildChain({ issuer, delegators, tailPeerId: verifier.peerId })

  const timings = []
  let verification
  for (let i = 0; i < REPETITIONS; i++) {
    const { value, ms } = await measureAsync(() =>
      verifier.trustManager.verify({ chain, claimedSubject: verifier.peerId })
    )
    verification = value
    timings.push(ms)
  }

  return {
    depth,
    chainLength: chain.length,
    valid: verification.valid,
    reason: verification.reason,
    verifyMs: summarize(timings)
  }
}

async function verifierConnectedToIssuer (verifier, issuer) {
  return (await verifier.status()).connectedPeers.includes(issuer.peerId)
}

export async function runScenario01 ({ issuer, delegatee, verifier }) {
  const hops = await makeHopAgents(MAX_DEPTH - 1)
  await registerKnownPeers(verifier, [issuer, delegatee, ...hops])

  const connectedBefore = await verifierConnectedToIssuer(verifier, issuer)

  const depths = []
  for (let depth = 1; depth <= MAX_DEPTH + 1; depth++) {
    depths.push(await verifyAtDepth({ issuer, delegatee, verifier, hops, depth }))
  }
  const accepted = depths.filter(entry => entry.depth <= MAX_DEPTH)
  const overDepth = depths.find(entry => entry.depth === MAX_DEPTH + 1)

  const connectedAfter = await verifierConnectedToIssuer(verifier, issuer)

  const acceptedOk = accepted.every(entry => entry.valid === true && entry.chainLength === entry.depth)
  const overDepthRejected = overDepth.valid === false && /exceeds maximum/.test(overDepth.reason)
  const issuerUntouched = connectedBefore === false && connectedAfter === false
  const passed = acceptedOk && overDepthRejected && issuerUntouched

  return {
    id: '01-delegation-chain',
    result: {
      passed,
      reason: passed
        ? `chains of depth 1-${MAX_DEPTH} verified, depth ${MAX_DEPTH + 1} rejected, verifier never connected to the issuer`
        : `acceptedOk=${acceptedOk}; overDepthRejected=${overDepthRejected} (${overDepth.reason}); verifierConnectedToIssuer before=${connectedBefore} after=${connectedAfter}`
    },
    metrics: {
      maxDepthAccepted: Math.max(0, ...accepted.filter(entry => entry.valid).map(entry => entry.depth)),
      repetitionsPerDepth: REPETITIONS,
      depths,
      verifierConnectedToIssuer: { before: connectedBefore, after: connectedAfter }
    }
  }
}
