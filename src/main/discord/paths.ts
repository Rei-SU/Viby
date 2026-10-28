import { join } from 'node:path'

const PIPE_COUNT = 10

/**
 * Every local Discord socket to try, in order. Discord picks the first free
 * pipe from 0–9; Stable, PTB and Canary can hold different numbers.
 */
export function discordIpcPaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (platform === 'win32') {
    return Array.from({ length: PIPE_COUNT }, (_, index) => `\\\\?\\pipe\\discord-ipc-${index}`)
  }

  const dirs = [env.XDG_RUNTIME_DIR, env.TMPDIR, env.TMP, env.TEMP, '/tmp'].filter(
    (dir): dir is string => Boolean(dir)
  )
  const paths: string[] = []
  const seen = new Set<string>()
  for (const dir of new Set(dirs)) {
    for (let index = 0; index < PIPE_COUNT; index++) {
      const path = join(dir, `discord-ipc-${index}`)
      if (seen.has(path)) continue
      seen.add(path)
      paths.push(path)
    }
  }
  return paths
}
