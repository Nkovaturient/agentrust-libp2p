# AgentTrust Protocol Specification

**Version:** 0.1.0 (Research Prototype)  
**Status:** Living draft — updated as experiments run; not a frozen RFC  
**Authors:** Nkovaturient (Neha Kumari)
**Co-author:** Cursor(models)-assisted

### Scope (Track 4 mapping)

| Theme | In spec / code | Measured in experiments (target) |
|-------|----------------|-------------------------------------|
| Capabilities | §2 | Scenarios 01–05 |
| Delegated trust | §3 (max depth 8) | 01 depth sweep; 04 integrity |
| Verifiable authorization | §2.3, §3.3 | Verify without issuer network contact |
| Revocation | §4 | 02, 05 (+ Docker gossip path) |
| Crypto Sybil (forgery) | §5 | 03 |
| Reputation | Topic reserved §6 | **Not in v0.1** |
| Identity continuity | — | **Not in v0.1** (key rotation breaks tokens) |
| Privacy / ZK | §7 | **Not in v0.1** |

**Out of trust boundary:** HTTP endpoints used only to **orchestrate** multi-container experiment runs (issue/delegate/verify/revoke commands). They are not part of the authorization protocol and must not be deployed as a production API.

---

## 1. Overview

AgentTrust defines a lightweight, cryptographically verifiable trust protocol layered atop js-libp2p. It introduces three primitives:

1. **Capability Token** — a signed assertion that peer X has permission to perform action Y
2. **Delegation Chain** — a linked list of tokens proving that permission was transitively granted
3. **Revocation Event** — a signed notice that a token (and all its descendants) is no longer valid

All primitives use the Ed25519 keypairs already present in every libp2p PeerID. No new key infrastructure is required.

---

## 2. Capability Token

### 2.1 Structure

A Capability Token is a JSON object with the following fields:

```json
{
  "version": "agentrust/0.1",
  "tokenId":  "<uuid-v4>",
  "issuer":   "<PeerID of the issuing node>",
  "subject":  "<PeerID of the peer receiving the capability>",
  "action":   "<string — scoped action label, e.g. 'relay:forward'>",
  "scope":    "<optional string — resource or context constraint>",
  "issuedAt": "<ISO 8601 timestamp>",
  "expiresAt":"<ISO 8601 timestamp or null>",
  "delegatable": true | false,
  "parentTokenId": "<tokenId of parent or null if root>",
  "signature": "<base64url-encoded Ed25519 signature over canonical payload>"
}
```

### 2.2 Canonical Payload for Signing

The signature is computed over the UTF-8 bytes of the JSON-serialised object **excluding** the `signature` field, with keys sorted lexicographically:

```
SIGN( Ed25519_private_key_of_issuer,
      JSON.stringify(token_without_signature, sorted_keys) )
```

### 2.3 Token Verification

A verifier checks:
1. `issuer` PeerID matches the public key used to verify `signature` ✓
2. Signature is valid ✓
3. `expiresAt` has not passed ✓
4. `tokenId` is not present in the local Revocation Registry ✓
5. If `parentTokenId` is set, the parent token also passes all checks ✓ (recursive)
6. `subject` matches the PeerID of the peer presenting the token ✓

---

## 3. Delegation Chain

### 3.1 Structure

A Delegation Chain is an ordered array of Capability Tokens:

```json
[
  { /* root token: issuer=A, subject=B, parentTokenId=null */ },
  { /* delegated token: issuer=B, subject=C, parentTokenId=<root.tokenId> */ }
]
```

### 3.2 Chain Validity Rules

- The first token in the chain must have `parentTokenId: null` (root)
- Each subsequent token's `issuer` must equal the previous token's `subject`
- Each token must individually pass all verification checks (§2.3)
- Each token except the last must have `delegatable: true`
- Maximum chain depth: **8 hops** (implementation limit to bound verification cost)

### 3.3 Verification Algorithm

```
function verifyChain(chain, claimedSubject):
  if chain is empty → REJECT
  if chain.length > 8 → REJECT
  for i = 0 to chain.length - 1:
    token = chain[i]
    if not verifyToken(token) → REJECT
    if i > 0 and chain[i-1].subject != token.issuer → REJECT
    if i < chain.length - 1 and token.delegatable == false → REJECT
  if chain.last.subject != claimedSubject → REJECT
  return ACCEPT
```

---

## 4. Revocation

### 4.1 Revocation Event Structure

```json
{
  "version":   "agentrust/0.1",
  "type":      "revocation",
  "tokenId":   "<tokenId being revoked>",
  "revokedBy": "<PeerID of the revoker — must be the original issuer>",
  "reason":    "<optional human-readable string>",
  "timestamp": "<ISO 8601>",
  "signature": "<Ed25519 signature by revokedBy over canonical payload>"
}
```

### 4.2 Propagation

Revocation events are broadcast via GossipSub on the topic:

```
/agentrust/1.0.0/revocations
```

Every node maintains a local **Revocation Registry** (in-memory map: `tokenId → RevocationEvent`). On receiving a revocation event, a node:

1. Verifies the signature (signer must be the `issuer` of the original token)
2. Adds `tokenId` to its local registry
3. Propagates via GossipSub (handled by GossipSub mesh automatically)

**Cascade revocation:** Revoking a token also implicitly invalidates all tokens whose `parentTokenId` chains back to it. Verifiers check the entire chain.

### 4.3 Revocation Timing (Research Question)

Experiments record **wall-clock propagation** until a verifier’s local registry contains the `tokenId` (scenario 02, 05). We report numbers from **local in-process** and **multi-container Docker** runs separately. Docker measures **separate libp2p processes**, not geographic WAN delay. Formal round counts and adversarial eclipse tests are **future work** (see `threat-model.md`).

---

## 5. Sybil Resistance

### 5.1 Threat Model (brief)

An attacker creates many PeerIDs (Sybil nodes) and attempts to:
- **Forge** a capability token (cannot — requires the issuer's Ed25519 private key)
- **Replay** a revoked token (fails — revocation registry blocks it)
- **Eclipse** the revocation broadcast (partially mitigated by GossipSub mesh fanout)

### 5.2 Prototype Limitation

This prototype implements **cryptographic Sybil resistance** (forgery is impossible) but **not economic Sybil resistance** (an attacker can still create many valid PeerIDs at zero cost). Full Sybil resistance requires staking or proof-of-work, which is noted as future work.

---

## 6. GossipSub Topics

| Topic | Purpose |
|---|---|
| `/agentrust/1.0.0/revocations` | Broadcast revocation events |
| `/agentrust/1.0.0/trust-gossip` | Optional: peer reputation observations |

---

## 7. Limitations and Non-Goals (Honest)

- **No zero-knowledge proofs in this prototype.** ZK-based reputation (hiding the trust chain while proving membership) is a design goal described in the paper's Future Work section. It is not implemented.
- **No persistent storage.** All trust state is in-memory. Crashes lose state.
- **No cross-chain or cross-protocol interoperability.** Tokens are AgentTrust-specific.
- **Max 8-hop chains.** Deeper chains are rejected to bound verification cost.
- **No token rotation protocol.** Expiry is enforced but rotation is manual.

---

## 8. Protocol ID

```
/agentrust/1.0.0
```

Used as the libp2p stream protocol ID for direct peer-to-peer capability exchange (distinct from GossipSub broadcast).