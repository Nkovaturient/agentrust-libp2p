/**
 * agents.js
 * AgentTrust — Agent helpers shared by all scenarios.
 *
 * An agent is { role, peerId, publicKey, trustManager, status?, sign? }.
 * Hop agents are key-only delegators: they sign and verify chains but run no libp2p node.
 */

import { generateKeyPair } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { TrustManager } from '@agentrust/trust'
import { signToken } from '@agentrust/trust/capability'

export async function registerKnownPeers (agent, peers) {
  for (const peer of peers) {
    await agent.trustManager.registerPeer(peer.peerId, peer.publicKey)
  }
}

export async function makeHopAgents (count) {
  const hops = []
  for (let i = 0; i < count; i++) {
    const privateKey = await generateKeyPair('Ed25519')
    const peerId = peerIdFromPrivateKey(privateKey).toString()
    hops.push({
      role: `hop-${i + 1}`,
      peerId,
      publicKey: privateKey.publicKey,
      trustManager: new TrustManager({ peerId, privateKey, libp2p: null }),
      sign: (token) => signToken(token, privateKey)
    })
  }
  return hops
}
