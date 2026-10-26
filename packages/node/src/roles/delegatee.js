/**
 * delegatee.js — Receives a capability and re-delegates it downstream.
 */
import { createNode } from '../createNode.js'
import { TrustManager } from '@agentrust/trust'

export async function startDelegatee (bootstrapPeers = []) {
  const { libp2p, peerId, privateKey } = await createNode({
    listenAddr: process.env.LISTEN_ADDR ?? '/ip4/0.0.0.0/tcp/9002/ws',
    bootstrapPeers
  })

  const tm = new TrustManager({ peerId, privateKey, libp2p })
  await tm.start()

  console.log(`[delegatee] Ready. PeerID: ${peerId}`)
  console.log(`PEER_ID=${peerId}`)

  return { libp2p, peerId, privateKey, publicKey: privateKey.publicKey, trustManager: tm }
}