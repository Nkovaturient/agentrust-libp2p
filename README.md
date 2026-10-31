<p align="center">
  <img src="assets/atl.png" alt="AgenTrust mark: five peer nodes linked by a teal chain around a brass seal" width="180" />


<h1 align="center">AgenTrust-Libp2p</h1>

</p>
<p align="center">
  <img alt="Requires Node.js 22 or newer" src="https://img.shields.io/badge/node-%3E%3D22-339933?logo=nodedotjs&logoColor=white" />
  <a href="https://libp2p.io"><img alt="libp2p 2.x" src="https://img.shields.io/badge/libp2p-2.x-0ea5e9" /></a>
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-6b7280" />
  <a href="https://libp2p.tech/research-track"><img alt="Devcon 8 Track 4" src="https://img.shields.io/badge/Devcon%208-Track%204-7c3aed" /></a>
</p>

<p align="center">
  <a href="https://www.loom.com/share/ff79c48e253043fabf9a7771cfb0f1b5"><img alt="Founder's intro, 2 minutes" src="https://img.shields.io/badge/Founder's%20intro-2%20min-625DF5?logo=loom&logoColor=white" /></a>
  <a href="https://www.loom.com/share/fc61506680f74fe9956b5182ac808402"><img alt="Live demo" src="https://img.shields.io/badge/Live%20demo-Loom-625DF5?logo=loom&logoColor=white" /></a>
  <a href="https://nkovaturient.github.io/agentrust-libp2p/"><img alt="GitHub Pages visual arc" src="https://img.shields.io/badge/Visual%20arc-GitHub%20Pages-1D9E75?logo=githubpages&logoColor=white" /></a>
  <a href="https://github.com/Nkovaturient/agentrust-libp2p/blob/main/paper/Agentrust-Libp2p.md"><img alt="Draft research paper" src="https://img.shields.io/badge/Draft%20paper-markdown-0F6E56" /></a>
  <a href="https://docs.google.com/presentation/d/1f49FwhkMlMkBmtAV75iOVLq6OwUghXA_/edit?usp=sharing&ouid=108746493474785450440&rtpof=true&sd=true"><img alt="Pitch deck" src="https://img.shields.io/badge/Pitch%20deck-Slides-F4B400?logo=googleslides&logoColor=white" /></a>
</p>

> **Track 4 — Agentic Trust Structures** · libp2p Resilient Networking Research Track · Devcon 8 Mumbai 2026

<p align="center">
  <img src="assets/agentrust-banner.jpg" alt="Five peers in a weave, a capability chain across issue, delegate, and verify, and a revoke that lifts off the mesh" width="880" />
</p>

<p align="center"><sub>Peer weave, then the grant: issue → delegate → verify. The last link lifts off: revoke.</sub></p>

## How a grant moves

libp2p already answers who the peer is. The chain below is what that peer may do, and how the grant is withdrawn.

```mermaid
flowchart TD
  issue["1. Issue: capability bound to a Peer ID"]
  delegate["2. Delegate: chain depth 1 to 8"]
  verify["3. Verify: local keys, no issuer dial"]
  decision{"Valid and not revoked?"}
  act["Peer may act"]
  deny["Reject: depth 9, splice, or forgery"]
  revoke["4. Revoke: issuer-signed GossipSub event"]
  registry["Local revocation registry"]

  issue --> delegate --> verify --> decision
  decision -->|yes| act
  decision -->|no| deny
  revoke --> registry --> verify
```

Research prototype + living paper: how **libp2p peers (and agent nodes on top of them)** can **authorize** each other without a central authority — using primitives libp2p already has (PeerID, Noise, GossipSub).

**Status:** active research — protocol, five measured experiment scenarios, and a five-container Docker testnet are in the repo. Nothing here is a final production spec.

---

## 1) What is this really about?

libp2p answers **“who is this peer?”** (authenticated Peer ID + encrypted channel). It does **not** answer **“what may this peer do on my behalf?”** — [libp2p Security Considerations](https://libp2p.io/docs/security-considerations/) puts **authorization** in the application layer.

**AgentTrust** is our experiment in that gap:

- **Capabilities** — signed, scoped permissions bound to Peer IDs  
- **Delegated trust** — linked tokens so permission can flow A → B → … → C  
- **Verifiable authorization** — any peer with issuer public keys can verify a chain **without calling the root issuer**  
- **Revocation** — issuer-signed revoke events on **GossipSub**; verifiers keep a local registry  

We are **not** claiming a full “trust stack” yet. Reputation, privacy-preserving proofs, economic Sybil resistance, and key rotation are **named, scoped-out follow-ons** (paper §7, threat model §4–5).

```
  Identity (libp2p)          Authorization (AgentTrust — this repo)
  ─────────────────          ───────────────────────────────────────
  PeerID + Noise      →      capability token + chain verify
  GossipSub transport →      revocation topic (not auth by itself)
```

---

## 2) What am I experimenting and proving?

**Primary claim (go deep here):** decentralized **capability-based authorization** on libp2p — issue, delegate (depth ≤ 8), verify offline, revoke via gossip.

| Track-4 theme | In this repo now | Measured in paper §6 / canonical JSON |
|---------------|------------------|------------------------------|
| Capabilities | `capability.js`, `TrustManager` | Structured metrics per scenario |
| Delegated trust | `delegation.js`, scenario 01/04 | Depths **1–8** accepted, **depth 9 rejected**, per-depth verify timings; spliced/tampered chains rejected |
| Verifiable authorization | Chain verify, no issuer dial at verify time | `verifierConnectedToIssuer` is `false` before and after the sweep (scenario 01) |
| Revocation | `revocation.js` + GossipSub topic | Pre/post accept/reject; **propagationMs** (local + Docker mesh); concurrent revoke (scenario 05) |
| Sybil resistance | Crypto only (`sybil.js`, scenario 03) | Forgery / theft / non-delegatable extension — **not** unlimited fresh Peer IDs |
| Reputation | Not implemented | Design pointer only (§7; optional gossip topic reserved) |
| Identity continuity | Not implemented | Key rotation breaks old tokens — documented limitation |
| Privacy | Disclosure only (no ZK) | Depth *d* shows the root issuer plus *d* subject PeerIDs — analytic, paper §7.3 |

**Execution modes (`AGENTRUST_MODE`):**

- **local** (default) — five in-process libp2p nodes (`npm run experiment`) for fast CI and bench medians.  
- **docker** — separate containers, **real** inter-container GossipSub for revoke; runner uses **HTTP only to orchestrate** experiments (issue/delegate/verify/revoke commands), **not** as the trust protocol. The control API is unauthenticated and meant for the private compose network only.

### Architecture

```mermaid
flowchart TB
  subgraph localMode [Local mode]
    RunnerLocal[runner.js]
    RunnerLocal --> InProcessAgents[5 in-process libp2p agents]
  end
  subgraph dockerMode [Docker mode]
    RunnerDocker[runner.js AGENTRUST_MODE=docker]
    RunnerDocker -->|HTTP control| IssuerC[issuer container]
    RunnerDocker -->|HTTP control| DelegateeC[delegatee container]
    RunnerDocker -->|HTTP control| VerifierC[verifier container]
    RunnerDocker -->|HTTP control| AttackerC[attacker container]
    IssuerC --> BootstrapC[bootstrap p2p + /health]
    DelegateeC --> BootstrapC
    VerifierC --> BootstrapC
    AttackerC --> BootstrapC
    IssuerC -.GossipSub revocation.-> VerifierC
  end
  Scenarios[scenario-01..05] --> AgentIface[Agent adapter interface]
  AgentIface --> InProcessAgents
  AgentIface --> RemoteAgents[RemoteTrustManager HTTP client]
```

- Local and Docker agents share one scenario signature (`runScenarioXX({ issuer, delegatee, verifier, attacker })`). In Docker, `trustManager` is an HTTP client of the same methods (`packages/experiments/lib/`). That HTTP API is lab control only.

---

## 3) Am I on the right track?

**Yes, for Track 4’s core ask** — libp2p maintainers describe the same split: authenticate with Peer ID, **build authorization on top** ([security docs](https://libp2p.io/docs/security-considerations/)). The [Resilient Networking Track 04](https://libp2p.tech/research-track) explicitly calls for **delegated trust chains** and **webs of capabilities**; ZK reputation is aspirational there too.

**Honest boundaries:**

- GossipSub **signs** pubsub messages; it does **not** grant capabilities. Our revoke path uses gossip; **trust decisions** stay in `TrustManager.verify()`.  
- **Sybil** at libp2p layer = cheap Peer IDs ([same docs](https://libp2p.io/docs/security-considerations/)). We prove **forgery fails**; we do **not** prove **issuance policy** against millions of new identities.  
- **Docker** proves **multi-process** mesh behavior, not WAN latency or country-scale partitions (paper §7.1).

---

## 4) Vision, methodology, is the route valid?

**Vision:** Trust-as-infrastructure for **agent-native** libp2p — agents act only when a **verifiable delegation chain** says they may, and grants can be **withdrawn** through the same mesh they already use.

**Methodology:**

1. Spec + threat model (`docs/`) — revised as we learn.  
2. Minimal PoC (`packages/trust`, `packages/node`).  
3. **Reproducible scenarios** with JSON metrics (`packages/experiments`, `results/`).  
4. **Dual harness** — local for statistics; Docker for distributed revoke path.  
5. Paper updated only when runs support a claim (`[MEASURED]` vs `[PLANNED]`).

**Route validity:** Matches libp2p’s own guidance (app-layer authz on authenticated peers) and UCAN-style capabilities adapted to Peer IDs — without pretending HTTP orchestration or a 5-container LAN is production.

---

## FAQ (reviewers & maintainers)

**What should you know?**  
“We implement **application-layer authorization** on libp2p: Ed25519 capability tokens, transitive delegation (max depth 8), local verification without issuer round-trips, and GossipSub revocation. 

- Five scenarios already emit structured metrics on a local mesh and a Docker mesh. **Economic Sybil resistance**, **reputation**, and **zero-knowledge privacy** stay in paper §7. A chain of depth *d* shows the root issuer plus *d* subject PeerIDs to the verifier.”

**What’s novel vs UCAN / JWT / SPIFFE?**  
Not new cryptography — **integration**: same keys as Peer ID, revocation on **existing** GossipSub, evaluation on **js-libp2p 2.x** with open scenarios. Contribution is **evidence + spec** for agentic P2P, not a new token format war.

**Why HTTP in Docker?**  
Smallest way to run **separate libp2p processes** and still drive scenarios reproducibly. HTTP is **lab remote control**; trust bytes are signed tokens + gossip revocations. Documented as non-production API.

**What’s implemented?**  
Trust package, shared experiment harness (`packages/experiments/lib/*`), five scenarios with structured metrics (depth 1–8 + depth 9 rejection, revocation timing, forgery/theft/extension attacks, chain-integrity negatives, concurrent revocation), `AGENTRUST_MODE=local|docker`, a Docker mesh with deterministic testnet identities, 27 unit tests, and a 5-run benchmark feeding paper §6.

**What must still be researched / proved (not in current plan scope)?**  
Persistent revocation store; eclipse/partition on revoke topic; issuance policy under Sybil flood; peer scoring tied to capabilities; ZK “valid chain + not revoked” without revealing intermediates; key rotation / identity continuity ([open in libp2p community](https://discuss.libp2p.io/)).

---

## Status (honest)

| Component | Status |
|-----------|--------|
| Protocol spec (draft) | ✅ Living doc |
| Core `TrustManager` + GossipSub revoke | ✅ In repo |
| Unit tests | ✅ Capability + delegation (27 tests) |
| Experiments + JSON metrics | ✅ Five scenarios, local + docker modes |
| Docker distributed mesh + runner | ✅ `docker compose up` runs the suite end to end |
| Paper | ✍️ Draft — §6 reports measured results from the committed run files |

---

## Quick start

Requires Node.js 22 or newer (libp2p dependencies use `Promise.withResolvers`).

```bash
npm install
npm run verify              # tests + one local run; see docs/REPRODUCTION.md
npm run experiment          # local in-process; results/experiment-run-<timestamp>.json
npm run experiment:bench    # 5 local runs; results/bench-summary.json
```

The GitHub clone directory is `agentrust-libp2p`. The npm package name in this tree is `agentrustweave-libp2p`.

Form answers: `docs/SUBMISSION_TRACK4.md`.

Docker:

```bash
docker compose -f docker/docker-compose.yml up --build --abort-on-container-exit --exit-code-from runner
```

Testnet node identities derive from public seed labels in `docker/config/<role>.env` (testnet only, not secrets). Regenerate those files with `npm run docker:env`.

---

## References (starting set)

- libp2p — [Security Considerations](https://libp2p.io/docs/security-considerations/) (identity ≠ authorization; Sybil at app layer)  
- libp2p — [Peers / Peer ID](https://libp2p.io/docs/peers/)  
- [Resilient Networking — Track 04](https://libp2p.tech/research-track)  
- UCAN — [ucan-wg/spec](https://github.com/ucan-wg/spec)  
- GossipSub — Vyzovitis et al., arXiv:2007.02754  
- Agentic P2P — Wang et al., arXiv:2603.03753 · Inter-agent trust — Hu et al., arXiv:2511.03434  

**License:** MIT
