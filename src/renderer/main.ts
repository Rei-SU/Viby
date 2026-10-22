import { mount } from 'svelte'
import App from './App.svelte'
import './styles/global.css'
import { api } from './lib/api'
import { nav } from './lib/nav.svelte'
import { player } from './lib/player.svelte'
import { searchState } from './lib/search.svelte'

const app = mount(App, { target: document.getElementById('app')! })

// Dev-only handle used to drive the real app over the DevTools protocol while
// testing (PLAN §12). `import.meta.env.DEV` is false in a production build, so
// this cannot ship.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__viby = { api, nav, player, searchState }
}

export default app
