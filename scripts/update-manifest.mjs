#!/usr/bin/env node
/**
 * Ed25519 signing for update manifests.
 *
 *   node scripts/update-manifest.mjs generate
 *     Creates a keypair:
 *       - public key -> src/main/update-key.ts   (commit this)
 *       - private key -> ~/.config/viby/update-key.pem (never commit)
 *
 *   VIBY_UPDATE_KEY="$(cat ~/.config/viby/update-key.pem)" \
 *     node scripts/update-manifest.mjs sign <dir>
 *     Writes <dir>/update-manifest.json covering the installers in <dir>.
 *
 * The release workflow runs the second form with the key from repository
 * secrets, so a compromised GitHub account cannot forge an update.
 */
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Must match `manifestPayload` in src/main/update-manifest.ts. */
export function manifestPayload(version, files) {
  const lines = Object.keys(files)
    .sort()
    .map((name) => `${name} ${files[name]}`)
  return Buffer.from(`${version}\n${lines.join('\n')}\n`, 'utf8')
}

export function signManifest(version, files, privateKeyPem) {
  const key = createPrivateKey(privateKeyPem)
  return sign(null, manifestPayload(version, files), key).toString('base64')
}

const INSTALLER_RE = /^Viby-(macos-(arm|intel)\.dmg|windows-x64\.exe)$/

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

async function generate() {
  const keyModule = resolve('src/main/update-key.ts')
  const keyFile = join(homedir(), '.config', 'viby', 'update-key.pem')
  const previous = await readFile(keyModule, 'utf8').catch(() => '')
  const pinned = /UPDATE_PUBLIC_KEY = '([^']*)'/.exec(previous)?.[1] ?? ''
  const existingKey = await readFile(keyFile, 'utf8').catch(() => '')
  // Rotating the key strands every installed build: their pinned key can no
  // longer verify new releases. Require an explicit --force.
  if ((pinned || existingKey) && !process.argv.includes('--force')) {
    console.error('An update signing key already exists.')
    console.error('Rotating it means already-installed builds will reject new updates.')
    console.error('If you really want a new key, re-run with --force.')
    process.exit(1)
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })

  let source = previous || "export const UPDATE_PUBLIC_KEY = ''\n"
  if (/export const UPDATE_PUBLIC_KEY = '[^']*'/.test(source)) {
    source = source.replace(
      /export const UPDATE_PUBLIC_KEY = '[^']*'/,
      `export const UPDATE_PUBLIC_KEY = '${spki}'`
    )
  } else {
    source += `export const UPDATE_PUBLIC_KEY = '${spki}'\n`
  }
  await writeFile(keyModule, source)

  const folder = join(homedir(), '.config', 'viby')
  await mkdir(folder, { recursive: true, mode: 0o700 })
  await writeFile(keyFile, pem, { mode: 0o600 })
  await chmod(folder, 0o700)
  await chmod(keyFile, 0o600)

  console.log(`Public key written to src/main/update-key.ts — commit it.`)
  console.log(`Private key written to ${keyFile} (never commit it).`)
  console.log('')
  console.log('Add it to GitHub: Settings -> Secrets and variables -> Actions -> New repository secret')
  console.log('  Name:  VIBY_UPDATE_KEY')
  console.log(`  Value: the entire contents of ${keyFile}`)
  console.log('')
  console.log('Until that secret exists, releases publish without a signed manifest.')
}

async function signRelease(dir) {
  const pem = process.env.VIBY_UPDATE_KEY
  if (!pem) {
    console.error('VIBY_UPDATE_KEY is not set.')
    process.exit(1)
  }

  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  const files = {}
  for (const name of (await readdir(dir)).sort()) {
    if (!INSTALLER_RE.test(name)) continue
    files[name] = await sha256(join(dir, name))
  }
  if (Object.keys(files).length === 0) {
    console.error(`No Viby installers found in ${dir}.`)
    process.exit(1)
  }

  const manifest = { version: pkg.version, files, signature: signManifest(pkg.version, files, pem) }
  await writeFile(join(dir, 'update-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Signed ${Object.keys(files).length} installer(s) for ${pkg.version}.`)
}

async function main() {
  const [command, argument] = process.argv.slice(2)
  if (command === 'generate') return generate()
  if (command === 'sign' && argument) return signRelease(resolve(argument))
  console.error('Usage:')
  console.error('  node scripts/update-manifest.mjs generate')
  console.error('  node scripts/update-manifest.mjs sign <artifact-dir>')
  process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
