/**
 * External responses are streamed through a byte counter. Content-Length alone
 * is not enough: a chunked or lying response would otherwise be fully buffered
 * before anyone notices it is too large.
 */
export class OversizedBodyError extends Error {
  constructor() {
    super('Response exceeded the size limit')
    this.name = 'OversizedBodyError'
  }
}

export const MAX_RESPONSE_BYTES = 20 * 1024 * 1024

export async function readBoundedBytes(
  res: Response,
  max = MAX_RESPONSE_BYTES
): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > max) throw new OversizedBodyError()
  if (!res.body) return new Uint8Array()

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > max) {
        await reader.cancel().catch(() => undefined)
        throw new OversizedBodyError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function readBoundedText(
  res: Response,
  max = MAX_RESPONSE_BYTES
): Promise<string> {
  return new TextDecoder().decode(await readBoundedBytes(res, max))
}

export async function readBoundedJson<T>(
  res: Response,
  max = MAX_RESPONSE_BYTES
): Promise<T> {
  return JSON.parse(await readBoundedText(res, max)) as T
}
