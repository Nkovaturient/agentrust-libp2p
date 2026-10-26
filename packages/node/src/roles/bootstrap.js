/**
 * bootstrap.js — Bootstrap / relay agent role.
 * Acts as the central discovery hub for the testnet.
 * Announces its multiaddr via stdout so other nodes can dial it.
 */
import { createNode } from '../createNode.js'
import { TrustManager } from '@agentrust/trust'

export async function startBootstrap () {
  const { libp2p, peerId, privateKey } = await createNode({
    listenAddr: process.env.LISTEN_ADDR ?? '/ip4/0.0.0.0/tcp/9000/ws'
  })

  const tm = new TrustManager({ peerId, privateKey, libp2p })
  await tm.start()

  // Print multiaddr so other containers can parse BOOTSTRAP_PEER_ID
  const addrs = libp2p.getMultiaddrs()
  console.log(`[bootstrap] PeerID: ${peerId}`)
  console.log(`[bootstrap] Multiaddrs: ${addrs.map(a => a.toString()).join(', ')}`)
  console.log(`PEER_ID=${peerId}`)

  return { libp2p, peerId, privateKey, publicKey: privateKey.publicKey, trustManager: tm }
}