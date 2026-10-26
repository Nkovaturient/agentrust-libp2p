/**
 * issuer.js — Root trust issuer role.
 * The origin of all capability tokens in the testnet.
 */
import { createNode } from '../createNode.js'
import { TrustManager } from '@agentrust/trust'

export async function startIssuer (bootstrapPeers = []) {
  const { libp2p, peerId, privateKey } = await createNode({
    listenAddr: process.env.LISTEN_ADDR ?? '/ip4/0.0.0.0/tcp/9001/ws',
    bootstrapPeers
  })

  const tm = new TrustManager({ peerId, privateKey, libp2p })
  await tm.start()

  console.log(`[issuer] Ready. PeerID: ${peerId}`)
  console.log(`PEER_ID=${peerId}`)

  return { libp2p, peerId, privateKey, publicKey: privateKey.publicKey, trustManager: tm }
}