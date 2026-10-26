/**
 * attacker.js — Sybil attacker node.
 * Attempts token forgery, chain theft, and non-delegatable extension.
 * All attacks are expected to fail — this node generates the evidence.
 */
import { createNode } from '../createNode.js'
import { TrustManager } from '@agentrust/trust'

export async function startAttacker (bootstrapPeers = []) {
  const { libp2p, peerId, privateKey } = await createNode({
    listenAddr: process.env.LISTEN_ADDR ?? '/ip4/0.0.0.0/tcp/9004/ws',
    bootstrapPeers
  })

  const tm = new TrustManager({ peerId, privateKey, libp2p })
  await tm.start()

  console.log(`[attacker] Sybil node ready. PeerID: ${peerId}`)
  console.log(`PEER_ID=${peerId}`)

  return { libp2p, peerId, privateKey, publicKey: privateKey.publicKey, trustManager: tm }
}