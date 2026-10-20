import { spawn } from 'node:child_process'

export type RunResult = {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export type RunOptions = {
  timeoutMs?: number
  signal?: AbortSignal
}

/**
 * Spawn a child process, capture output, and always clean up. Every yt-dlp call
 * goes through here so the concurrency cap and timeouts are enforced in one place.
 */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      fn()
    }

    child.on('error', (err) => finish(() => reject(err)))

    child.on('close', (code) => {
      finish(() => resolve({ code: code ?? -1, stdout, stderr, timedOut }))
    })
  })
}
