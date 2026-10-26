/**
 * Scenario 04 — chain integrity. A 5-token chain verifies; four classes of
 * spliced or tampered chains are each rejected for the specific expected reason.
 */

import { randomUUID } from 'crypto'
import { makeHopAgents, registerKnownPeers } from './lib/agents.js'
import { buildChain, craftToken } from './lib/chain.js'

const POSITIVE_DEPTH = 5

async function rejectionCheck (verifier, name, chain, claimedSubject, expectedReason) {
  const result = await verifier.trustManager.verify({ chain, claimedSubject })
  return {
    name,
    valid: result.valid,
    reason: result.reason,
    rejectedAsExpected: result.valid === false && expectedReason.test(result.reason)
  }
}

async function verifyLegitimateChain ({ issuer, delegatee, verifier, hops }) {
  const chain = await buildChain({
    issuer,
    delegators: [delegatee, ...hops.slice(0, POSITIVE_DEPTH - 2)],
    tailPeerId: verifier.peerId
  })
  const verification = await verifier.trustManager.verify({ chain, claimedSubject: verifier.peerId })
  const linked = chain.every((token, i) => i === 0
    ? token.parentTokenId === null
    : token.parentTokenId === chain[i - 1].tokenId && token.issuer === chain[i - 1].subject)

  return {
    depth: verification.depth,
    chainLength: chain.length,
    valid: verification.valid,
    reason: verification.reason,
    linked,
    ok: verification.valid === true && chain.length === POSITIVE_DEPTH && linked
  }
}

export async function runScenario04 ({ issuer, delegatee, verifier }) {
  const hops = await makeHopAgents(POSITIVE_DEPTH)
  await registerKnownPeers(verifier, [issuer, delegatee, ...hops])
  const [signerA, signerB] = hops.slice(POSITIVE_DEPTH - 2)

  const legitimate = await verifyLegitimateChain({ issuer, delegatee, verifier, hops })

  const delegatableRoot = await issuer.trustManager.issue({
    subjectPeerId: signerA.peerId,
    action: 'relay:forward',
    delegatable: true
  })
  const sealedRoot = await issuer.trustManager.issue({
    subjectPeerId: signerA.peerId,
    action: 'relay:forward',
    delegatable: false
  })
  const tail = verifier.peerId

  const spliced = await craftToken({ signer: signerB, subjectPeerId: tail, parentToken: delegatableRoot[0] })
  const wrongParent = await craftToken({
    signer: signerA,
    subjectPeerId: tail,
    parentToken: delegatableRoot[0],
    parentTokenId: randomUUID()
  })
  const extendedSealed = await craftToken({ signer: signerA, subjectPeerId: tail, parentToken: sealedRoot[0] })
  const escalated = await craftToken({ signer: signerA, subjectPeerId: tail, parentToken: delegatableRoot[0] })

  const integrityChecks = [
    await rejectionCheck(verifier, 'brokenLinkage', [...delegatableRoot, spliced], tail, /Chain break at index 1: expected issuer/),
    await rejectionCheck(verifier, 'wrongParentTokenId', [...delegatableRoot, wrongParent], tail, /parentTokenId/),
    await rejectionCheck(verifier, 'nonDelegatableIntermediate', [...sealedRoot, extendedSealed], tail, /not delegatable but chain continues/),
    await rejectionCheck(verifier, 'tamperedAction', [...delegatableRoot, { ...escalated, action: 'admin:all' }], tail, /Invalid signature/)
  ]

  const passed = legitimate.ok && integrityChecks.every(entry => entry.rejectedAsExpected)

  return {
    id: '04-multihop-chain',
    result: {
      passed,
      reason: passed
        ? `${POSITIVE_DEPTH}-token chain verified; ${integrityChecks.length} spliced or tampered chains rejected for the expected reason`
        : `legitimate=${legitimate.ok} (${legitimate.reason}); ${integrityChecks.filter(entry => !entry.rejectedAsExpected).map(entry => `${entry.name}: valid=${entry.valid} (${entry.reason})`).join('; ')}`
    },
    metrics: { legitimate, integrityChecks }
  }
}
