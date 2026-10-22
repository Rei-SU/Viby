/**
 * Minimal SemVer comparison for update checks.
 *
 * Versions come from our own tags and package.json, but GitHub is an external
 * input: anything unparseable compares equal to everything, so a malformed tag
 * can never trigger an update.
 */
export type ParsedVersion = {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function parseVersion(input: string): ParsedVersion | null {
  const match = VERSION_RE.exec(input.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : []
  }
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  // Numeric identifiers rank below alphanumeric ones (semver §11.4.3).
  if (leftNumeric && rightNumeric) return Math.sign(Number(left) - Number(right))
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  return left < right ? -1 : left > right ? 1 : 0
}

/** -1, 0 or 1. Invalid versions compare equal. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return 0

  if (a.major !== b.major) return Math.sign(a.major - b.major)
  if (a.minor !== b.minor) return Math.sign(a.minor - b.minor)
  if (a.patch !== b.patch) return Math.sign(a.patch - b.patch)

  // A release outranks any prerelease of the same version.
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1

  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index++) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    // A shorter set of identifiers has lower precedence when it is a prefix.
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const order = compareIdentifiers(leftPart, rightPart)
    if (order !== 0) return order
  }
  return 0
}

export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}
