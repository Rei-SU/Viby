#!/usr/bin/env node
/**
 * Run `make-icons.py` with whichever Python 3 the machine has.
 *
 * The generator needs Pillow (`python -m pip install pillow`). macOS installs
 * expose `python3`; Windows installs usually expose `python`, so the npm script
 * cannot name one interpreter directly.
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const script = join(import.meta.dirname, 'make-icons.py')
const candidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']

for (const bin of candidates) {
  const probe = spawnSync(bin, ['--version'], { stdio: 'ignore' })
  if (probe.status !== 0) continue

  const run = spawnSync(bin, [script], { stdio: 'inherit' })
  if (run.status === 0) process.exit(0)
  if (run.status === null) break

  console.error('\nIcon generation failed. Pillow is required:')
  console.error(`  ${bin} -m pip install pillow`)
  process.exit(run.status)
}

console.error('No Python 3 interpreter found. Install Python, then: python -m pip install pillow')
process.exit(1)
