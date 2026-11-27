import assert from 'node:assert/strict'

type Handler = (request: Request) => Response
let handler: Handler = () => { throw new Error('Edge function did not register a handler') }
Object.assign(globalThis, { Deno: { serve: (run: Handler) => { handler = run } } })

await import('../supabase/functions/auth-open/index')
const landing = handler(new Request('https://example.com/auth-open?code=opaque'))
assert.equal(landing.status, 200)
assert.equal(landing.headers.get('cache-control'), 'no-store')
assert.equal(landing.headers.get('referrer-policy'), 'no-referrer')
const page = await landing.text()
assert.match(page, /\['code', 'error', 'error_description'\]/)
assert.doesNotMatch(page, /token_hash|access_token|refresh_token|location\.hash/)
assert.equal(handler(new Request('https://example.com/auth-open', { method: 'POST' })).status, 405)

await import('../supabase/functions/spotify-resolve/index')
const retired = handler(new Request('https://example.com/spotify-resolve'))
assert.equal(retired.status, 410)
assert.equal(retired.headers.get('cache-control'), 'no-store')
assert.match((await retired.json()).error, /Update Viby/)
console.log('PASS  PKCE-only landing page and retired Spotify endpoint')
