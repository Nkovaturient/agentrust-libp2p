/**
 * Regenerates docker/config/<role>.env for the 5-node testnet.
 *
 * Every node derives its key from a public seed label, so PeerIDs are stable
 * and BOOTSTRAP_ADDR can be written down in advance. Testnet only — never reuse
 * these identities elsewhere.
 *
 * Usage: npm run docker:env
 */

import { mkdirSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { deriveKeyFromSeed } from '@agentrust/node/identity'

const ROLES = ['bootstrap', 'issuer', 'delegatee', 'verifier', 'attacker']
const BOOTSTRAP_HOST = '172.28.0.10'
const BOOTSTRAP_PORT = 9000

const configDir = resolve(dirname(fileURLToPath(import.meta.url)), '../config')
mkdirSync(configDir, { recursive: true })

const bootstrapKey = await deriveKeyFromSeed('agentrust-testnet-bootstrap')
const bootstrapPeerId = peerIdFromPrivateKey(bootstrapKey).toString()
const bootstrapAddr = `/ip4/${BOOTSTRAP_HOST}/tcp/${BOOTSTRAP_PORT}/ws/p2p/${bootstrapPeerId}`

for (const role of ROLES) {
  const lines = [
    '# Testnet-only identity seed (a public label, not a secret). Regenerate with: npm run docker:env',
    `AGENTRUST_KEY_SEED=agentrust-testnet-${role}`
  ]
  if (role !== 'bootstrap') lines.push(`BOOTSTRAP_ADDR=${bootstrapAddr}`)

  writeFileSync(resolve(configDir, `${role}.env`), `${lines.join('\n')}\n`)
  console.log(`wrote docker/config/${role}.env`)
}
console.log(`bootstrap PeerID: ${bootstrapPeerId}`)
