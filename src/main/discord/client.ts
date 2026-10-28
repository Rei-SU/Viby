import net from 'node:net'
import type { DiscordActivity } from './activity'
import { DISCORD_OPCODE, FrameDecoder, encodeFrame } from './frame'

const CONNECT_TIMEOUT_MS = 1_000
const READY_TIMEOUT_MS = 5_000
const RESPONSE_TIMEOUT_MS = 5_000

type PendingResponse = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type ReadyWait = {
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type DiscordIpcClientOptions = {
  clientId: string
  paths: string[]
  pid?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function errorMessage(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined
  if (typeof data.message === 'string') return data.message
  if (!isRecord(data.data)) return undefined
  return typeof data.data.message === 'string' ? data.data.message : undefined
}

/**
 * One local Discord RPC connection. The client owns framing and request
 * matching; reconnects and throttling belong to DiscordPresence.
 */
export class DiscordIpcClient {
  private socket: net.Socket | null = null
  private decoder = new FrameDecoder()
  private readonly pending = new Map<string, PendingResponse>()
  private readonly pid: number
  private ready = false
  private nextNonce = 0
  private closeHandler: (() => void) | null = null
  private readyWait: ReadyWait | null = null

  constructor(private readonly options: DiscordIpcClientOptions) {
    this.pid = options.pid ?? process.pid
  }

  get isReady(): boolean {
    return this.ready && this.socket !== null && !this.socket.destroyed
  }

  /** Called when a live connection drops, so the manager can retry. */
  onClose(handler: () => void): void {
    this.closeHandler = handler
  }

  async open(): Promise<void> {
    if (this.isReady) return
    let lastError: Error | null = null
    for (const path of this.options.paths) {
      try {
        await this.openAt(path)
        return
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
      }
    }
    throw lastError ?? new Error('Discord is not running')
  }

  async setActivity(activity: DiscordActivity | null): Promise<void> {
    const socket = this.socket
    if (!socket || !this.ready) throw new Error('Discord is not connected')

    const nonce = String(++this.nextNonce)
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce)
        reject(new Error('Discord did not answer the activity update'))
      }, RESPONSE_TIMEOUT_MS)
      this.pending.set(nonce, { resolve, reject, timer })
      try {
        socket.write(
          encodeFrame(DISCORD_OPCODE.frame, {
            cmd: 'SET_ACTIVITY',
            args: { pid: this.pid, activity },
            nonce
          })
        )
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(nonce)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    await response
  }

  close(): void {
    const socket = this.socket
    this.socket = null
    this.ready = false
    const error = new Error('Discord connection closed')
    this.failReadyWait(error)
    this.rejectAll(error)
    if (!socket) return
    try {
      socket.end(encodeFrame(DISCORD_OPCODE.close, {}))
    } catch {
      socket.destroy()
    }
  }

  private async openAt(path: string): Promise<void> {
    let socket: net.Socket
    try {
      socket = net.createConnection(path)
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error))
    }

    this.decoder = new FrameDecoder()
    this.socket = socket
    // Keep a listener attached for the whole attempt: a timeout or a late error
    // must never surface as an unhandled 'error' event.
    socket.on('error', () => {
      // A close event follows every socket error.
    })

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        socket.destroy()
        reject(new Error(`Timed out connecting to ${path}`))
      }, CONNECT_TIMEOUT_MS)

      const cleanup = (): void => {
        clearTimeout(timer)
        socket.removeListener('connect', onConnect)
        socket.removeListener('error', onError)
      }
      const onConnect = (): void => {
        cleanup()
        resolve()
      }
      const onError = (error: Error): void => {
        cleanup()
        socket.destroy()
        reject(error)
      }

      socket.once('connect', onConnect)
      socket.once('error', onError)
    }).catch((error) => {
      if (this.socket === socket) this.socket = null
      throw error
    })

    socket.on('data', (chunk) => this.handleData(chunk))
    socket.on('close', () => this.handleClose(socket))

    try {
      await this.handshake()
    } catch (error) {
      if (this.socket === socket) this.socket = null
      this.ready = false
      this.failReadyWait(new Error('Discord handshake failed'))
      this.rejectAll(new Error('Discord handshake failed'))
      socket.destroy()
      throw error
    }
  }

  private handshake(): Promise<void> {
    const socket = this.socket
    if (!socket) return Promise.reject(new Error('Not connected'))

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyWait = null
        reject(new Error('Discord did not finish the handshake'))
      }, READY_TIMEOUT_MS)
      this.readyWait = { resolve, reject, timer }
      try {
        socket.write(
          encodeFrame(DISCORD_OPCODE.handshake, {
            v: 1,
            client_id: this.options.clientId
          })
        )
      } catch (error) {
        clearTimeout(timer)
        this.readyWait = null
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private handleData(chunk: Buffer): void {
    let frames
    try {
      frames = this.decoder.push(chunk)
    } catch (error) {
      this.rejectAll(error instanceof Error ? error : new Error(String(error)))
      this.socket?.destroy()
      return
    }

    for (const frame of frames) {
      if (frame.opcode === DISCORD_OPCODE.ping) {
        try {
          this.socket?.write(encodeFrame(DISCORD_OPCODE.pong, frame.data))
        } catch {
          // The socket is closing; the close handler will clean up.
        }
        continue
      }
      if (frame.opcode === DISCORD_OPCODE.close) {
        this.socket?.destroy()
        continue
      }
      if (frame.opcode !== DISCORD_OPCODE.frame) continue
      this.handleMessage(frame.data)
    }
  }

  private handleMessage(data: unknown): void {
    if (!isRecord(data)) return

    if (data.evt === 'READY') {
      this.ready = true
      if (this.readyWait) {
        clearTimeout(this.readyWait.timer)
        this.readyWait.resolve()
        this.readyWait = null
      }
      return
    }

    const nonce = typeof data.nonce === 'string' ? data.nonce : null
    if (data.evt === 'ERROR') {
      const error = new Error(errorMessage(data) ?? 'Discord rejected the request')
      if (nonce) this.rejectPending(nonce, error)
      else this.rejectAll(error)
      return
    }

    if (nonce) this.resolvePending(nonce, data)
  }

  private handleClose(socket: net.Socket): void {
    if (this.socket !== socket) return
    this.socket = null
    this.ready = false

    const error = new Error('Discord connection closed')
    this.failReadyWait(error)
    this.rejectAll(error)
    this.closeHandler?.()
  }

  private failReadyWait(error: Error): void {
    if (!this.readyWait) return
    clearTimeout(this.readyWait.timer)
    this.readyWait.reject(error)
    this.readyWait = null
  }

  private resolvePending(nonce: string, value: unknown): void {
    const pending = this.pending.get(nonce)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(nonce)
    pending.resolve(value)
  }

  private rejectPending(nonce: string, error: Error): void {
    const pending = this.pending.get(nonce)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(nonce)
    pending.reject(error)
  }

  private rejectAll(error: Error): void {
    for (const [nonce, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(nonce)
      pending.reject(error)
    }
  }
}
