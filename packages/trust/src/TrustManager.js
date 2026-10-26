/**
 * TrustManager.js
 * AgentTrust — Unified trust management facade.
 *
 * Each libp2p node instantiates one TrustManager.
 * It wraps capability issuance, delegation chain verification,
 * and revocation into a single, clean API.
 *
 * Usage:
 *   const tm = new TrustManager({ peerId, privateKey, libp2p })
 *   await tm.start()
 *
 *   const token = await tm.issue({ subject, action })
 *   const chain = await tm.delegate({ parentChain, newSubject })
 *   const { valid } = await tm.verify({ chain, claimedSubject })
 *   await tm.revoke({ tokenId })
 */

import {
    issueCapability,
    delegateCapability,
    verifyToken
  } from './capability.js'
  
  import { verifyChain, extendChain, summariseChain } from './delegation.js'
  
  import {
    createRevocationRegistry,
    createRevocationEvent,
    broadcastRevocation,
    subscribeToRevocations
  } from './revocation.js'
  
  export class TrustManager {
    /**
     * @param {object} opts
     * @param {string}     opts.peerId      — string PeerID of this node
     * @param {PrivateKey} opts.privateKey  — Ed25519 private key of this node
     * @param {object}     opts.libp2p     — libp2p node instance
     */
    constructor ({ peerId, privateKey, libp2p }) {
      this.peerId     = peerId
      this.privateKey = privateKey
      this.libp2p     = libp2p
      this.registry   = createRevocationRegistry()
  
      // Peer public key cache: peerId (string) → PublicKey
      // Populated as peers connect or send tokens.
      this._publicKeys = new Map()
    }
  
    // ── Lifecycle ──────────────────────────────────────────────────────────
  
    /**
     * Start the TrustManager: subscribe to revocation broadcasts.
     */
    async start () {
      subscribeToRevocations(
        this.libp2p,
        this.registry,
        (peerId) => this._resolvePublicKey(peerId),
        (event) => {
          console.log(`[TrustManager:${this._shortId()}] Revocation received: ${event.tokenId} (by ${event.revokedBy.slice(0, 12)}…)`)
        }
      )
      console.log(`[TrustManager:${this._shortId()}] Started. Subscribed to revocations.`)
    }
  
    // ── Public Key Resolution ──────────────────────────────────────────────
  
    /**
     * Register a peer's public key (called when a peer connects or sends a token).
     * @param {string}    peerId
     * @param {PublicKey} publicKey
     */
    registerPeer (peerId, publicKey) {
      this._publicKeys.set(peerId, publicKey)
    }
  
    async _resolvePublicKey (peerId) {
      return this._publicKeys.get(peerId) ?? null
    }
  
    // ── Capability Issuance ────────────────────────────────────────────────
  
    /**
     * Issue a root capability token to a subject peer.
     * @param {object} opts — see issueCapability() in capability.js
     * @returns {object[]}  — a chain containing just this root token
     */
    async issue ({ subjectPeerId, action, scope, delegatable, ttlSeconds }) {
      const token = await issueCapability({
        issuerPeerId: this.peerId,
        issuerKey:    this.privateKey,
        subjectPeerId,
        action,
        scope,
        delegatable,
        ttlSeconds
      })
      console.log(`[TrustManager:${this._shortId()}] Issued token ${token.tokenId.slice(0, 8)}… → ${subjectPeerId.slice(0, 12)}… (${action})`)
      return [token] // returns as a chain (root-only)
    }
  
    // ── Delegation ─────────────────────────────────────────────────────────
  
    /**
     * Extend a received chain by delegating to a new subject.
     * This node must be the current chain's last subject.
     *
     * @param {object[]} parentChain
     * @param {string}   newSubjectPeerId
     * @param {boolean}  [delegatable=false]
     * @param {number}   [ttlSeconds=1800]
     * @returns {object[]} — extended chain
     */
    async delegate ({ parentChain, newSubjectPeerId, delegatable = false, ttlSeconds = 1800 }) {
      const parentToken = parentChain[parentChain.length - 1]
  
      const newToken = await delegateCapability({
        parentToken,
        delegatorPeerId:  this.peerId,
        delegatorKey:     this.privateKey,
        newSubjectPeerId,
        delegatable,
        ttlSeconds
      })
  
      const extended = extendChain(parentChain, newToken)
      console.log(`[TrustManager:${this._shortId()}] Delegated → ${newSubjectPeerId.slice(0, 12)}… | chain: ${summariseChain(extended)}`)
      return extended
    }
  
    // ── Verification ───────────────────────────────────────────────────────
  
    /**
     * Verify a delegation chain presented by a peer.
     * @param {object[]} chain
     * @param {string}   claimedSubject — PeerID of the presenting peer
     * @returns {{ valid: boolean, reason: string, depth: number }}
     */
    async verify ({ chain, claimedSubject }) {
      const result = await verifyChain(
        chain,
        claimedSubject,
        (peerId) => this._resolvePublicKey(peerId),
        this.registry.asSet()
      )
      console.log(`[TrustManager:${this._shortId()}] Verify chain from ${claimedSubject.slice(0, 12)}…: ${result.valid ? '✅ VALID' : '❌ INVALID'} — ${result.reason}`)
      return result
    }
  
    // ── Revocation ─────────────────────────────────────────────────────────
  
    /**
     * Revoke a token this node issued. Broadcasts via GossipSub.
     * @param {string} tokenId
     * @param {string} [reason]
     */
    async revoke ({ tokenId, reason = '' }) {
      const event = await createRevocationEvent({
        tokenId,
        revokerPeerId: this.peerId,
        revokerKey:    this.privateKey,
        reason
      })
      this.registry.record(event) // record locally first
      await broadcastRevocation(this.libp2p, event)
      console.log(`[TrustManager:${this._shortId()}] Revoked token ${tokenId.slice(0, 8)}… | reason: "${reason}"`)
    }
  
    // ── Helpers ────────────────────────────────────────────────────────────
  
    /**
     * Returns registry stats (for experiment logging).
     */
    stats () {
      return {
        peerId:          this.peerId,
        revokedCount:    this.registry.size(),
        knownPeers:      this._publicKeys.size
      }
    }
  
    _shortId () {
      return this.peerId.slice(0, 10) + '…'
    }
  }