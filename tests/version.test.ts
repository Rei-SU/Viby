/**
 * SemVer ordering used by the updater. Run:
 *   node tests/unit.mjs version
 */
import { compareVersions, isNewer, parseVersion } from '../src/main/version'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('numeric ordering:')
check('0.1.1 after 0.1.0', compareVersions('0.1.1', '0.1.0') === 1)
check('0.2.0 after 0.1.9', compareVersions('0.2.0', '0.1.9') === 1)
check('1.0.0 after 0.99.99', compareVersions('1.0.0', '0.99.99') === 1)
check('equal versions', compareVersions('0.1.0', '0.1.0') === 0)
check('older is negative', compareVersions('0.1.0', '0.2.0') === -1)
check('10 > 9, not lexical', compareVersions('0.10.0', '0.9.0') === 1)

console.log('\ntag prefixes and build metadata:')
check('v-prefix compares', compareVersions('v0.2.0', '0.1.0') === 1)
check('build metadata ignored', compareVersions('0.1.0+build.7', '0.1.0') === 0)

console.log('\nprereleases:')
check('prerelease sorts before the release', compareVersions('0.2.0-beta.1', '0.2.0') === -1)
check('rc before release', compareVersions('0.2.0-rc.1', '0.2.0') === -1)
check('beta.2 after beta.1', compareVersions('0.2.0-beta.2', '0.2.0-beta.1') === 1)
check('beta.10 after beta.9', compareVersions('0.2.0-beta.10', '0.2.0-beta.9') === 1)
check('alpha before beta', compareVersions('0.2.0-alpha', '0.2.0-beta') === -1)
check('rc after beta', compareVersions('0.2.0-rc.1', '0.2.0-beta.9') === 1)
check('prerelease of a newer patch still after', compareVersions('0.1.1-beta.1', '0.1.0') === 1)

console.log('\ninvalid input never triggers an update:')
check('garbage does not parse', parseVersion('latest') === null)
check('incomplete does not parse', parseVersion('0.2') === null)
check('junk compares equal', compareVersions('junk', '0.1.0') === 0)
check('junk is not newer', !isNewer('junk', '0.1.0'))
check('null-ish is not newer', !isNewer('', '0.1.0'))

console.log('\nparse fields:')
{
  const parsed = parseVersion('v1.2.3-beta.4')
  check('major/minor/patch', parsed?.major === 1 && parsed?.minor === 2 && parsed?.patch === 3)
  check('prerelease parts', parsed?.prerelease.join('.') === 'beta.4', JSON.stringify(parsed?.prerelease))
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
