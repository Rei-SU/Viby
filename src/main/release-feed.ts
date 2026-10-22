import type { ReleaseInfo } from './updater'

const LATEST_RELEASE = 'https://api.github.com/repos/Rei-SU/Viby/releases/latest'

type GithubAsset = {
  name?: string
  browser_download_url?: string
  /** `sha256:<hex>` for assets uploaded after GitHub added digests. */
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
 */
export async function fetchLatestRelease(arch: string): Promise<ReleaseInfo> {
  const response = await fetch(LATEST_RELEASE, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Viby-updater'
    },
    signal: AbortSignal.timeout(10_000)
  })

  if (response.status === 404) throw new Error('No release has been published yet.')
  if (response.status === 403) throw new Error('GitHub rate-limited the check. Try again in a few minutes.')
  if (!response.ok) throw new Error(`GitHub returned ${response.status}.`)

  const release = (await response.json()) as GithubRelease
  if (!release.tag_name || !release.html_url) throw new Error('GitHub returned an unexpected response.')

  const wanted = arch === 'arm64' ? 'Viby-macos-arm.dmg' : 'Viby-macos-intel.dmg'
  const asset = release.assets?.find((item) => item.name === wanted)
  const digest = asset?.digest?.startsWith('sha256:') ? asset.digest.slice('sha256:'.length) : undefined

  return {
    version: release.tag_name.replace(/^v/, ''),
    url: release.html_url,
    installerUrl: asset?.browser_download_url,
    installerSha256: digest
  }
}
