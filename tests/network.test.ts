/**
 * Connectivity state machine with injected link/probe results. Run:
 *   node tests/unit.mjs network
 */
import type { NetworkState } from '../src/shared/types'
import { NetworkMonitor, type NetworkDeps } from '../src/main/network'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

function deps(over: Partial<NetworkDeps> = {}): NetworkDeps {
  return {
    isOnline: () => true,
    probe: async () => true,
    forcedOffline: () => false,
    override: null,
    ...over
  }
}

console.log('no link is authoritative:')
{
  const monitor = new NetworkMonitor(deps({ isOnline: () => false, probe: async () => true }))
  await monitor.refresh()
  check('offline without a link', monitor.get().status === 'offline', monitor.get().status)
  check('isOffline', monitor.isOffline())
  check('local-first layout', monitor.isLocalFirst())
}

console.log('\nonline requires a probe:')
{
  const monitor = new NetworkMonitor(deps())
  await monitor.refresh()
  check('online when the probe answers', monitor.get().status === 'online')
  check('not offline', !monitor.isOffline() && !monitor.isLocalFirst())
}

console.log('\none failed probe does not flip the app:')
{
  let reachable = false
  const monitor = new NetworkMonitor(deps({ probe: async () => reachable }))
  await monitor.refresh()
  check('still online after the first miss', monitor.get().status === 'online', monitor.get().status)
  await monitor.refresh()
  check('unreachable after a second miss', monitor.get().status === 'unreachable', monitor.get().status)
  check('unreachable is local-first but not offline', monitor.isLocalFirst() && !monitor.isOffline())

  reachable = true
  await monitor.refresh()
  check('recovers to online', monitor.get().status === 'online')
}

console.log('\nforced offline is a manual mode:')
{
  const monitor = new NetworkMonitor(deps({ forcedOffline: () => true }))
  await monitor.refresh()
  check('forced state', monitor.get().forcedOffline && monitor.get().status === 'offline')
  check('manual reads as offline', monitor.isOffline())
}

console.log('\ndev override short-circuits the network:')
{
  const monitor = new NetworkMonitor(
    deps({ override: 'unreachable', isOnline: () => true, probe: async () => true })
  )
  monitor.start()
  check('override wins at start', monitor.get().status === 'unreachable', monitor.get().status)
  monitor.stop()

  const forced = new NetworkMonitor(
    deps({ override: 'online', forcedOffline: () => true })
  )
  await forced.refresh()
  check('manual mode still beats the override', forced.get().forcedOffline === true)
}

console.log('\nlisteners see transitions:')
{
  let reachable = false
  const seen: NetworkState[] = []
  const monitor = new NetworkMonitor(deps({ probe: async () => reachable }))
  monitor.onChange((state) => seen.push(state))
  await monitor.refresh(true)
  check('unreachable emitted', seen.some((s) => s.status === 'unreachable'))
  reachable = true
  await monitor.refresh()
  check('online emitted', seen.some((s) => s.status === 'online'))
  const before = seen.length
  await monitor.refresh()
  check('no duplicate emit for the same state', seen.length === before)
}

console.log('\nan in-flight probe cannot overwrite a newer manual switch:')
{
  let forced = false
  let resolveProbe: (reachable: boolean) => void = () => undefined
  const monitor = new NetworkMonitor(
    deps({
      forcedOffline: () => forced,
      probe: () =>
        new Promise<boolean>((resolve) => {
          resolveProbe = resolve
        })
    })
  )

  // A poll is mid-flight...
  const inflight = monitor.refresh(true)
  // ...when the user turns on manual offline.
  forced = true
  monitor.applySettings()
  check('manual mode applies immediately', monitor.get().forcedOffline === true)

  // The stale probe now answers "reachable" — it must be ignored.
  resolveProbe(true)
  await inflight
  check(
    'the stale probe does not flip the app back online',
    monitor.get().forcedOffline === true && monitor.get().status === 'offline',
    JSON.stringify(monitor.get())
  )
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
