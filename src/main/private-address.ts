import { isIP } from 'node:net'

/**
 * True for loopback, link-local, private and carrier-grade NAT addresses.
 * Shared by the image fetcher and the import redirect guard; any loosening here
 * weakens both SSRF boundaries. Non-IP input is treated as unsafe.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const [a, b] = address.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  if (family === 6) {
    const lower = address.toLowerCase()
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7))
    return (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb')
    )
  }
  return true
}
