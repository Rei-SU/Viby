import type { ImportSource } from '@shared/types'
import { detectImportUrl } from './detect'
import { resolveDeezer } from './deezer'
import { resolveYoutube } from './youtube'
import { resolveApple } from './apple'
import { resolveSoundcloud } from './soundcloud'
import { resolveSpotifyPlaylist } from './spotify'

/** One entry point: detect the service, then hand off to its adapter. */
export async function resolveImport(
  input: string,
  opts: { signal?: AbortSignal } = {}
): Promise<ImportSource> {
  const signal = opts.signal
  const detected = await detectImportUrl(input, signal)

  switch (detected.service) {
    case 'spotify':
      return resolveSpotifyPlaylist(detected.url, { signal })
    case 'deezer':
      return resolveDeezer(detected.id ?? '', signal)
    case 'youtube':
      return resolveYoutube(detected.listId ?? detected.id ?? '', signal)
    case 'apple':
      return resolveApple(detected.url, signal)
    case 'soundcloud':
      return resolveSoundcloud(detected.url, signal)
  }
}

export { matchImport } from './matcher'
export { ImportError } from './errors'
