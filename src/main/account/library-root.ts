import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { recoveryMarkerFor, userDataFile } from '../json-store'

/**
 * Local roots per account.
 *
 * The signed-out library stays at the legacy `userData/library.json`; each
 * account gets `userData/accounts/<userId>/library.json` plus its sync
 * bookkeeping. The first account to sign in on an install adopts the legacy
 * library once (copied, not moved), so existing users keep everything; a second
 * account starts from an empty root and pulls its own server copy.
 */

type OwnerData = { owner: string }

function ownerFile(): string {
  return userDataFile('account-library.json')
}

function readOwner(): string {
  try {
    const raw = JSON.parse(readFileSync(ownerFile(), 'utf8')) as OwnerData
    return typeof raw.owner === 'string' ? raw.owner : ''
  } catch {
    return ''
  }
}

function writeOwner(owner: string): void {
  try {
    writeFileSync(ownerFile(), JSON.stringify({ owner }))
  } catch {
    // A failed marker only risks a second adoption, never data loss.
  }
}

export function accountDir(userId: string): string {
  return userDataFile(join('accounts', userId))
}

/** A file under one account's root; the directory is created on demand. */
export function accountFile(userId: string, name: string): string {
  const file = join(accountDir(userId), name)
  mkdirSync(dirname(file), { recursive: true })
  return file
}

export function libraryPathFor(userId: string | null): string {
  return userId ? join(accountDir(userId), 'library.json') : userDataFile('library.json')
}

export function legacyOutboxFile(userId: string): string {
  return userDataFile(`account-outbox-${userId.replace(/[^A-Za-z0-9-]/g, '_')}.json`)
}

/** Copy the legacy local library into the first account that signs in. */
export function prepareAccountLibrary(userId: string): void {
  const target = libraryPathFor(userId)
  if (existsSync(recoveryMarkerFor(target))) return
  if (existsSync(target)) {
    if (!readOwner()) writeOwner(userId)
    return
  }

  mkdirSync(dirname(target), { recursive: true })
  const owner = readOwner()
  if (owner === '' || owner === userId) {
    const legacy = userDataFile('library.json')
    if (existsSync(legacy)) {
      try {
        copyFileSync(legacy, target)
      } catch {
        // The account root stays empty and pulls the server copy instead.
      }
    }
    writeOwner(userId)
  }
}

/** Account deletion removes its local library and sync bookkeeping. */
export function removeAccountData(userId: string): void {
  try {
    rmSync(accountDir(userId), { recursive: true, force: true })
  } catch {
    // Downloads and the signed-out library are separate and stay.
  }
  const legacy = legacyOutboxFile(userId)
  const prefix = `${basename(legacy)}.corrupt-`
  let quarantined: string[] = []
  try {
    quarantined = readdirSync(dirname(legacy))
      .filter((file) => file.startsWith(prefix) && /^\d+$/.test(file.slice(prefix.length)))
      .map((file) => join(dirname(legacy), file))
  } catch {
    // The exact legacy paths can still be removed.
  }
  for (const file of [legacy, `${legacy}.tmp`, recoveryMarkerFor(legacy), ...quarantined]) {
    try {
      rmSync(file, { force: true })
    } catch {
      // Try both paths even if one cannot be removed.
    }
  }
}
