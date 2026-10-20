import type { ImportSource } from '@shared/types'
import { detectImportUrl } from './detect'
import { resolveDeezer } from './deezer'
import { resolveYoutube } from './youtube'
import { resolveApple } from './apple'
import { resolveSoundcloud } from './soundcloud'
import { resolveSpotifyPlaylist } from './spotify'

/** One entry point: detect the service, then hand off to its adapter. */
export async function resolveImport(input: string): Promise<ImportSource> {
  const detected = await detectImportUrl(input)

  switch (detected.service) {
    case 'spotify':
      return resolveSpotifyPlaylist(detected.url)
    case 'deezer':
      return resolveDeezer(detected.id ?? '')
    case 'youtube':
      return resolveYoutube(detected.listId ?? detected.id ?? '')
    case 'apple':
      return resolveApple(detected.url)
    case 'soundcloud':
      return resolveSoundcloud(detected.url)
  }
}

export { matchImport } from './matcher'
export { ImportError } from './errors'
