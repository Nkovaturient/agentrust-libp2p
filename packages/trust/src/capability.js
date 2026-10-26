/**
 * capability.js
 * AgentTrust — Capability Token issuance and verification.
 *
 * A Capability Token is a signed assertion:
 *   "Peer <issuer> grants peer <subject> permission to perform <action>"
 *
 * Signing uses the Ed25519 keypair already present in every libp2p PeerID.
 * No new key infrastructure is needed.
 *
 * Spec: docs/PROTOCOL_SPEC.md §2
 */

import { randomUUID } from 'crypto'

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Produce a stable canonical JSON string for signing.
 * We sort keys lexicographically and exclude 'signature'.
 */
export function canonicalize (obj) {
  const copy = { ...obj }
  delete copy.signature
  return JSON.stringify(copy, Object.keys(copy).sort())
}

/**
 * Sign a capability token using a libp2p PrivateKey object.
 * @param {object}     tokenWithoutSig  — token fields minus 'signature'
 * @param {PrivateKey} privateKey       — libp2p Ed25519 private key
 * @returns {string}                    — base64url-encoded signature
 */
export async function signToken (tokenWithoutSig, privateKey) {
  const payload = new TextEncoder().encode(canonicalize(tokenWithoutSig))
  const sigBytes = await privateKey.sign(payload)
  return Buffer.from(sigBytes).toString('base64url')
}

/**
 * Verify a token's signature using the issuer's public key.
 * @param {object}    token      — full token including 'signature'
 * @param {PublicKey} publicKey  — libp2p Ed25519 public key of the issuer
 * @returns {boolean}
 */
export async function verifySignature (token, publicKey) {
  try {
    const payload  = new TextEncoder().encode(canonicalize(token))
    const sigBytes = Buffer.from(token.signature, 'base64url')
    return await publicKey.verify(payload, sigBytes)
  } catch {
    return false
  }
}

// ── Token Issuance ─────────────────────────────────────────────────────────

/**
 * Issue a new root capability token.
 *
 * @param {object} opts
 * @param {string}     opts.issuerPeerId   — PeerID string of the issuing node
 * @param {PrivateKey} opts.issuerKey      — Ed25519 private key of the issuer
 * @param {string}     opts.subjectPeerId  — PeerID string of the receiving peer
 * @param {string}     opts.action         — scoped action label, e.g. 'relay:forward'
 * @param {string}     [opts.scope]        — optional resource/context constraint
 * @param {boolean}    [opts.delegatable]  — can subject re-delegate this? (default: true)
 * @param {number}     [opts.ttlSeconds]   — time-to-live in seconds (default: 3600)
 * @returns {object}                        — signed capability token
 */
export async function issueCapability ({
  issuerPeerId,
  issuerKey,
  subjectPeerId,
  action,
  scope        = null,
  delegatable  = true,
  ttlSeconds   = 3600
}) {
  const now       = new Date()
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)

  const token = {
    version:       'agentrust/0.1',
    tokenId:       randomUUID(),
    issuer:        issuerPeerId,
    subject:       subjectPeerId,
    action,
    scope,
    issuedAt:      now.toISOString(),
    expiresAt:     expiresAt.toISOString(),
    delegatable,
    parentTokenId: null   // root token has no parent
  }

  token.signature = await signToken(token, issuerKey)
  return token
}

/**
 * Delegate an existing capability to a new subject.
 * The delegator must be the subject of the parent token and it must be delegatable.
 *
 * @param {object} opts
 * @param {object}     opts.parentToken      — the token being delegated
 * @param {string}     opts.delegatorPeerId  — must equal parentToken.subject
 * @param {PrivateKey} opts.delegatorKey     — Ed25519 private key of the delegator
 * @param {string}     opts.newSubjectPeerId — PeerID of the new recipient
 * @param {boolean}    [opts.delegatable]    — can new subject re-delegate? (default: false)
 * @param {number}     [opts.ttlSeconds]     — max TTL, capped at parent's remaining time
 * @returns {object}                          — signed delegated capability token
 */
export async function delegateCapability ({
  parentToken,
  delegatorPeerId,
  delegatorKey,
  newSubjectPeerId,
  delegatable  = false,
  ttlSeconds   = 1800
}) {
  if (!parentToken.delegatable) {
    throw new Error(`Token ${parentToken.tokenId} is not delegatable`)
  }
  if (parentToken.subject !== delegatorPeerId) {
    throw new Error('Delegator must be the subject of the parent token')
  }

  // Cap expiry at parent's expiry
  const parentExpiry = new Date(parentToken.expiresAt)
  const newExpiry    = new Date(Math.min(
    Date.now() + ttlSeconds * 1000,
    parentExpiry.getTime()
  ))

  const token = {
    version:       'agentrust/0.1',
    tokenId:       randomUUID(),
    issuer:        delegatorPeerId,
    subject:       newSubjectPeerId,
    action:        parentToken.action,   // inherits action from parent
    scope:         parentToken.scope,   // inherits scope
    issuedAt:      new Date().toISOString(),
    expiresAt:     newExpiry.toISOString(),
    delegatable,
    parentTokenId: parentToken.tokenId  // links to parent
  }

  token.signature = await signToken(token, delegatorKey)
  return token
}

// ── Token Verification ─────────────────────────────────────────────────────

/**
 * Verify a single token (signature, expiry, revocation).
 * Does NOT check the chain — use verifyChain() in delegation.js for that.
 *
 * @param {object}   token           — the token to verify
 * @param {Function} getPublicKey    — async (peerId: string) => PublicKey
 * @param {Set}      revocationSet   — set of revoked tokenIds
 * @returns {{ valid: boolean, reason: string }}
 */
export async function verifyToken (token, getPublicKey, revocationSet) {
  // 1. Revocation check
  if (revocationSet.has(token.tokenId)) {
    return { valid: false, reason: `Token ${token.tokenId} has been revoked` }
  }

  // 2. Expiry check
  if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
    return { valid: false, reason: `Token ${token.tokenId} has expired` }
  }

  // 3. Signature check
  const publicKey = await getPublicKey(token.issuer)
  if (!publicKey) {
    return { valid: false, reason: `Cannot resolve public key for issuer ${token.issuer}` }
  }

  const sigValid = await verifySignature(token, publicKey)
  if (!sigValid) {
    return { valid: false, reason: `Invalid signature on token ${token.tokenId}` }
  }

  return { valid: true, reason: 'ok' }
}