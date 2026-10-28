/** Opcodes on Discord's local RPC socket. */
export const DISCORD_OPCODE = {
  handshake: 0,
  frame: 1,
  close: 2,
  ping: 3,
  pong: 4
} as const

export type DiscordFrame = {
  opcode: number
  data: unknown
}

const HEADER_BYTES = 8
const MAX_FRAME_BYTES = 4 * 1024 * 1024

/** A frame is a little-endian u32 opcode, a little-endian u32 length, then JSON. */
export function encodeFrame(opcode: number, data: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(data), 'utf8')
  const header = Buffer.allocUnsafe(HEADER_BYTES)
  header.writeUInt32LE(opcode, 0)
  header.writeUInt32LE(payload.byteLength, 4)
  return Buffer.concat([header, payload])
}

/**
 * Incremental decoder: a socket chunk can hold half a frame or several frames.
 * Malformed payloads are dropped without killing an otherwise healthy socket.
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): DiscordFrame[] {
    if (chunk.length === 0) return []
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    const frames: DiscordFrame[] = []

    while (this.buffer.length >= HEADER_BYTES) {
      const opcode = this.buffer.readUInt32LE(0)
      const length = this.buffer.readUInt32LE(4)
      if (length > MAX_FRAME_BYTES) {
        this.buffer = Buffer.alloc(0)
        throw new Error(`Discord sent an oversized frame (${length} bytes)`)
      }
      if (this.buffer.length < HEADER_BYTES + length) break

      const payload = this.buffer.subarray(HEADER_BYTES, HEADER_BYTES + length).toString('utf8')
      this.buffer = this.buffer.subarray(HEADER_BYTES + length)
      try {
        frames.push({ opcode, data: JSON.parse(payload) })
      } catch {
        // Ignore a bad payload; the connection itself is still usable.
      }
    }

    return frames
  }
}
