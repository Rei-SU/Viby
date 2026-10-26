import { sleep } from './lib.mjs'

export const description = 'Home renders artwork from the CDN'

export async function run(app, check) {
  await app.evaluate(`window.__viby.nav.go('home'); true`, { userGesture: true })

  let images = null
  let layout = null
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(250)
    const state = await app.evaluate(`
      (() => {
        const main = document.querySelector('main.content')
        const imgs = [...document.querySelectorAll('img.cover')]
        return {
          images: {
            total: imgs.length,
            loaded: imgs.filter((i) => i.naturalWidth > 0).length,
            broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length
          },
          layout: {
            rails: document.querySelectorAll('main .rail').length,
            mainOverflow: main ? main.scrollWidth > main.clientWidth + 1 : true
          }
        }
      })()
    `)
    images = state.images
    layout = state.layout
    if (images.loaded > 0 && images.broken === 0 && layout.rails > 0) break
  }

  console.log(`  total=${images.total} loaded=${images.loaded} broken=${images.broken}`)
  check('home renders artwork', images.total > 0 && images.loaded > 0, `${images.loaded}/${images.total}`)
  check('no broken images', images.broken === 0, `${images.broken}`)

  // Home keeps its carousels; the page itself must not overflow when the
  // lyrics sidebar is open, even though the rails scroll internally.
  check(
    'home carousels stay inside the docked page',
    layout.rails > 0 && !layout.mainOverflow,
    JSON.stringify(layout)
  )
}
