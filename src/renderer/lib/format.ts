/** Clock-style duration used by every row, card and player surface. */
export function formatDuration(
  seconds: number | null | undefined,
  fallback = '0:00'
): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return fallback
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`
}
