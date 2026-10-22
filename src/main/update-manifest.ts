import { createPublicKey, verify } from 'node:crypto'
import { UpdateIntegrityError } from './updater'
import { UPDATE_PUBLIC_KEY } from './update-key'

export type SignedManifest = {
  version: string
  /** Artifact name -> sha256 (hex). */
  files: Record<string, string>
}

/**
 * The exact bytes that get signed. Kept in sync with
 * `scripts/update-manifest.mjs`; `tests/updates.test.ts` compares both
 * implementations so they cannot drift.
 */
export function manifestPayload(version: string, files: Record<string, string>): Buffer {
  const lines = Object.keys(files)
    .sort()
    .map((name) => `${name} ${files[name]}`)
  return Buffer.from(`${version}\n${lines.join('\n')}\n`, 'utf8')
}

/**
 * Verify a signed manifest. Returns null when this build has no key pinned
 * (the feature is not enabled yet); throws on anything that is present but
 * untrustworthy, so an attacker cannot downgrade verification by corrupting it.
 */
export function verifyManifest(
  payload: unknown,
  publicKeyBase64: string = UPDATE_PUBLIC_KEY
): SignedManifest | null {
  if (!publicKeyBase64) return null

  const manifest = payload as { version?: unknown; files?: unknown; signature?: unknown }
  if (
    !manifest ||
    typeof manifest.version !== 'string' ||
    typeof manifest.signature !== 'string' ||
    !manifest.files ||
    typeof manifest.files !== 'object' ||
    Array.isArray(manifest.files)
  ) {
    throw new UpdateIntegrityError('The update manifest is malformed.')
  }

  const files: Record<string, string> = {}
  for (const [name, digest] of Object.entries(manifest.files as Record<string, unknown>)) {
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
      throw new UpdateIntegrityError('The update manifest is malformed.')
    }
    files[name] = digest
  }

  let valid = false
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki'
    })
    valid = verify(null, manifestPayload(manifest.version, files), key, Buffer.from(manifest.signature, 'base64'))
  } catch {
    throw new UpdateIntegrityError('The update manifest could not be verified.')
  }
  if (!valid) throw new UpdateIntegrityError('The update signature is invalid.')

  return { version: manifest.version, files }
}
