/**
 * sybil.js
 * AgentTrust — Sybil resistance utilities.
 *
 * Currently implements CRYPTOGRAPHIC Sybil resistance only:
 *   - Detects when a token's claimed issuer PeerID does not match
 *     the key that produced the signature (forgery detection).
 *
 * ECONOMIC Sybil resistance (staking, PoW) is NOT implemented.
 * It is documented as future work in the paper §7.2.
 */

/**
 * Attempt to detect if a token is a forgery:
 * the claimed issuer PeerID does not match the signing key.
 *
 * This is called automatically inside verifyToken() in capability.js
 * via the signature check — if the key doesn't match the PeerID,
 * the Ed25519 signature verification will fail.
 *
 * This function provides an explicit, named entry point for the
 * scenario-03 experiment to make the detection path clear in logs.
 *
 * @param {object}   token        — capability token to probe
 * @param {Function} getPublicKey — async (peerId) => PublicKey
 * @returns {{ isForgery: boolean, reason: string }}
 */
export async function probeForgery (token, getPublicKey) {
    const publicKey = await getPublicKey(token.issuer)
    if (!publicKey) {
      return { isForgery: true, reason: `Unknown issuer: ${token.issuer}` }
    }
  
    try {
      const { canonicalize } = await import('./capability.js')
      const payload  = new TextEncoder().encode(canonicalize(token))
      const sigBytes = Buffer.from(token.signature, 'base64url')
      const valid    = await publicKey.verify(payload, sigBytes)
      return valid
        ? { isForgery: false, reason: 'Signature valid — not a forgery' }
        : { isForgery: true,  reason: 'Signature mismatch — key does not match claimed issuer' }
    } catch (err) {
      return { isForgery: true, reason: `Verification error: ${err.message}` }
    }
  }