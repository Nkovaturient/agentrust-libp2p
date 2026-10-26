/**
 * chain.js
 * AgentTrust — Chain construction for scenarios.
 */

import { randomUUID } from 'crypto'

/**
 * Build a legitimate chain of `delegators.length + 1` tokens:
 * issuer → delegators[0] → … → delegators[n-1] → tail.
 */
export async function buildChain ({ issuer, delegators, tailPeerId, action = 'relay:forward' }) {
  let chain = await issuer.trustManager.issue({
    subjectPeerId: delegators[0]?.peerId ?? tailPeerId,
    action,
    delegatable: delegators.length > 0
  })

  for (let i = 0; i < delegators.length; i++) {
    const isLast = i === delegators.length - 1
    chain = await delegators[i].trustManager.delegate({
      parentChain: chain,
      newSubjectPeerId: isLast ? tailPeerId : delegators[i + 1].peerId,
      delegatable: !isLast
    })
  }
  return chain
}

/**
 * Craft a token that carries a valid signature from `signer` but may violate
 * protocol rules (wrong issuer claim, wrong parent link, ...). Used for attacks.
 */
export async function craftToken ({
  signer,
  issuerPeerId = signer.peerId,
  subjectPeerId,
  parentToken = null,
  parentTokenId = parentToken?.tokenId ?? null,
  action = parentToken?.action ?? 'relay:forward',
  delegatable = false,
  ttlSeconds = 3600
}) {
  const now = new Date()
  const token = {
    version: 'agentrust/0.1',
    tokenId: randomUUID(),
    issuer: issuerPeerId,
    subject: subjectPeerId,
    action,
    scope: parentToken?.scope ?? null,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    delegatable,
    parentTokenId
  }
  token.signature = await signer.sign(token)
  return token
}
