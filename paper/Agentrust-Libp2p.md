# AgentTrust: Decentralised Capability Delegation and Revocation for Autonomous libp2p Nodes

**Author:** Neha Kumari 
**Track:** Track 4 — Agentic Trust Structures  
**Submission:** Libp2p2035: Resilient Networking Research Track · Devcon 8 Mumbai 2026  
**Repo:** https://github.com/Nkovaturient/agentrust-libp2p  
**Status:** Draft — PoC, five measured scenarios, and Docker testnet are in the repo; reputation, economic Sybil resistance, and zero-knowledge proofs are design-only  

<img width="2172" height="724" alt="ChatGPT Image Oct 27, 2026, 04_49_40 PM" src="https://github.com/user-attachments/assets/01fb231c-4ee2-4aeb-8d8d-57cf4a8550d9" />


---

## Abstract

As peer-to-peer networks evolve to host autonomous agents rather than passive data-sharing nodes, the question of inter-node trust becomes critical: 

> how does a node know that another node is genuinely authorised to perform an action, without consulting a central authority? 

Existing libp2p infrastructure provides strong *identity* (via Ed25519 PeerIDs and the Noise protocol) but no native mechanism for *authorisation*. 

- I present **AgentTrust**, a lightweight trust layer for libp2p that introduces signed capability tokens, transitive delegation chains, gossip-propagated revocation, and cryptographic Sybil resistance — all built exclusively on primitives already present in the js-libp2p stack. 

  - We describe the protocol design, implement a proof-of-concept in JavaScript on Node.js, and evaluate it across five experiment scenarios on a five-node local mesh and a five-container Docker Compose testnet. 
  - In my measurements, delegation chains of depth 1 to 8 verify at roughly 0.05 ms per token while the verifier holds no connection to the issuer, and depth 9 is rejected; revocations reach a verifier in a few milliseconds on a single host; and the three forgery, chain-theft, and non-delegatable-extension attempts we ran were all rejected. 
  - The experiments also exposed a missing parent-link check in chain verification, which is now fixed. 
  - We identify economic Sybil resistance, reputation, identity continuity, and zero-knowledge reputation as open problems aligned with libp2p’s own security guidance (authorization and Sybil mitigations live above the transport layer [libp2pSec]). 
  
- Track 4 scope for this submission: **capabilities, delegated chains, verifiable authorization, gossip revocation, and cryptographic forgery resistance** — not a full eight-pillar trust stack in one PoC.


## 1. Introduction

Modern libp2p deployments — from IPFS to Ethereum's consensus layer — authenticate peers via their PeerID, a self-certifying identifier derived from an Ed25519 public key. This gives each node a stable, unforgeable identity. However, identity is not the same as authorisation. A peer knowing *who* another peer is tells it nothing about *what* that peer is permitted to do.

This gap becomes acute when nodes are autonomous agents rather than human-operated clients. Consider a mesh of AI inference nodes where node A has been granted the right to execute workloads, and wishes to delegate a subset of that right to node B for a bounded period. There is no standard libp2p mechanism for A to convey this grant, for B to prove it to a third node C, or for the original granter to revoke it if node B is later compromised.

Prior work on decentralised authorisation (UCAN [UCAN2023], capability-based security [Miller2003], object-capability models [Hardy1988]) provides theoretical foundations, but these have not been integrated with the libp2p stack in a form that is lightweight, revocable, and compatible with GossipSub-based dissemination.

**This paper contributes:**
1. A protocol specification for capability tokens natively compatible with libp2p PeerIDs and Ed25519 keypairs (§3).
2. A delegation chain format that allows any node to verify a transitive grant without contacting the original issuer (§3).
3. A GossipSub-based revocation mechanism with measured propagation characteristics (§4, §6).
4. A proof-of-concept implementation in JavaScript on Node.js with a five-node Docker Compose testnet (§5).
5. Five reproducible experiment scenarios covering delegation, revocation, and Sybil resistance (§6).
6. An honest analysis of limitations and future directions, including zero-knowledge reputation (§7).


## 2. Related Work

i. **Capability-based security** was formalised by Miller et al. [Miller2003] and operationalised in systems such as the E language and later object-capability models for distributed systems. UCAN (User-Controlled Authorisation Networks) [UCAN2023] applies capability tokens to decentralised identity contexts, particularly in the IPFS/Filecoin ecosystem. my work is directly inspired by UCAN's token format but adapts it to libp2p PeerIDs and integrates revocation via GossipSub rather than through a separate channel.

ii. **libp2p identity and security.** The Noise protocol framework [Perrin2018], as implemented in libp2p, provides authenticated key exchange and encrypted streams. Every libp2p node already possesses an Ed25519 keypair from which its PeerID is derived. AgentTrust reuses these keys for capability signing, adding no new key management burden. Official libp2p documentation stresses that Peer ID authentication is distinct from authorization: applications must define who may do what [libp2pSec] — the gap AgentTrust targets.

iii. **GossipSub** [Vyzovitis2020] is libp2p's publish-subscribe protocol, used in Ethereum 2.0 for beacon block propagation. GossipSub v1.1 introduced peer scoring and spam resistance. We use GossipSub as the revocation dissemination channel — a natural fit given that revocations are small, broadcast-oriented events that benefit from the same mesh topology.

iv. **Agentic P2P networks.** Wang et al. [Wang2025] identify capability sharing as a central primitive for next-generation agentic P2P systems, distinguishing content distribution (what libp2p does today) from capability and action sharing (what agentic systems need). AgentTrust is a concrete step toward the trust layer their work identifies as a gap.

v. **Inter-agent trust models.** Hu et al. [Hu2025] propose a taxonomy of inter-agent trust mechanisms including brief, claim, proof, stake, reputation, and constraint. AgentTrust implements the *proof* and *claim* layers (cryptographic capability chains) and lays groundwork for *reputation* (§7).

vi. **Prior work by the author.** This project builds directly on the author's prior open-source libp2p contributions: LLMesh [LLMesh] (GossipSub-based P2P mesh with embedded LLM nodes), Rachax402 [Rachax402] (agent discovery via ERC-8004 and x402 payment-gated execution), and Lattice [Lattice] (private solver mesh with intent routing). These demonstrate practical familiarity with js-libp2p and are cited as engineering prior art rather than academic novelty.


## 3. Protocol Design

### 3.1 Capability Token

A Capability Token is a JSON object signed with the issuer's Ed25519 private key (the same key underlying their libp2p PeerID). Its fields are:

```
version       — protocol version ("agentrust/0.1")
tokenId       — UUID v4, globally unique
issuer        — PeerID of the signing node
subject       — PeerID of the peer receiving the capability
action        — scoped action label (e.g., "relay:forward", "compute:execute")
scope         — optional resource/context constraint
issuedAt      — ISO 8601 timestamp
expiresAt     — ISO 8601 expiry timestamp (or null for no expiry)
delegatable   — boolean: may the subject re-delegate this capability?
parentTokenId — tokenId of the parent (null for root tokens)
signature     — base64url Ed25519 signature over canonical JSON payload
```

The signature is computed over all fields except `signature` itself, with keys sorted lexicographically to ensure canonical form. This design means verification requires only the issuer's public key, which is either already known (the peer is connected) or derivable from their PeerID.

### 3.2 Delegation Chain

A Delegation Chain is an ordered array of capability tokens, root first:

```
[ rootToken(issuer=A, subject=B),
  delegatedToken(issuer=B, subject=C, parentTokenId=rootToken.tokenId) ]
```

Chain validity requires:
- Root token has `parentTokenId: null`
- Each token's `issuer` equals the previous token's `subject`, and its `parentTokenId` equals the previous token's `tokenId`
- All non-terminal tokens have `delegatable: true`
- Maximum chain depth: 8 (bounds verification cost)
- All tokens pass individual signature, expiry, and revocation checks

Any node holding the public keys of all issuers in the chain can verify it independently, without network contact to any issuer. This is the core property enabling trustless authorisation in a decentralised mesh.

### 3.3 Revocation

The issuer of a token may revoke it by publishing a signed `RevocationEvent` on the GossipSub topic `/agentrust/1.0.0/revocations`. The event carries the `tokenId`, the revoker's PeerID, a timestamp, and an Ed25519 signature.

Each node maintains an in-memory Revocation Registry. On receiving a valid revocation event, the node records the `tokenId`. All subsequent chain verifications check the registry first. Cascade revocation is implicit: revoking a root token invalidates all descendant tokens because chain verification walks upward through `parentTokenId`.

**Revocation window.** Between the moment of revocation and full GossipSub propagation, a revoked token may still be accepted by nodes that have not yet received the event. This window is bounded by GossipSub's expected O(log N) propagation rounds (§6.2) but is a real security consideration documented in the threat model.

### 3.4 Sybil Resistance (Cryptographic)

An attacker generating a new Ed25519 keypair (and thus a new PeerID) cannot forge a token signed by a different key. Signature verification rejects any token whose `issuer` PeerID does not match the key that produced the signature. This provides **cryptographic Sybil resistance** — forgery is computationally infeasible under standard Ed25519 security assumptions.

*Economic Sybil resistance* — preventing an attacker from acquiring a large number of legitimately issued capabilities — is not addressed by this prototype and is a noted limitation (§7).

---

## 4. Architecture

```
                 ┌─────────────────────────────────────┐
                 │         TrustManager (per node)      │
                 │                                       │
                 │  issue()     verify()    revoke()     │
                 │     │            │           │        │
                 │  CapabilityMgr  ChainVerify  RevocReg │
                 └───────────────────┬─────────────────┘
                                     │
              ┌──────────────────────▼──────────────────────┐
              │           js-libp2p Services                  │
              │  Noise (auth+encrypt)  │  GossipSub (revoke) │
              │  WebSockets (transport)│  PeerID (identity)  │
              └──────────────────────────────────────────────┘
```

Each libp2p node instantiates a single `TrustManager`, which wraps:
- **Capability issuance** (`capability.js`): signs new tokens with the node's Ed25519 key
- **Delegation chain verification** (`delegation.js`): walks the chain, checks each token
- **Revocation registry** (`revocation.js`): in-memory store, updated via GossipSub subscription
- **Public key cache**: maps PeerID strings to resolved public keys

---

## 5. Implementation

### 5.1 Technology Stack

| Component | Choice | Rationale |
|---|---|---|
| Language | JavaScript (Node.js ESM) | Matches current repo; TypeScript optional later |
| P2P layer | js-libp2p 2.x (`libp2p` ^2) | Native WebSockets, Noise, GossipSub |
| Encryption | Noise (`@chainsafe/libp2p-noise`) | libp2p standard; reuses PeerID keypairs |
| Pubsub | GossipSub (`@chainsafe/libp2p-gossipsub`) | Already present in libp2p stack |
| Signing | Ed25519 via `@libp2p/crypto` | Reuses PeerID keypairs; no new key infra |
| Testnet | Docker Compose | 5 containers, reproducible for reviewers |

### 5.2 Proof-of-Concept Status

> **Honest disclosure:** The following table reflects the state of the implementation at time of submission.

| Component | Status | Notes |
|---|---|---|
| Protocol spec | ✅ Complete | `docs/PROTOCOL_SPEC.md` |
| `capability.js` | ✅ Complete | Issue, sign, verify single token |
| `delegation.js` | ✅ Complete | Chain build, verify, summarise |
| `revocation.js` | ✅ Complete | Registry + GossipSub broadcast/subscribe |
| `TrustManager.js` | ✅ Complete | Unified facade |
| `createNode.js` | ✅ Complete | libp2p node factory |
| Experiment runner | ✅ Complete | 5 scenarios, structured JSON metrics, `local` and `docker` modes |
| Docker Compose testnet | ✅ Complete | `docker compose up` builds the image, forms the mesh, runs 5/5 scenarios, writes results to the host |
| Unit tests | ✅ Complete | 27 tests across `capability.js` and `delegation.js` |
| ZK reputation | 📄 Design only | See §7 — not implemented |

### 5.3 Repository

```
https://github.com/Nkovaturient/agentrust-libp2p
```

Reviewers can reproduce all experiments with:

```bash
git clone https://github.com/Nkovaturient/agentrust-libp2p
cd agentrust-libp2p
docker compose -f docker/docker-compose.yml up --build --abort-on-container-exit --exit-code-from runner
# Results written to ./results/experiment-run-<timestamp>.json
```

Or run locally (Node.js 22 or newer, no Docker):

```bash
npm install
npm test
npm run experiment          # one run
npm run experiment:bench    # 5 runs, writes results/bench-summary.json
```

---

## 6. Experiments and Evaluation

> **Note:** Every number in this section is **[MEASURED]** and comes from a committed results file: `results/experiment-run-canonical.json` (local mesh, run `2026-10-29T20-27-16-041Z`, Node v24.10.0), `results/bench-summary.json` (median, with min–max, over 5 consecutive local runs; raw files in `results/bench/`), and `results/experiment-run-canonical-docker.json` (Docker testnet, run `2026-10-26T14-20-08-270Z`, Node v22.23.4). Statements that no run backs are labelled **[NOT MEASURED]**.

**Method.** Five agents (bootstrap, issuer, delegatee, verifier, attacker) connect to the bootstrap node in a star topology. A scenario starts only after the revocation topic mesh has formed (the bootstrap node sees four connected peers, four subscribers and four mesh peers). In *local* mode the five libp2p nodes run in one OS process on 127.0.0.1. In *Docker* mode they run in five containers on one bridge network, and the runner drives them through an HTTP control API used only for orchestration; tokens and revocations still travel as signed tokens and GossipSub messages. Times come from `performance.now()`.

### 6.1 Scenario 01 — Delegation Chain Depth

**Setup:** The issuer creates chains of depth 1 to 9 (a chain of depth *d* has *d* tokens, issuer → delegatee → hop agents → verifier). The verifier checks each chain five times and we record the median.

**Success criterion:** Depths 1–8 return VALID with the verifier as chain tail, depth 9 is rejected, and the verifier holds no connection to the issuer before or after the sweep.

**Result [MEASURED]:** All criteria held. The verifier was connected to the issuer neither before nor after the sweep (`verifierConnectedToIssuer: false` in both samples). Depth 9 was rejected with `Chain depth 9 exceeds maximum 8`.

| Depth | Outcome | Verify time, canonical run (ms) | Verify time, median of 5 runs (min–max, ms) |
|---|---|---|---|
| 1 | valid | 0.076 | 0.081 (0.058–0.084) |
| 2 | valid | 0.128 | 0.135 (0.105–0.158) |
| 3 | valid | 0.172 | 0.179 (0.142–0.193) |
| 4 | valid | 0.234 | 0.236 (0.187–0.242) |
| 5 | valid | 0.265 | 0.279 (0.238–0.296) |
| 6 | valid | 0.332 | 0.323 (0.276–0.330) |
| 7 | valid | 0.379 | 0.376 (0.340–0.380) |
| 8 | valid | 0.402 | 0.416 (0.375–0.431) |
| 9 | rejected | 0.005 | 0.004 (0.003–0.005) |

Verification time grows linearly with depth, at roughly 0.05 ms per added token, which matches one Ed25519 signature check per token. Depth 9 is rejected on the length check alone, before any signature work.

In Docker mode all depths 1–8 also verify and depth 9 is rejected, but each call includes an HTTP round trip to the verifier container: 0.58 ms at depth 1, 0.82 ms at depth 8, and 0.39 ms at depth 9 (no signature work). The HTTP overhead dominates, so the local numbers are the ones to use for verification cost.

**Baseline comparison [NOT MEASURED]:** We did not implement an issuer-contact baseline. Analytically, a verifier that asks the issuer on every check pays at least one network round trip per verification, whereas chain verification pays only signature operations.

### 6.2 Scenario 02 — Revocation Propagation Timing

**Setup:** The issuer creates a token for the delegatee, the verifier accepts it, the issuer revokes it over GossipSub, and the verifier is polled every 2 ms until its registry contains the revocation. The clock starts when `revoke()` is called. Each run repeats this three times with a fresh token.

**Variables:** 5 nodes, GossipSub defaults, no injected network delay, single host.

**Result [MEASURED]:** In every round the verifier accepted the chain before revocation and rejected it afterwards with `Token at index 0: Token <id> has been revoked`.

| Setting | Propagation time (ms) |
|---|---|
| Local, canonical run (3 rounds) | median 2.03 (min 2.00, max 2.30) |
| Local, 5 runs | median of run medians 2.33 (min 2.21, max 2.40) |
| Docker, canonical run (3 rounds) | median 4.86 (min 4.55, max 5.00) |

The Docker figure includes two HTTP calls from the runner (the revoke request and each registry poll), so it overstates the pure gossip delay. The 2 ms polling interval limits resolution: these figures show that propagation takes a few milliseconds on a single host, not a precise latency.

**Honest limitation:** All nodes share one host. In local mode they also share one process, so messages cross only loopback sockets. Propagation over geographically distributed nodes with realistic delay, loss, or partitions is **[NOT MEASURED]** and is future work.

### 6.3 Scenario 03 — Sybil / Forgery Probe

**Setup:** An attacker node makes one attempt per variant while a legitimate non-delegatable chain exists:
- **A: Forgery** — signs a token with its own key but claims the issuer's PeerID.
- **B: Chain theft** — presents the delegatee's legitimate chain, claiming to be the attacker.
- **C: Non-delegatable extension** — asks the delegatee to delegate from a `delegatable: false` token.

**Success criterion:** All three attempts are rejected for the expected reason and the legitimate chain still verifies afterwards.

**Result [MEASURED]:** All three attempts were rejected, and the legitimate control chain verified as valid.
- Attack A: the explicit forgery probe reported `Signature mismatch — key does not match claimed issuer`, and chain verification returned `Invalid signature on token <id>`.
- Attack B: verification returned `Chain subject mismatch: expected <attacker>, got <delegatee>`.
- Attack C: `delegate()` threw `Token <id> is not delegatable` before producing any token.

This is one attempt per variant, so it demonstrates that these specific attacks fail, not a rejection rate.

### 6.4 Scenarios 04 and 05 — Chain Integrity and Concurrent Revocation

**04 — Chain integrity.** A legitimate 5-token chain is verified (valid, every `issuer` equals the previous `subject`, every `parentTokenId` equals the previous `tokenId`). Four malformed chains are then verified, each carrying valid signatures except where the signature is the point of the test.

| Malformed chain | Outcome [MEASURED] |
|---|---|
| Token issued by a party that is not the previous subject | rejected: `Chain break at index 1: expected issuer <peer>, got <peer>` |
| Token whose `parentTokenId` points at an unrelated token | rejected: `Chain break at index 1: expected parentTokenId <id>, got <id>` |
| Extension of a non-delegatable token | rejected: `Token at index 0 is not delegatable but chain continues` |
| Valid token whose `action` was changed after signing | rejected: `Token at index 1: Invalid signature on token <id>` |

**Finding.** The first version of this scenario showed that chain verification accepted a validly signed token whose `parentTokenId` pointed at an unrelated token, because only issuer and subject linkage were checked. A delegatee could therefore splice a token from a different chain. Chain verification now also requires each token's `parentTokenId` to equal the previous token's `tokenId`, and `packages/trust/test/delegation.test.js` covers this case. All results above are from after the fix.

**05 — Concurrent revocation.** Two tokens with different actions are accepted by the verifier, then revoked concurrently by the issuer. Each revocation must reach the verifier's registry independently, after which both tokens are rejected with a `revoked` reason. Time is measured from the start of the concurrent `revoke()` calls.

| Setting | Per-token time (ms) | Time until both are revoked (ms) |
|---|---|---|
| Local, canonical run | 1.77 and 1.78 | 1.78 |
| Local, 5 runs | — | median 1.90 (min 1.59, max 3.08) |
| Docker, canonical run | 3.62 and 3.72 | 3.72 |

The canonical local run (1.78 ms) sits inside the five-run range (1.59–3.08 ms) and near the median (1.90 ms). The spread is still large at this timescale, so no single run should be read as a stable latency.

### 6.5 Threats to Validity

- Single host, loopback or one Docker bridge; no WAN latency, loss, or partitions.
- Small samples: three rounds per run for scenario 02, five repetitions per depth, five runs for the median.
- Local runs use Node v24.10.0 and the Docker run uses Node v22.23.4.
- Revocation timings have a 2 ms polling resolution, and Docker timings include HTTP orchestration overhead.
- Scenarios 04 and 05 run in the same mesh as the earlier scenarios and use fresh token identifiers rather than a fresh mesh per scenario.


## 7. Limitations and Future Work

### 7.1 Implemented Limitations

- **In-memory state only.** The revocation registry is not persisted. A node restart creates a brief window where previously revoked tokens could be accepted.
- **No identity continuity.** If a node rotates its keypair, all its issued tokens become unverifiable. Key rotation is an open problem noted in the libp2p specs.
- **Single host only.** Experiments run either as five in-process nodes or as five containers on one Docker bridge network. Behaviour at scale (hundreds of nodes, realistic WAN latency) is not measured.
- **Max 8-hop chains.** This bounds verification cost but may be insufficient for deep organisational hierarchies.

### 7.2 Economic Sybil Resistance (Not Implemented)

AgentTrust provides cryptographic Sybil resistance (you cannot forge tokens for keys you don't hold) but not economic Sybil resistance (an adversary can generate unlimited fresh keypairs and request legitimate capabilities from cooperative issuers). Addressing this requires either:
- **Staking / proof-of-work** at capability request time
- **Web of trust / transitive reputation** (peers only issue to nodes already trusted by other nodes they trust)
- **Rate limiting** at the issuer (outside the protocol)

### 7.3 Chain disclosure and zero-knowledge reputation

**Disclosure [analytic, not a separate experiment].** Verification hands the verifier the full chain. A chain of depth *d* carries the root issuer plus *d* subject PeerIDs. When those parties are distinct, the verifier sees *d*+1 PeerIDs. Scenario 01 already records `chainLength` equal to depth for depths 1–8, so this count is a reading of that chain, not a new measurement, and this paragraph is not marked **[MEASURED]**.

**Zero-knowledge reputation (proposed, not implemented).** A natural extension is *private trust verification*: a peer proves it holds a valid capability without revealing the full delegation chain (which leaks intermediate peer identities). This could be achieved via zk-SNARKs (e.g., Groth16 or PLONK proofs over the token structure). The proof system would generate a short proof that:
1. A valid signed chain exists terminating at the prover's PeerID.
2. No token in the chain appears in the current revocation set.
3. The chain's root was issued by a known trusted issuer.

This is listed as future work. No ZK implementation is included in this prototype and no ZK claims are made in the experimental results.

### 7.4 Revocation Completeness

GossipSub provides probabilistic eventual delivery, not guaranteed delivery. An adversary who can partition the network may prevent revocation events from reaching some nodes. Stronger revocation guarantees (e.g., periodic full-state sync, revocation accumulator with Merkle proofs) are proposed as future protocol extensions.


## 8. Contribution to Resilient Networking

AgentTrust advances the libp2p ecosystem in the following ways:

- **Trust layer**: fills the gap between libp2p's identity (who you are) and authorisation (what you may do), enabling agentic deployments where nodes act autonomously on behalf of delegating entities.
- **No new infrastructure**: reuses Ed25519 keys, Noise protocol, and GossipSub already present in every libp2p node. Zero additional dependencies for the trust primitive itself.
- **Revocation via gossip**: integrates token invalidation with the existing mesh broadcast infrastructure, making revocation a first-class citizen of the P2P fabric rather than a centralised side-channel.
- **Open research problems surfaced**: ZK reputation, economic Sybil resistance, and identity continuity are clearly identified and framed as concrete future research targets for the libp2p community.


## 9. Conclusion

- I presented **AgentTrust, a lightweight trust protocol for libp2p** that enables autonomous nodes to issue, delegate, verify, and revoke capability tokens without any central authority. 

- The protocol is implemented as a proof-of-concept in JavaScript on Node.js, reproduced in a five-node Docker Compose testnet, and evaluated across five experiment scenarios covering delegation depth, revocation propagation, forgery and theft attempts, chain integrity, and concurrent revocation. All measured claims in this paper trace to committed result files; everything else is labelled not measured or proposed.
- I believe **AgentTrust provides a practical, near-term foundation for Trust-as-infrastructure in the libp2p ecosystem, and a concrete starting point for the deeper open problems of ZK reputation and economic Sybil resistance.**

<div align="center">
<img width="554" height="604" alt="atl" src="https://github.com/user-attachments/assets/62cc9740-feda-4ecf-8df7-7d15fd4d99e5" />
</div>

## References

- [Hardy1988] Hardy, N. (1988). *The Confused Deputy: (or why capabilities might have been invented).* ACM SIGOPS Operating Systems Review.

- [Miller2003] Miller, M., Yee, K., Shapiro, J. (2003). *Capability Myths Demolished.* Technical Report SRL2003-02, Systems Research Laboratory.

- [Perrin2018] Perrin, T. (2018). *The Noise Protocol Framework.* https://noiseprotocol.org/noise.html

- [UCAN2023] Fission / DAG House. (2023). *UCAN Specification v1.0.* https://github.com/ucan-wg/spec

- [Vyzovitis2020] Vyzovitis, D., Napora, Y., McCormick, D., Dias, D., Psaras, Y. (2020). *GossipSub: Attack-Resilient Message Propagation in the Filecoin and ETH2.0 Networks.* arXiv:2007.02754.

- [Wang2025] Wang, R. et al. (2025). *Agentic Peer-to-Peer Networks: From Content Distribution to Capability and Action Sharing.* arXiv:2603.03753.

- [Hu2025] Hu, Y. et al. (2025). *Inter-Agent Trust Models.* arXiv:2511.03434.

- [LLMesh] Nkovaturient. (2024). *LLMesh — GossipSub P2P chat mesh with embedded LLM nodes.* https://github.com/Nkovaturient/LLMesh

- [Rachax402] Nkovaturient. (2025). *Rachax402 — Agent discovery via ERC-8004 + x402.* https://github.com/Nkovaturient/Rachax402

- [Lattice] Nkovaturient. (2025). *Lattice — js-libp2p private solver mesh.* https://github.com/Nkovaturient/Lattice

- [libp2pSpecs] libp2p. (2025). *libp2p Specifications.* https://github.com/libp2p/specs

- [libp2pSec] libp2p. *Security Considerations.* https://libp2p.io/docs/security-considerations/

- [libp2pTrack04] libp2p. *Resilient Networking Research Track — Agentic Trust Structures.* https://libp2p.tech/research-track
