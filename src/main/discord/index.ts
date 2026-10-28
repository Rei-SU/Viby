import { app } from 'electron'
import type { PresenceSnapshot } from '@shared/types'
import { discordIpcPaths } from './paths'
import { DiscordPresence } from './presence'

/** Public Discord application ID for Viby. This is not a secret. */
const DISCORD_CLIENT_ID = '1565024229705908265'

let presence: DiscordPresence | null = null

function socketPaths(): string[] {
  // Dev/test only: let the harness point at a fake Discord socket.
  const override = !app.isPackaged ? process.env.VIBY_DISCORD_IPC : undefined
  return override ? [override] : discordIpcPaths()
}

export function initDiscord(enabled: boolean): void {
  if (!presence) {
    presence = new DiscordPresence({
      clientId: DISCORD_CLIENT_ID,
      paths: socketPaths()
    })
  }
  presence.setEnabled(enabled)
}

export function setDiscordEnabled(enabled: boolean): void {
  presence?.setEnabled(enabled)
}

export function updateDiscordPresence(snapshot: PresenceSnapshot): void {
  presence?.update(snapshot)
}

export function stopDiscord(): void {
  presence?.stop()
  presence = null
}
