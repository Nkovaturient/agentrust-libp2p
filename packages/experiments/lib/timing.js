/**
 * timing.js
 * AgentTrust — Measurement helpers shared by all scenarios.
 */

const round = (value) => Math.round(value * 1000) / 1000

export async function measureAsync (fn) {
  const started = performance.now()
  const value = await fn()
  return { value, ms: round(performance.now() - started) }
}

export function summarize (samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return { samples, median: round(median), min: sorted[0], max: sorted[sorted.length - 1] }
}

/**
 * Poll until predicate() is truthy. Returns elapsed ms since `startedAt`,
 * or null if timeoutMs elapses first.
 */
export async function waitUntil (predicate, timeoutMs, startedAt = performance.now(), intervalMs = 2) {
  while (performance.now() - startedAt < timeoutMs) {
    if (await predicate()) return round(performance.now() - startedAt)
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  return null
}
