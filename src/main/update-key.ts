/**
 * Ed25519 public key (base64 SPKI) for `update-manifest.json`.
 *
 * Empty until the maintainer generates a key and commits this file:
 *
 *   node scripts/update-manifest.mjs generate
 *
 * Without it, this build cannot verify a published manifest and falls back to
 * GitHub's asset digest / TLS — still safe against corruption, not against a
 * compromised repository.
 */
export const UPDATE_PUBLIC_KEY = 'MCowBQYDK2VwAyEAm1zE+wj7lkKH7or9x3KSaShzbIcKTlEgOqbB674RltU='
