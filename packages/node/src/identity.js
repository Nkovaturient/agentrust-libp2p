/**
 * identity.js
 * AgentTrust — Node identity helpers.
 *
 * Testnet nodes derive a stable Ed25519 key from a public seed label
 * (AGENTRUST_KEY_SEED) so every PeerID is reproducible across runs.
 * Seeds are NOT secrets and must never be used outside the testnet.
 */

import { createHash } from 'crypto'
import {
  generateKeyPairFromSeed,
  publicKeyFromProtobuf,
  publicKeyToProtobuf
} from '@libp2p/crypto/keys'

export function deriveKeyFromSeed (seed) {
  return generateKeyPairFromSeed('Ed25519', createHash('sha256').update(seed).digest())
}

export async function loadPrivateKeyFromEnv () {
  const seed = process.env.AGENTRUST_KEY_SEED
  return seed ? deriveKeyFromSeed(seed) : undefined
}

export function encodePublicKey (publicKey) {
  return Buffer.from(publicKeyToProtobuf(publicKey)).toString('base64')
}

export function decodePublicKey (encoded) {
  return publicKeyFromProtobuf(Buffer.from(encoded, 'base64'))
}
