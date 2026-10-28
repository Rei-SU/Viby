/**
 * Minimal DevTools-protocol client for driving the running app.
 *
 * Start the app with a debugging port first:
 *   VIBY_DEBUG_PORT=9222 npm run dev
 */
const BASE = `http://127.0.0.1:${process.env.VIBY_DEBUG_PORT ?? '9222'}`

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function findPage() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const targets = await (await fetch(`${BASE}/json/list`)).json()
      const page = targets.find((t) => t.type === 'page' && /localhost:5173/.test(t.url ?? ''))
      if (page) return page
    } catch {
      // debugging endpoint not up yet
    }
    await sleep(500)
  }
  throw new Error('no page target found on the debugging port')
}

export async function connect() {
  const page = await findPage()
  const ws = new WebSocket(page.webSocketDebuggerUrl)

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let nextId = 1
  const pending = new Map()

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, (msg) => {
        if (msg.error) return reject(new Error(JSON.stringify(msg.error)))
        resolve(msg)
      })
      ws.send(JSON.stringify({ id, method, params }))
    })

  const evaluate = async (expression, { awaitPromise = true, userGesture = false } = {}) => {
    const msg = await send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture
    })
    const result = msg.result?.result
    if (result?.subtype === 'error') throw new Error(result.description)
    return result?.value
  }

  return { evaluate, send, close: () => ws.close() }
}
