/**
 * delegation.test.js
 * Unit tests for delegation chain verification and construction.
 * Run with: npm test
 */

import { randomUUID }            from 'crypto'
import { generateKeyPair }       from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey }  from '@libp2p/peer-id'
import {
  issueCapability,
  delegateCapability,
  signToken
} from '../src/capability.js'
import {
  verifyChain,
  extendChain,
  summariseChain
} from '../src/delegation.js'

async function makeParty () {
  const privateKey = await generateKeyPair('Ed25519')
  return { privateKey, peerId: peerIdFromPrivateKey(privateKey).toString() }
}

function keyResolver (parties) {
  const keys = new Map(parties.map(p => [p.peerId, p.privateKey.publicKey]))
  return async (peerId) => keys.get(peerId) ?? null
}

/** Chain of `length` tokens: parties[0] → parties[1] → … → parties[length]. */
async function buildChain (parties, length, { delegatableTail = false } = {}) {
  const tokens = [await issueCapability({
    issuerPeerId: parties[0].peerId,
    issuerKey: parties[0].privateKey,
    subjectPeerId: parties[1].peerId,
    action: 'relay:forward',
    delegatable: length > 1 || delegatableTail
  })]

  for (let i = 1; i < length; i++) {
    tokens.push(await delegateCapability({
      parentToken: tokens[i - 1],
      delegatorPeerId: parties[i].peerId,
      delegatorKey: parties[i].privateKey,
      newSubjectPeerId: parties[i + 1].peerId,
      delegatable: i < length - 1 || delegatableTail
    }))
  }
  return tokens
}

/** Validly signed token that bypasses delegateCapability's own checks. */
async function craft (signer, subjectPeerId, parentToken, overrides = {}) {
  const token = {
    version: 'agentrust/0.1',
    tokenId: randomUUID(),
    issuer: signer.peerId,
    subject: subjectPeerId,
    action: parentToken.action,
    scope: parentToken.scope,
    issuedAt: new Date().toISOString(),
    expiresAt: parentToken.expiresAt,
    delegatable: false,
    parentTokenId: parentToken.tokenId,
    ...overrides
  }
  token.signature = await signToken(token, signer.privateKey)
  return token
}

describe('verifyChain()', () => {
  let parties, getKey

  beforeAll(async () => {
    parties = await Promise.all(Array.from({ length: 11 }, makeParty))
    getKey = keyResolver(parties)
  })

  test('rejects an empty chain', async () => {
    const result = await verifyChain([], parties[1].peerId, getKey, new Set())
    expect(result).toMatchObject({ valid: false, reason: 'Empty chain', depth: 0 })
  })

  test('accepts a single root token', async () => {
    const chain = await buildChain(parties, 1)
    const result = await verifyChain(chain, parties[1].peerId, getKey, new Set())
    expect(result).toMatchObject({ valid: true, depth: 1 })
  })

  test.each([2, 5, 8])('accepts a chain of depth %i', async (depth) => {
    const chain = await buildChain(parties, depth)
    const result = await verifyChain(chain, parties[depth].peerId, getKey, new Set())
    expect(result).toMatchObject({ valid: true, depth })
  })

  test('rejects a chain deeper than the maximum of 8', async () => {
    const chain = await buildChain(parties, 9)
    const result = await verifyChain(chain, parties[9].peerId, getKey, new Set())
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/Chain depth 9 exceeds maximum 8/)
  })

  test('rejects a chain whose first token has a parent', async () => {
    const chain = await buildChain(parties, 2)
    const result = await verifyChain(chain.slice(1), parties[2].peerId, getKey, new Set())
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/must be a root token/)
  })

  test('rejects a token issued by someone other than the previous subject', async () => {
    const [root] = await buildChain(parties, 1, { delegatableTail: true })
    const spliced = await craft(parties[5], parties[6].peerId, root)
    const result = await verifyChain([root, spliced], parties[6].peerId, getKey, new Set())
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/Chain break at index 1: expected issuer/)
  })

  test('rejects a token that does not reference the previous token as parent', async () => {
    const [root] = await buildChain(parties, 1, { delegatableTail: true })
    const wrongParent = await craft(parties[1], parties[2].peerId, root, { parentTokenId: randomUUID() })
    const result = await verifyChain([root, wrongParent], parties[2].peerId, getKey, new Set())
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/Chain break at index 1: expected parentTokenId/)
  })

  test('rejects continuing past a non-delegatable token', async () => {
    const sealedRoot = await issueCapability({
      issuerPeerId: parties[0].peerId,
      issuerKey: parties[0].privateKey,
      subjectPeerId: parties[1].peerId,
      action: 'relay:forward',
      delegatable: false
    })
    const extension = await craft(parties[1], parties[2].peerId, sealedRoot)
    const result = await verifyChain([sealedRoot, extension], parties[2].peerId, getKey, new Set())
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/not delegatable but chain continues/)
  })

  test('rejects a claimed subject that is not the chain tail', async () => {
    const chain = await buildChain(parties, 2)
    const result = await verifyChain(chain, parties[1].peerId, getKey, new Set())
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/Chain subject mismatch/)
  })

  test('rejects a chain containing a revoked token', async () => {
    const chain = await buildChain(parties, 3)
    const result = await verifyChain(chain, parties[3].peerId, getKey, new Set([chain[1].tokenId]))
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/Token at index 1: .*revoked/)
  })

  test('rejects a tampered token', async () => {
    const chain = await buildChain(parties, 2)
    const tampered = [chain[0], { ...chain[1], action: 'admin:all' }]
    const result = await verifyChain(tampered, parties[2].peerId, getKey, new Set())
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/Token at index 1: Invalid signature/)
  })

  test('rejects a chain from an unknown issuer', async () => {
    const chain = await buildChain(parties, 1)
    const result = await verifyChain(chain, parties[1].peerId, async () => null, new Set())
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/Cannot resolve public key/)
  })
})

describe('extendChain()', () => {
  let parties

  beforeAll(async () => {
    parties = await Promise.all(Array.from({ length: 4 }, makeParty))
  })

  test('appends a token that links to the chain tail', async () => {
    const chain = await buildChain(parties, 1)
    const next = await craft(parties[1], parties[2].peerId, chain[0])
    expect(extendChain(chain, next)).toEqual([...chain, next])
  })

  test('does not mutate the original chain', async () => {
    const chain = await buildChain(parties, 1)
    extendChain(chain, await craft(parties[1], parties[2].peerId, chain[0]))
    expect(chain).toHaveLength(1)
  })

  test('throws on an empty chain', async () => {
    const chain = await buildChain(parties, 1)
    const token = await craft(parties[1], parties[2].peerId, chain[0])
    expect(() => extendChain([], token)).toThrow(/Cannot extend an empty chain/)
  })

  test('throws when parentTokenId does not match the chain tail', async () => {
    const chain = await buildChain(parties, 1)
    const stray = await craft(parties[1], parties[2].peerId, chain[0], { parentTokenId: randomUUID() })
    expect(() => extendChain(chain, stray)).toThrow(/does not match chain tail/)
  })
})

describe('summariseChain()', () => {
  test('handles empty chains', () => {
    expect(summariseChain([])).toBe('(empty chain)')
  })

  test('lists every hop without exposing signatures', async () => {
    const parties = await Promise.all(Array.from({ length: 3 }, makeParty))
    const chain = await buildChain(parties, 2)
    const summary = summariseChain(chain)
    expect(summary.split(' ➜ ')).toHaveLength(2)
    expect(summary).toContain('relay:forward')
    expect(summary).not.toContain(chain[0].signature)
  })
})
