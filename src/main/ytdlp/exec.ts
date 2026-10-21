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

export type StreamOptions = RunOptions & {
  /** Called once per complete stdout line. Progress output is line-based. */
  onStdoutLine?: (line: string) => void
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

/**
 * Streaming variant for the download manager. Progress arrives as separate
 * lines on stdout, so buffering the whole run would leave the UI at 0% until the
 * file was already finished.
 */
export function runStreamed(cmd: string, args: string[], opts: StreamOptions = {}): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    let buffered = ''
    let timedOut = false
    let settled = false

    const emitLines = (final = false): void => {
      const parts = buffered.split('\n')
      buffered = final ? '' : (parts.pop() ?? '')
      for (const raw of parts) {
        const line = raw.replace(/\r$/, '')
        if (line) opts.onStdoutLine?.(line)
      }
      if (final && buffered) {
        const line = buffered.replace(/\r$/, '')
        if (line) opts.onStdoutLine?.(line)
      }
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      buffered += text
      emitLines()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      // Flush a final line that did not end in a newline (e.g. after_move:filepath
      // on some yt-dlp builds).
      emitLines(true)
      fn()
    }

    child.on('error', (err) => finish(() => reject(err)))

    child.on('close', (code) => {
      finish(() => resolve({ code: code ?? -1, stdout, stderr, timedOut }))
    })
  })
}
