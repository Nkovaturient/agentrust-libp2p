/**
 * localFactory.js
 * AgentTrust — Five in-process libp2p agents on 127.0.0.1 (star topology via bootstrap).
 */

import { createNode } from '@agentrust/node/createNode'
import { nodeStatus } from '@agentrust/node/nodeStatus'
import { TrustManager } from '@agentrust/trust'
import { signToken } from '@agentrust/trust/capability'
import { waitForMesh } from './mesh.js'

const ROLES = ['bootstrap', 'issuer', 'delegatee', 'verifier', 'attacker']

async function makeAgent (role) {
  const { libp2p, peerId, privateKey } = await createNode({ listenAddr: '/ip4/127.0.0.1/tcp/0/ws' })
  const trustManager = new TrustManager({ peerId, privateKey, libp2p })
  await trustManager.start()

  return {
    role,
    peerId,
    publicKey: privateKey.publicKey,
    libp2p,
    trustManager,
    sign: (token) => signToken(token, privateKey),
    status: async () => nodeStatus(libp2p)
  }
}

export async function createLocalAgents () {
  const agents = {}
  for (const role of ROLES) {
    agents[role] = await makeAgent(role)
  }

  const [hubAddr] = agents.bootstrap.libp2p.getMultiaddrs()
  for (const role of ROLES.slice(1)) {
    await agents[role].libp2p.dial(hubAddr)
  }
  await waitForMesh(agents)

  return {
    agents,
    stop: () => Promise.all(Object.values(agents).map(agent => agent.libp2p.stop()))
  }
}
