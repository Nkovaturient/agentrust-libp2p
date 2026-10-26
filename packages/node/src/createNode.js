/**
 * createNode.js
 * AgentTrust — Base libp2p node factory.
 *
 * Creates a js-libp2p node with:
 *   - Ed25519 identity (auto-generated or supplied)
 *   - Noise protocol for connection encryption
 *   - WebSockets transport (works in both Node.js and browser)
 *   - Yamux stream multiplexer
 *   - GossipSub for revocation broadcast
 *   - Bootstrap or manual peer discovery
 *
 * All nodes in the Docker testnet are created via this factory.
 */

import { createLibp2p }  from 'libp2p'
import { noise }         from '@chainsafe/libp2p-noise'
import { yamux }         from '@chainsafe/libp2p-yamux'
import { gossipsub }     from '@chainsafe/libp2p-gossipsub'
import { webSockets }    from '@libp2p/websockets'
import { bootstrap }     from '@libp2p/bootstrap'
import { identify }      from '@libp2p/identify'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { REVOCATION_TOPIC } from '@agentrust/trust/revocation'
import { loadPrivateKeyFromEnv } from './identity.js'

/**
 * Create a libp2p node.
 *
 * @param {object} opts
 * @param {string}   opts.listenAddr      — e.g. '/ip4/0.0.0.0/tcp/0/ws'
 * @param {string[]} [opts.bootstrapPeers] — multiaddrs of bootstrap nodes
 * @param {object}   [opts.privateKey]    — existing Ed25519 private key (optional)
 * @returns {{ libp2p, peerId, privateKey }}
 */
export async function createNode ({ listenAddr, bootstrapPeers = [], privateKey: suppliedKey }) {
  // Generate or use supplied Ed25519 keypair
  const privateKey  = suppliedKey ?? await loadPrivateKeyFromEnv() ?? await generateKeyPair('Ed25519')
  const peerId      = peerIdFromPrivateKey(privateKey)
  const peerIdStr   = peerId.toString()

  const peerDiscovery = bootstrapPeers.length > 0
    ? [bootstrap({ list: bootstrapPeers })]
    : []

  const libp2p = await createLibp2p({
    privateKey,
    addresses: {
      listen: [listenAddr]
    },
    transports: [webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery,
    services: {
      identify: identify(),
      pubsub: gossipsub({
        // GossipSub scoring helps resist spam on the revocation topic
        allowPublishToZeroTopicPeers: true,  // useful for small testnets
        emitSelf: false
      })
    }
  })

  // Subscribe to the revocation topic immediately on start
  libp2p.addEventListener('start', () => {
    libp2p.services.pubsub.subscribe(REVOCATION_TOPIC)
    console.log(`[Node:${peerIdStr.slice(0, 12)}…] Started. Listening on:`, libp2p.getMultiaddrs().map(a => a.toString()))
  })

  await libp2p.start()

  return { libp2p, peerId: peerIdStr, privateKey }
}