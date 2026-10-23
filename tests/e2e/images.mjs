import { sleep } from './lib.mjs'

export const description = 'Home renders artwork from the CDN'

export async function run(app, check) {
  await app.evaluate(`window.__viby.nav.go('home'); true`, { userGesture: true })
  await sleep(2500)

  const images = await app.evaluate(`
    (() => {
      const imgs = [...document.querySelectorAll('img.cover')]
      return {
        total: imgs.length,
        loaded: imgs.filter((i) => i.naturalWidth > 0).length,
        broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length
      }
    })()
  `)

  console.log(`  total=${images.total} loaded=${images.loaded} broken=${images.broken}`)
  check('home renders artwork', images.total > 0 && images.loaded > 0, `${images.loaded}/${images.total}`)
  check('no broken images', images.broken === 0, `${images.broken}`)

  // Home keeps its carousels; the page itself must not overflow when the
  // lyrics sidebar is open, even though the rails scroll internally.
  const layout = await app.evaluate(`
    (() => {
      const main = document.querySelector('main.content')
      return {
        rails: document.querySelectorAll('main .rail').length,
        mainOverflow: main ? main.scrollWidth > main.clientWidth + 1 : true
      }
    })()
  `)
  check(
    'home carousels stay inside the docked page',
    layout.rails > 0 && !layout.mainOverflow,
    JSON.stringify(layout)
  )
}
