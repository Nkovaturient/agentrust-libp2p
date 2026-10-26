/**
 * controlServer.js
 * AgentTrust — HTTP control API used by the experiment runner in the Docker testnet.
 *
 * Experiment orchestration only, not a production API: it is unauthenticated
 * and only reachable on the private compose network.
 */

import { createServer } from 'http'
import { signToken } from '@agentrust/trust/capability'
import { decodePublicKey, encodePublicKey } from './identity.js'
import { nodeStatus } from './nodeStatus.js'

const MAX_BODY_BYTES = 1_000_000

async function readJson (req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large')
    chunks.push(chunk)
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
}

export function startControlServer ({ role, port, libp2p, peerId, privateKey, trustManager }) {
  const status = () => ({
    role,
    peerId,
    publicKey: encodePublicKey(privateKey.publicKey),
    ...nodeStatus(libp2p)
  })

  const routes = {
    'GET /health': () => ({ ok: true }),
    'GET /status': status,
    'POST /trust/issue': (body) => trustManager.issue(body),
    'POST /trust/delegate': (body) => trustManager.delegate(body),
    'POST /trust/verify': (body) => trustManager.verify(body),
    'POST /trust/revoke': async (body) => {
      await trustManager.revoke(body)
      return { ok: true }
    },
    'POST /trust/register-peer': (body) => {
      trustManager.registerPeer(body.peerId, decodePublicKey(body.publicKey))
      return { ok: true }
    }
  }

  if (role === 'attacker') {
    routes['POST /attack/sign'] = async ({ token }) => ({ signature: await signToken(token, privateKey) })
  }

  const server = createServer(async (req, res) => {
    const send = (code, payload) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }

    try {
      const revoked = req.url.match(/^\/trust\/revoked\/([\w-]+)$/)
      if (req.method === 'GET' && revoked) {
        return send(200, { revoked: trustManager.registry.isRevoked(revoked[1]) })
      }

      const handler = routes[`${req.method} ${req.url}`]
      if (!handler) return send(404, { error: `No route for ${req.method} ${req.url}` })

      send(200, await handler(req.method === 'POST' ? await readJson(req) : undefined))
    } catch (err) {
      send(400, { error: err.message })
    }
  })

  server.listen(port, '0.0.0.0')
  return server
}
