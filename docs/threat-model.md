# AgentTrust Threat Model

**Version:** 0.1.0  
**Status:** Living draft — extends as scenarios and adversarial tests grow

### Research focus (v0.1)

We **prove:** signed capabilities, delegation chains (≤ 8), offline verification, gossip-backed revocation, and **cryptographic** forgery rejection.

We **do not prove (yet):** economic Sybil resistance, global reputation, privacy-preserving verification, key rotation, or revocation under eclipse/partition.

---

## 1. System Model

We consider a libp2p network of N peers. Each peer has:
- A unique **PeerID** derived from an Ed25519 keypair
- A local **Revocation Registry** (in-memory)
- A **TrustManager** instance that can issue, verify, and revoke capability tokens

Peers communicate over:
- **Noise-encrypted streams** (libp2p Noise protocol) for direct capability exchange
- **GossipSub mesh** for revocation broadcast

**Experiment orchestration (Docker):** a runner may invoke **HTTP control APIs** on role containers to trigger `issue` / `delegate` / `verify` / `revoke`. That channel is **out of band** for trust: attackers in our model are not assumed to gain TLS/admin access to those ports. Trust artifacts remain signed tokens and signed revocation events on GossipSub.

---

## 2. Adversary Model

### 2.1 Capabilities of the Adversary

We assume an adversary who can:
- **Create arbitrarily many PeerIDs** (Sybil attack) at zero cost
- **Observe** all GossipSub messages (network is not fully private)
- **Delay** message delivery by up to some bounded time Δ (partial synchrony)
- **Drop** messages with probability p (lossy network)
- **Attempt to forge** capability tokens for keys they do not hold

We assume the adversary **cannot**:
- Break Ed25519 signatures (standard cryptographic assumption)
- Compromise the private key of a legitimate peer
- Control more than f < N/3 peers simultaneously (for liveness arguments)

### 2.2 Attack Scenarios Tested in Experiments

| Attack | Scenario | Expected Defence |
|---|---|---|
| Token forgery | `scenario-03-sybil-probe` | Signature verification rejects — PASS |
| Revoked token replay | `scenario-02-revocation-timing` | Revocation registry blocks — PASS |
| Delegation forgery (non-delegatable token re-used) | `scenario-03-sybil-probe` | Chain check rejects — PASS |
| Sybil eclipse of revocation broadcast | Not in v0.1 test suite | Documented gap — GossipSub ≠ guaranteed delivery |
| Broken chain linkage / wrong parent | `scenario-04` (planned harness) | `verifyChain` rejects |
| Concurrent revocations | `scenario-05` | Both IDs in registry before reject |

---

## 3. Trust Assumptions

- **Issuers are trusted** at the root. If the root issuer is compromised, all its tokens and descendants are compromised. This is analogous to a CA compromise and is noted as a limitation.
- **GossipSub mesh** provides eventual delivery of revocations, but does not guarantee timing bounds in adversarial conditions.
- **PeerID freshness** is not verified — a peer could reuse an old PeerID. Identity continuity is out of scope for this prototype.

---

## 4. Limitations Acknowledged

1. **Economic Sybil resistance** (staking, PoW) is not implemented. An attacker can generate unlimited PeerIDs, each with a valid keypair, and request legitimate capabilities.

2. **Revocation propagation delay** means there is a window between revocation issuance and universal propagation during which a revoked token may be accepted.

3. **No ZK privacy.** A verifier sees the full delegation chain, including intermediate peer identities. Privacy-preserving verification (e.g., via zk-SNARKs) is future work.

4. **In-memory state.** A node restart clears its revocation registry, temporarily opening a replay window.

---

## 5. What This Prototype Does NOT Claim

- It does not claim to provide production-grade security.
- It does not claim to solve the identity continuity problem.
- It does not claim to implement anonymous or private trust.
- It does not claim economic Sybil resistance.

These are research gaps that the paper identifies and proposes as future directions.