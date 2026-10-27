import { LOGIN_LAUNCH_ARG, loginItemOptions } from '../src/main/startup'
import { DEFAULT_SETTINGS } from '../src/main/settings'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const base = { launchAtLogin: true, launchMinimized: false }

check(
  'launch at login is on by default and visible startup is the default',
  DEFAULT_SETTINGS.launchAtLogin === true && DEFAULT_SETTINGS.launchMinimized === false,
  JSON.stringify({
    launchAtLogin: DEFAULT_SETTINGS.launchAtLogin,
    launchMinimized: DEFAULT_SETTINGS.launchMinimized
  })
)

check(
  'development never writes a login item',
  loginItemOptions(base, 'win32', false, 'C:\\node_modules\\electron.exe') === null
)
check(
  'other platforms are left alone',
  loginItemOptions(base, 'linux', true, '/usr/bin/viby') === null
)

const win = loginItemOptions(base, 'win32', true, 'C:\\Apps\\Viby.exe')
check(
  'Windows registers the installed executable',
  win?.openAtLogin === true && win?.path === 'C:\\Apps\\Viby.exe' && win?.args === undefined,
  JSON.stringify(win)
)

const winMin = loginItemOptions({ ...base, launchMinimized: true }, 'win32', true, 'C:\\Apps\\Viby.exe')
check(
  'Windows minimized launch carries the launch flag',
  winMin?.args?.length === 1 && winMin.args[0] === LOGIN_LAUNCH_ARG,
  JSON.stringify(winMin)
)

const winOff = loginItemOptions({ ...base, launchAtLogin: false }, 'win32', true, 'C:\\Apps\\Viby.exe')
check('Windows can remove the login item', winOff?.openAtLogin === false, JSON.stringify(winOff))

const mac = loginItemOptions(base, 'darwin', true, '/Applications/Viby.app/Contents/MacOS/Viby')
check(
  'macOS registers the bundle without args',
  mac?.openAtLogin === true && mac?.path === undefined && mac?.args === undefined,
  JSON.stringify(mac)
)

const macMin = loginItemOptions({ ...base, launchMinimized: true }, 'darwin', true, '/Applications/Viby.app/Contents/MacOS/Viby')
check(
  'macOS minimized launch uses the OS login-launch signal',
  macMin?.args === undefined && macMin?.openAtLogin === true,
  JSON.stringify(macMin)
)

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nstartup: all checks passed')
