/**
 * remoteFactory.js
 * AgentTrust — Agents backed by the Docker testnet containers.
 *
 * Each container exposes the HTTP control API from packages/node/src/controlServer.js.
 * RemoteTrustManager mirrors the TrustManager methods the scenarios use.
 */

import { decodePublicKey, encodePublicKey } from '@agentrust/node/identity'
import { waitForMesh } from './mesh.js'
import { waitUntil } from './timing.js'

const ROLE_ENV = {
  bootstrap: 'BOOTSTRAP_CONTROL_URL',
  issuer: 'ISSUER_CONTROL_URL',
  delegatee: 'DELEGATEE_CONTROL_URL',
  verifier: 'VERIFIER_CONTROL_URL',
  attacker: 'ATTACKER_CONTROL_URL'
}

async function call (baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status} from ${path}`)
  return payload
}

class RemoteTrustManager {
  constructor (baseUrl) {
    this.baseUrl = baseUrl
    this.registry = {
      isRevoked: async (tokenId) => (await call(baseUrl, 'GET', `/trust/revoked/${tokenId}`)).revoked
    }
  }

  issue (options) { return call(this.baseUrl, 'POST', '/trust/issue', options) }
  delegate (options) { return call(this.baseUrl, 'POST', '/trust/delegate', options) }
  verify (options) { return call(this.baseUrl, 'POST', '/trust/verify', options) }
  revoke (options) { return call(this.baseUrl, 'POST', '/trust/revoke', options) }

  async registerPeer (peerId, publicKey) {
    await call(this.baseUrl, 'POST', '/trust/register-peer', { peerId, publicKey: encodePublicKey(publicKey) })
  }
}

async function createRemoteAgent (role, baseUrl) {
  const up = await waitUntil(
    () => call(baseUrl, 'GET', '/health').then(() => true, () => false),
    60_000, performance.now(), 500
  )
  if (up === null) throw new Error(`Control API for '${role}' not reachable at ${baseUrl}`)

  const identity = await call(baseUrl, 'GET', '/status')
  return {
    role,
    peerId: identity.peerId,
    publicKey: decodePublicKey(identity.publicKey),
    trustManager: new RemoteTrustManager(baseUrl),
    status: () => call(baseUrl, 'GET', '/status'),
    sign: role === 'attacker'
      ? async (token) => (await call(baseUrl, 'POST', '/attack/sign', { token })).signature
      : undefined
  }
}

export async function createDockerAgents () {
  const agents = {}
  for (const [role, envName] of Object.entries(ROLE_ENV)) {
    const baseUrl = process.env[envName]
    if (!baseUrl) throw new Error(`${envName} is required when AGENTRUST_MODE=docker`)
    agents[role] = await createRemoteAgent(role, baseUrl)
  }
  await waitForMesh(agents)

  return { agents, stop: async () => {} }
}
