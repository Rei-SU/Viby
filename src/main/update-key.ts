/**
 * Ed25519 public key (base64 SPKI) for `update-manifest.json`.
 *
 * A key is pinned here. Releases must carry a manifest signed by its private
 * counterpart (`VIBY_UPDATE_KEY` in CI) or this build fails closed. To replace
 * it for a fork or a deliberate rotation:
 *
 *   node scripts/update-manifest.mjs generate --force
 *
 * Rotating strands already-installed builds: their pinned key will reject the
 * new manifest.
 */
export const UPDATE_PUBLIC_KEY = 'MCowBQYDK2VwAyEAm1zE+wj7lkKH7or9x3KSaShzbIcKTlEgOqbB674RltU='
