/**
 * delegation.js
 * AgentTrust — Delegation chain construction and verification.
 *
 * A delegation chain is an ordered array of capability tokens where each
 * token's issuer equals the previous token's subject. Any peer can verify
 * the full chain without contacting the original issuer.
 *
 * Spec: docs/PROTOCOL_SPEC.md §3
 */

import { verifyToken } from './capability.js'

// Maximum chain depth — keeps verification cost bounded
const MAX_CHAIN_DEPTH = 8

/**
 * Verify a delegation chain.
 *
 * @param {object[]}  chain           — ordered array of tokens (root first)
 * @param {string}    claimedSubject  — PeerID of the peer presenting the chain
 * @param {Function}  getPublicKey    — async (peerId: string) => PublicKey
 * @param {Set}       revocationSet   — set of revoked tokenIds
 * @returns {{ valid: boolean, reason: string, depth: number }}
 */
export async function verifyChain (chain, claimedSubject, getPublicKey, revocationSet) {
  if (!chain || chain.length === 0) {
    return { valid: false, reason: 'Empty chain', depth: 0 }
  }

  if (chain.length > MAX_CHAIN_DEPTH) {
    return {
      valid:  false,
      reason: `Chain depth ${chain.length} exceeds maximum ${MAX_CHAIN_DEPTH}`,
      depth:  chain.length
    }
  }

  // First token must be a root (no parent)
  if (chain[0].parentTokenId !== null) {
    return { valid: false, reason: 'First token in chain must be a root token (parentTokenId: null)', depth: chain.length }
  }

  for (let i = 0; i < chain.length; i++) {
    const token = chain[i]

    // Each token must individually pass signature + expiry + revocation checks
    const result = await verifyToken(token, getPublicKey, revocationSet)
    if (!result.valid) {
      return { valid: false, reason: `Token at index ${i}: ${result.reason}`, depth: chain.length }
    }

    // Chain linkage: each token's issuer must be the previous token's subject
    if (i > 0 && chain[i - 1].subject !== token.issuer) {
      return {
        valid:  false,
        reason: `Chain break at index ${i}: expected issuer ${chain[i - 1].subject}, got ${token.issuer}`,
        depth:  chain.length
      }
    }

    // ...and must reference the previous token as its parent
    if (i > 0 && chain[i - 1].tokenId !== token.parentTokenId) {
      return {
        valid:  false,
        reason: `Chain break at index ${i}: expected parentTokenId ${chain[i - 1].tokenId}, got ${token.parentTokenId}`,
        depth:  chain.length
      }
    }

    // All non-terminal tokens must be delegatable
    if (i < chain.length - 1 && !token.delegatable) {
      return {
        valid:  false,
        reason: `Token at index ${i} is not delegatable but chain continues`,
        depth:  chain.length
      }
    }
  }

  // Final token's subject must match the claiming peer
  const lastToken = chain[chain.length - 1]
  if (lastToken.subject !== claimedSubject) {
    return {
      valid:  false,
      reason: `Chain subject mismatch: expected ${claimedSubject}, got ${lastToken.subject}`,
      depth:  chain.length
    }
  }

  return { valid: true, reason: 'ok', depth: chain.length }
}

/**
 * Build a chain by appending a new delegated token to an existing chain.
 * Convenience function used by delegatee nodes.
 *
 * @param {object[]} existingChain  — the chain received from the previous peer
 * @param {object}   newToken       — the new delegation token to append
 * @returns {object[]}              — new chain with newToken appended
 */
export function extendChain (existingChain, newToken) {
  if (existingChain.length === 0) {
    throw new Error('Cannot extend an empty chain — start with a root token')
  }
  const last = existingChain[existingChain.length - 1]
  if (newToken.parentTokenId !== last.tokenId) {
    throw new Error(`New token parentTokenId (${newToken.parentTokenId}) does not match chain tail (${last.tokenId})`)
  }
  return [...existingChain, newToken]
}

/**
 * Summarise a chain for logging / debugging.
 * Returns a concise human-readable representation without exposing raw signatures.
 *
 * @param {object[]} chain
 * @returns {string}
 */
export function summariseChain (chain) {
  if (!chain || chain.length === 0) return '(empty chain)'
  return chain
    .map((t, i) => `[${i}] ${t.issuer.slice(0, 12)}… → ${t.subject.slice(0, 12)}… (${t.action})`)
    .join(' ➜ ')
}