/**
 * capability.test.js
 * Unit tests for token issuance, signing, and verification.
 * Run with: npm test
 */

import { generateKeyPair }       from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey }  from '@libp2p/peer-id'
import {
  issueCapability,
  delegateCapability,
  verifyToken,
  canonicalize
} from '../src/capability.js'

describe('canonicalize()', () => {
  test('produces stable output regardless of key insertion order', () => {
    const a = canonicalize({ z: 1, a: 2, m: 3, signature: 'x' })
    const b = canonicalize({ a: 2, m: 3, z: 1, signature: 'x' })
    expect(a).toBe(b)
    expect(a).not.toContain('signature')
  })
})

describe('issueCapability()', () => {
  let issuerKey, issuerPeerId, subjectKey, subjectPeerId

  beforeAll(async () => {
    issuerKey    = await generateKeyPair('Ed25519')
    issuerPeerId = (await peerIdFromPrivateKey(issuerKey)).toString()
    subjectKey   = await generateKeyPair('Ed25519')
    subjectPeerId = (await peerIdFromPrivateKey(subjectKey)).toString()
  })

  test('issues a valid root token', async () => {
    const [token] = await issueCapabilityChain({ issuerKey, issuerPeerId, subjectPeerId })
    expect(token.version).toBe('agentrust/0.1')
    expect(token.issuer).toBe(issuerPeerId)
    expect(token.subject).toBe(subjectPeerId)
    expect(token.parentTokenId).toBeNull()
    expect(token.signature).toBeTruthy()
  })

  test('signature verifies with issuer public key', async () => {
    const token = await issueCapability({
      issuerPeerId, issuerKey, subjectPeerId,
      action: 'relay:forward', ttlSeconds: 3600
    })
    const revoked = new Set()
    const getKey  = async (id) => id === issuerPeerId ? issuerKey.publicKey : null
    const result  = await verifyToken(token, getKey, revoked)
    expect(result.valid).toBe(true)
  })

  test('rejects token with wrong public key', async () => {
    const token  = await issueCapability({
      issuerPeerId, issuerKey, subjectPeerId,
      action: 'relay:forward', ttlSeconds: 3600
    })
    const fakeKey = await generateKeyPair('Ed25519')
    const getKey  = async () => fakeKey.publicKey   // wrong key
    const revoked = new Set()
    const result  = await verifyToken(token, getKey, revoked)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/Invalid signature/)
  })

  test('rejects expired token', async () => {
    const token  = await issueCapability({
      issuerPeerId, issuerKey, subjectPeerId,
      action: 'relay:forward', ttlSeconds: -1   // already expired
    })
    const getKey  = async () => issuerKey.publicKey
    const revoked = new Set()
    const result  = await verifyToken(token, getKey, revoked)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/expired/)
  })

  test('rejects revoked token', async () => {
    const token  = await issueCapability({
      issuerPeerId, issuerKey, subjectPeerId,
      action: 'relay:forward', ttlSeconds: 3600
    })
    const getKey  = async () => issuerKey.publicKey
    const revoked = new Set([token.tokenId])    // mark as revoked
    const result  = await verifyToken(token, getKey, revoked)
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/revoked/)
  })
})

describe('delegateCapability()', () => {
  test('throws when parent is not delegatable', async () => {
    const k1  = await generateKeyPair('Ed25519')
    const p1  = (await peerIdFromPrivateKey(k1)).toString()
    const k2  = await generateKeyPair('Ed25519')
    const p2  = (await peerIdFromPrivateKey(k2)).toString()
    const k3  = await generateKeyPair('Ed25519')
    const p3  = (await peerIdFromPrivateKey(k3)).toString()

    const parent = await issueCapability({
      issuerPeerId: p1, issuerKey: k1, subjectPeerId: p2,
      action: 'compute:run', delegatable: false, ttlSeconds: 3600
    })

    await expect(
      delegateCapability({
        parentToken: parent, delegatorPeerId: p2, delegatorKey: k2,
        newSubjectPeerId: p3
      })
    ).rejects.toThrow(/not delegatable/)
  })
})

// ── Helper ───────────────────────────────────────────────────────────────
async function issueCapabilityChain ({ issuerKey, issuerPeerId, subjectPeerId }) {
  const token = await issueCapability({
    issuerPeerId, issuerKey, subjectPeerId,
    action: 'test:action', ttlSeconds: 3600
  })
  return [token]
}