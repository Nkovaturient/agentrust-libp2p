/**
 * Scenario 05 — two accepted tokens are revoked concurrently; each revocation
 * must reach the verifier independently and both tokens must then be rejected.
 *
 * Per-token times are measured from the start of the concurrent revoke() calls.
 */

import { registerKnownPeers } from './lib/agents.js'
import { waitUntil } from './lib/timing.js'

const ACTIONS = ['relay:forward', 'relay:store']

export async function runScenario05 ({ issuer, delegatee, verifier }, timeoutMs = 2000) {
  await registerKnownPeers(verifier, [issuer, delegatee])
  const claimedSubject = delegatee.peerId

  const chains = []
  for (const action of ACTIONS) {
    chains.push(await issuer.trustManager.issue({ subjectPeerId: delegatee.peerId, action, delegatable: false }))
  }
  const tokenIds = chains.map(chain => chain[0].tokenId)

  const before = await Promise.all(chains.map(chain => verifier.trustManager.verify({ chain, claimedSubject })))

  const startedAt = performance.now()
  const [perTokenMs] = await Promise.all([
    Promise.all(tokenIds.map(tokenId =>
      waitUntil(() => verifier.trustManager.registry.isRevoked(tokenId), timeoutMs, startedAt)
    )),
    Promise.all(tokenIds.map((tokenId, i) =>
      issuer.trustManager.revoke({ tokenId, reason: `scenario-05-${ACTIONS[i]}` })
    ))
  ])

  const after = await Promise.all(chains.map(chain => verifier.trustManager.verify({ chain, claimedSubject })))

  const allRevokedMs = perTokenMs.every(ms => ms !== null) ? Math.max(...perTokenMs) : null
  const passed = new Set(tokenIds).size === ACTIONS.length
    && before.every(result => result.valid === true)
    && allRevokedMs !== null
    && after.every(result => result.valid === false && /revoked/.test(result.reason))

  return {
    id: '05-concurrent-revocation',
    result: {
      passed,
      reason: passed
        ? 'verifier accepted both tokens, then rejected both after their concurrent revocations propagated'
        : `before=${before.map(r => r.valid)}; perTokenMs=${perTokenMs}; after=${after.map(r => `${r.valid} (${r.reason})`).join(', ')}`
    },
    metrics: { timeoutMs, tokenIds, perTokenMs, allRevokedMs }
  }
}
