/**
 * nodeStatus.js
 * AgentTrust — Connectivity snapshot of a libp2p node.
 * Shared by the in-process experiment agents and the Docker control server.
 */

import { REVOCATION_TOPIC } from '@agentrust/trust/revocation'

export function nodeStatus (libp2p) {
  const pubsub = libp2p.services.pubsub
  return {
    connectedPeers: [...new Set(libp2p.getConnections().map(c => c.remotePeer.toString()))],
    revocationSubscribers: pubsub.getSubscribers(REVOCATION_TOPIC).length,
    revocationMeshPeers: pubsub.getMeshPeers(REVOCATION_TOPIC).length,
    multiaddrs: libp2p.getMultiaddrs().map(addr => addr.toString())
  }
}
