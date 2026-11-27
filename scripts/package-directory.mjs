import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const cli = require.resolve('electron-builder/cli.js')
const config = process.platform === 'darwin' ? ['--config', 'electron-builder.mac.yml'] : []
const build = spawnSync(process.execPath, [cli, ...config, '--dir', ...process.argv.slice(2)], {
  stdio: 'inherit'
})
if (build.error) throw build.error
process.exitCode = build.status ?? 1
