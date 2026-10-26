/**
 * mesh.js
 * AgentTrust — Wait until the revocation GossipSub mesh has formed.
 */

import { waitUntil } from './timing.js'

export async function waitForMesh ({ bootstrap, issuer, delegatee, verifier, attacker }, timeoutMs = 60_000) {
  const members = [issuer, delegatee, verifier, attacker]

  const formedAfterMs = await waitUntil(async () => {
    const hub = await bootstrap.status()
    if (
      hub.connectedPeers.length < members.length ||
      hub.revocationSubscribers < members.length ||
      hub.revocationMeshPeers < members.length
    ) return false

    const statuses = await Promise.all(members.map(member => member.status()))
    return statuses.every(status => status.revocationSubscribers >= 1)
  }, timeoutMs, performance.now(), 100)

  if (formedAfterMs === null) {
    throw new Error(`GossipSub mesh did not form within ${timeoutMs}ms`)
  }
  return formedAfterMs
}
