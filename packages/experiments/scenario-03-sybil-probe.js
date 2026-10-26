/**
 * Scenario 03 — forgery, chain theft, and non-delegatable extension are rejected
 * while the legitimate chain keeps verifying.
 */

import { probeForgery } from '@agentrust/trust/sybil'
import { registerKnownPeers } from './lib/agents.js'
import { craftToken } from './lib/chain.js'

async function attemptForgery ({ issuer, delegatee, verifier, attacker }) {
  const forged = await craftToken({
    signer: attacker,
    issuerPeerId: issuer.peerId,
    subjectPeerId: attacker.peerId
  })

  const keys = new Map([issuer, delegatee, attacker].map(agent => [agent.peerId, agent.publicKey]))
  const probe = await probeForgery(forged, async (peerId) => keys.get(peerId) ?? null)
  const verification = await verifier.trustManager.verify({
    chain: [forged],
    claimedSubject: attacker.peerId
  })

  return {
    rejected: probe.isForgery === true && verification.valid === false && /Invalid signature/.test(verification.reason),
    probeReason: probe.reason,
    verifyReason: verification.reason
  }
}

async function attemptTheft ({ verifier, attacker }, legitimate) {
  const verification = await verifier.trustManager.verify({
    chain: legitimate,
    claimedSubject: attacker.peerId
  })
  return {
    rejected: verification.valid === false && /subject mismatch/.test(verification.reason),
    verifyReason: verification.reason
  }
}

async function attemptExtension ({ delegatee, attacker }, legitimate) {
  try {
    await delegatee.trustManager.delegate({
      parentChain: legitimate,
      newSubjectPeerId: attacker.peerId
    })
    return { rejected: false, errorMessage: null }
  } catch (err) {
    return { rejected: /not delegatable/.test(err.message), errorMessage: err.message }
  }
}

export async function runScenario03 ({ issuer, delegatee, verifier, attacker }) {
  await registerKnownPeers(verifier, [issuer, delegatee, attacker])

  const legitimate = await issuer.trustManager.issue({
    subjectPeerId: delegatee.peerId,
    action: 'relay:forward',
    delegatable: false
  })

  const forgery = await attemptForgery({ issuer, delegatee, verifier, attacker })
  const theft = await attemptTheft({ verifier, attacker }, legitimate)
  const nonDelegatableExtension = await attemptExtension({ delegatee, attacker }, legitimate)

  const control = await verifier.trustManager.verify({
    chain: legitimate,
    claimedSubject: delegatee.peerId
  })

  const passed = forgery.rejected && theft.rejected && nonDelegatableExtension.rejected && control.valid === true

  return {
    id: '03-sybil-probe',
    result: {
      passed,
      reason: passed
        ? 'forgery, chain theft, and non-delegatable extension were rejected; the legitimate chain still verifies'
        : `forgery=${forgery.verifyReason}; theft=${theft.verifyReason}; extension=${nonDelegatableExtension.errorMessage}; control=${control.reason}`
    },
    metrics: {
      attacks: { forgery, theft, nonDelegatableExtension },
      legitimateControl: { valid: control.valid, reason: control.reason }
    }
  }
}
