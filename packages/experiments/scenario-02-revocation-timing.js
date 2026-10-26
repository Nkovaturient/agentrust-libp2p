/**
 * Scenario 02 — the verifier accepts a chain, then rejects it once the issuer's
 * GossipSub revocation reaches its registry. Repeated to expose run-internal spread.
 *
 * propagationMs is measured from the start of revoke() until the verifier's
 * registry contains the revocation (polled every 2 ms).
 */

import { registerKnownPeers } from './lib/agents.js'
import { summarize, waitUntil } from './lib/timing.js'

const ROUNDS = 3

async function revocationRound ({ issuer, delegatee, verifier }, timeoutMs) {
  const chain = await issuer.trustManager.issue({
    subjectPeerId: delegatee.peerId,
    action: 'relay:forward',
    delegatable: false
  })
  const { tokenId } = chain[0]
  const claimedSubject = delegatee.peerId

  const before = await verifier.trustManager.verify({ chain, claimedSubject })

  const startedAt = performance.now()
  await issuer.trustManager.revoke({ tokenId, reason: 'scenario-02' })
  const propagationMs = await waitUntil(
    () => verifier.trustManager.registry.isRevoked(tokenId),
    timeoutMs,
    startedAt
  )

  const after = await verifier.trustManager.verify({ chain, claimedSubject })

  return {
    tokenId,
    beforeValid: before.valid,
    propagationMs,
    afterValid: after.valid,
    afterReason: after.reason
  }
}

export async function runScenario02 ({ issuer, delegatee, verifier }, timeoutMs = 2000) {
  await registerKnownPeers(verifier, [issuer, delegatee])

  const rounds = []
  for (let i = 0; i < ROUNDS; i++) {
    rounds.push(await revocationRound({ issuer, delegatee, verifier }, timeoutMs))
  }

  const passed = rounds.every(round =>
    round.beforeValid === true
    && round.propagationMs !== null
    && round.afterValid === false
    && /revoked/.test(round.afterReason)
  )

  return {
    id: '02-revocation-timing',
    result: {
      passed,
      reason: passed
        ? `verifier accepted before and rejected after revocation in all ${ROUNDS} rounds`
        : rounds.map((round, index) =>
          `round ${index + 1}: before=${round.beforeValid} propagated=${round.propagationMs !== null} after=${round.afterValid} (${round.afterReason})`
        ).join('; ')
    },
    metrics: {
      timeoutMs,
      rounds,
      propagationMs: summarize(rounds.map(round => round.propagationMs).filter(ms => ms !== null))
    }
  }
}
