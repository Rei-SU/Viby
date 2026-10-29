import { UpdateIntegrityError, type ReleaseInfo } from './updater'
import { verifyManifest } from './update-manifest'
import { UPDATE_PUBLIC_KEY } from './update-key'
import { readBoundedJson } from './bounded-body'

const LATEST_RELEASE = 'https://api.github.com/repos/Rei-SU/Viby/releases/latest'
const MANIFEST_ASSET = 'update-manifest.json'

type GithubAsset = {
  name?: string
  browser_download_url?: string
  /** `sha256:<hex>` for assets GitHub computed a digest for. */
  digest?: string | null
}

type GithubRelease = {
  tag_name?: string
  html_url?: string
  assets?: GithubAsset[]
}

/**
 * The public GitHub API is the update channel: no token, no account, one
 * request per check. Windows normally uses electron-updater's `latest.yml`
 * instead; this feed serves macOS, where no latest-mac.yml is published
 * because an unsigned build cannot install in place (PLAN §2.1).
 *
 * When the release carries `update-manifest.json`, its Ed25519 signature is
 * verified against the key compiled into this build before any hash is
 * trusted. A published-but-invalid manifest blocks the update.
 */
export async function fetchLatestRelease(arch: string): Promise<ReleaseInfo> {
  const release = releaseFromGithub(await fetchJson(LATEST_RELEASE), arch)

  if (UPDATE_PUBLIC_KEY) {
    // Fail closed: once a key is pinned, deleting the manifest must not
    // downgrade verification to the GitHub digest.
    if (!release.manifestUrl) {
      throw new UpdateIntegrityError('This release has no signed update manifest.')
    }
    let manifest: unknown
    try {
      manifest = await fetchJson(release.manifestUrl)
    } catch {
      throw new UpdateIntegrityError('The update manifest could not be downloaded.')
    }
    const signed = verifyManifest(manifest)
    if (signed) {
      if (signed.version !== release.version) {
        throw new UpdateIntegrityError('The update manifest does not match this release.')
      }
      release.artifacts = signed.files
    }
  }

  return release
}

/**
 * Pure mapping of the API payload, so asset selection and digest handling are
 * testable without the network (`tests/updates.test.ts`).
 */
export function releaseFromGithub(json: unknown, arch: string): ReleaseInfo {
  if (!json || typeof json !== 'object') throw new Error('GitHub returned an unexpected response.')
  const release = json as GithubRelease
  if (typeof release.tag_name !== 'string' || typeof release.html_url !== 'string') {
    throw new Error('GitHub returned an unexpected response.')
  }

  const wanted = arch === 'arm64' ? 'Viby-macos-arm.dmg' : 'Viby-macos-intel.dmg'
  const assets = Array.isArray(release.assets) ? release.assets : []
  const asset = assets.find((item) => item?.name === wanted)
  const manifestAsset = assets.find((item) => item?.name === MANIFEST_ASSET)
  // Older uploads have no digest. When GitHub reports one, verify it after the
  // download; when it does not, the signed manifest (or TLS) is the guarantee.
  const digest =
    typeof asset?.digest === 'string' && asset.digest.startsWith('sha256:')
      ? asset.digest.slice('sha256:'.length)
      : undefined

  return {
    version: release.tag_name.replace(/^v/, ''),
    url: release.html_url,
    installerUrl: typeof asset?.browser_download_url === 'string' ? asset.browser_download_url : undefined,
    installerSha256: digest,
    manifestUrl:
      typeof manifestAsset?.browser_download_url === 'string'
        ? manifestAsset.browser_download_url
        : undefined
  }
}

async function fetchJson(url: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Viby-updater'
      },
      signal: AbortSignal.timeout(10_000)
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('GitHub took too long to respond. Try again.')
    }
    throw new Error('Could not reach GitHub. Check your connection and try again.')
  }

  if (response.status === 404) throw new Error('No release has been published yet.')
  if (response.status === 403) throw new Error('GitHub rate-limited the check. Try again in a few minutes.')
  if (!response.ok) throw new Error(`GitHub returned ${response.status}.`)

  try {
    return await readBoundedJson<unknown>(response, 1024 * 1024)
  } catch {
    throw new Error('GitHub returned an unexpected response.')
  }
}
