/**
 * revocation.js
 * AgentTrust — Revocation Registry and GossipSub broadcast.
 *
 * When a token is revoked:
 *   1. A signed RevocationEvent is created by the original issuer
 *   2. It is broadcast via GossipSub on /agentrust/1.0.0/revocations
 *   3. Every node receiving it adds the tokenId to its local registry
 *   4. All future verifications check the registry first
 *
 * Spec: docs/PROTOCOL_SPEC.md §4
 */

import { canonicalize } from './capability.js'

export const REVOCATION_TOPIC = '/agentrust/1.0.0/revocations'

// ── Revocation Registry ───────────────────────────────────────────────────

/**
 * Create a new in-memory Revocation Registry.
 * Returns a plain object with the registry API.
 */
export function createRevocationRegistry () {
  // Map: tokenId → RevocationEvent
  const store = new Map()

  return {
    /**
     * Check if a tokenId has been revoked.
     * @param {string} tokenId
     * @returns {boolean}
     */
    isRevoked (tokenId) {
      return store.has(tokenId)
    },

    /**
     * Get the revocation event for a tokenId (if any).
     * @param {string} tokenId
     * @returns {object|null}
     */
    getEvent (tokenId) {
      return store.get(tokenId) ?? null
    },

    /**
     * Record a revocation event (after signature verification).
     * @param {object} event — RevocationEvent
     * @returns {boolean} — true if newly added, false if already known
     */
    record (event) {
      if (store.has(event.tokenId)) return false
      store.set(event.tokenId, event)
      return true
    },

    /**
     * Return all revoked tokenIds (useful for full-state sync).
     * @returns {string[]}
     */
    allRevokedIds () {
      return [...store.keys()]
    },

    /**
     * Return a Set of all revoked tokenIds (passed directly to verifyToken).
     * @returns {Set<string>}
     */
    asSet () {
      return new Set(store.keys())
    },

    size () {
      return store.size
    }
  }
}

// ── RevocationEvent Construction ──────────────────────────────────────────

/**
 * Create and sign a RevocationEvent.
 * Only the original issuer of a token may revoke it.
 *
 * @param {object} opts
 * @param {string}     opts.tokenId       — tokenId to revoke
 * @param {string}     opts.revokerPeerId — must be the original issuer
 * @param {PrivateKey} opts.revokerKey    — Ed25519 private key
 * @param {string}     [opts.reason]      — human-readable reason
 * @returns {object}                       — signed RevocationEvent
 */
export async function createRevocationEvent ({ tokenId, revokerPeerId, revokerKey, reason = '' }) {
  const event = {
    version:   'agentrust/0.1',
    type:      'revocation',
    tokenId,
    revokedBy: revokerPeerId,
    reason,
    timestamp: new Date().toISOString()
  }

  const payload  = new TextEncoder().encode(canonicalize(event))
  const sigBytes = await revokerKey.sign(payload)
  event.signature = Buffer.from(sigBytes).toString('base64url')

  return event
}

/**
 * Verify a RevocationEvent's signature.
 * @param {object}   event      — RevocationEvent including signature
 * @param {Function} getPublicKey — async (peerId: string) => PublicKey
 * @returns {{ valid: boolean, reason: string }}
 */
export async function verifyRevocationEvent (event, getPublicKey) {
  try {
    const publicKey = await getPublicKey(event.revokedBy)
    if (!publicKey) {
      return { valid: false, reason: `Cannot resolve public key for ${event.revokedBy}` }
    }
    const payload  = new TextEncoder().encode(canonicalize(event))
    const sigBytes = Buffer.from(event.signature, 'base64url')
    const ok       = await publicKey.verify(payload, sigBytes)
    return ok
      ? { valid: true, reason: 'ok' }
      : { valid: false, reason: 'Signature verification failed' }
  } catch (err) {
    return { valid: false, reason: `Error: ${err.message}` }
  }
}

// ── GossipSub Integration ─────────────────────────────────────────────────

/**
 * Broadcast a RevocationEvent via GossipSub.
 * @param {object} libp2p   — libp2p node instance
 * @param {object} event    — signed RevocationEvent
 */
export async function broadcastRevocation (libp2p, event) {
  const encoded = new TextEncoder().encode(JSON.stringify(event))
  await libp2p.services.pubsub.publish(REVOCATION_TOPIC, encoded)
}

/**
 * Subscribe to revocation events on GossipSub.
 * Incoming events are verified and recorded in the local registry.
 *
 * @param {object}   libp2p     — libp2p node instance
 * @param {object}   registry   — RevocationRegistry from createRevocationRegistry()
 * @param {Function} getPublicKey — async (peerId: string) => PublicKey
 * @param {Function} [onRevoke]   — optional callback(event) when a new revocation is recorded
 */
export function subscribeToRevocations (libp2p, registry, getPublicKey, onRevoke) {
  libp2p.services.pubsub.subscribe(REVOCATION_TOPIC)

  libp2p.services.pubsub.addEventListener('message', async (msg) => {
    if (msg.detail.topic !== REVOCATION_TOPIC) return

    let event
    try {
      event = JSON.parse(new TextDecoder().decode(msg.detail.data))
    } catch {
      return // malformed — ignore
    }

    if (event.type !== 'revocation') return

    const { valid } = await verifyRevocationEvent(event, getPublicKey)
    if (!valid) return // invalid signature — ignore

    const isNew = registry.record(event)
    if (isNew && onRevoke) {
      onRevoke(event)
    }
  })
}