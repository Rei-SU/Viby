import type { SupabaseClient } from '@supabase/supabase-js'
import type { ConnectDevice } from '@shared/connect'
import type { ConnectChannel, ConnectChannelFactory } from './service'

/**
 * Realtime transport for device presence and hand-off. The channel is private:
 * `realtime.messages` RLS only lets the signed-in account's uid join a topic
 * named `account:<uid>:devices`.
 */
export function createSupabaseChannel(client: SupabaseClient): ConnectChannelFactory {
  return async (topic, presenceKey, handlers) => {
    // A private channel is authorized with the user's JWT. Hand Realtime the
    // restored session token before joining; refreshes are forwarded by
    // supabase-js from then on.
    try {
      const { data } = await client.auth.getSession()
      const token = data.session?.access_token
      if (token) client.realtime.setAuth(token)
    } catch {
      // Joining without a token will simply fail authorization; the service
      // reports devices unavailable and playback is unaffected.
    }

    const channel = client.channel(topic, {
      config: { private: true, presence: { key: presenceKey } }
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<string, unknown[]>
        handlers.onDevices(Object.values(state).flat())
      })
      .on('broadcast', { event: 'device' }, (message) => {
        const payload = (message as { payload?: unknown } | null)?.payload
        handlers.onMessage(payload)
      })
      .subscribe((status) => {
        handlers.onAvailable(status === 'SUBSCRIBED')
      })

    const transport: ConnectChannel = {
      track: async (payload: ConnectDevice) => {
        await channel.track(payload)
      },
      send: async (payload: unknown) => {
        await channel.send({ type: 'broadcast', event: 'device', payload })
      },
      leave: async () => {
        await client.removeChannel(channel)
      }
    }
    return transport
  }
}
