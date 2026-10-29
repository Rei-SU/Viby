/**
 * Bounded external-response reads. Run: node tests/unit.mjs bounded-body
 */
import {
  OversizedBodyError,
  readBoundedJson,
  readBoundedText
} from '../src/main/bounded-body'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

function streamed(...chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      }
    })
  )
}

console.log('bounded response reads:')
{
  const text = await readBoundedText(streamed('hello ', 'world'), 64)
  check('reads a chunked body', text === 'hello world', text)

  const json = await readBoundedJson<{ ok: boolean }>(streamed('{"ok":true}'), 64)
  check('parses JSON', json.ok === true)

  let declared = false
  try {
    await readBoundedText(new Response('x'.repeat(100)), 10)
  } catch (error) {
    declared = error instanceof OversizedBodyError
  }
  check('rejects a declared oversize body', declared)

  let chunked = false
  try {
    await readBoundedText(streamed('x'.repeat(6), 'x'.repeat(6)), 10)
  } catch (error) {
    chunked = error instanceof OversizedBodyError
  }
  check('cuts off an undeclared oversize body', chunked)
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
