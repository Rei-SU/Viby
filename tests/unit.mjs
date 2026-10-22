import { execFileSync } from 'node:child_process'

/**
 * Runs the Node-side suites (no app required).
 *
 *   node tests/unit.mjs lyrics library
 *   node tests/unit.mjs            # all
 */
const suites = {
  resolver: { file: 'resolver.test.ts', electron: true },
  innertube: { file: 'innertube.test.ts' },
  catalog: { file: 'catalog.test.ts' },
  thumbs: { file: 'thumbs.test.ts' },
  'artist-shelves': { file: 'artist-shelves.test.ts' },
  library: { file: 'library.test.ts', electron: true },
  lyrics: { file: 'lyrics.test.ts', electron: true },
  spotify: { file: 'spotify-import.test.ts' },
  import: { file: 'import-adapters.test.ts' },
  'downloads-store': { file: 'downloads-store.test.ts', electron: true },
  'downloads-manager': { file: 'downloads-manager.test.ts', electron: true },
  'download-groups': { file: 'download-groups.test.ts' },
  'library-items': { file: 'library-items.test.ts' },
  'player-source': { file: 'player-source.test.ts' },
  images: { file: 'images.test.ts', electron: true },
  network: { file: 'network.test.ts', electron: true }
}

const requested = process.argv.slice(2)
const unknown = requested.filter((name) => !suites[name])

if (unknown.length > 0) {
  console.error(`Unknown suite(s): ${unknown.join(', ')}`)
  console.error(`Available: ${Object.keys(suites).join(', ')}`)
  process.exit(2)
}

const selected = requested.length > 0 ? requested : Object.keys(suites)
const esbuild = 'node_modules/.bin/esbuild'

let failures = 0
for (const name of selected) {
  const suite = suites[name]
  const out = `/tmp/viby-${name}.mjs`

  const args = [
    `tests/${suite.file}`,
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--alias:@shared=./src/shared',
    ...(suite.electron ? ['--alias:electron=./tests/electron-stub.ts'] : []),
    `--outfile=${out}`,
    '--log-level=warning'
  ]

  console.log(`\n▶ ${name}`)
  try {
    execFileSync(esbuild, args, { stdio: 'inherit' })
    execFileSync(process.execPath, [out], { stdio: 'inherit' })
  } catch {
    failures++
  }
}

console.log(`\n${failures === 0 ? 'ALL SUITES PASSED' : `${failures} SUITE(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
