export const description =
  'A media error stops the fake Pause, recovers from the local download, or shows a visible error'

export async function run(app, check) {
  try {
    const media = await app.evaluate(
      `(async () => {
        const { api, player: p } = window.__viby
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))

        p.clearQueue()
        p.error = null
        await wait(300)

        const downloads = await api.downloads.snapshot()
        const entry = downloads.entries.find((item) => item.track?.id && item.bytes > 0)
        if (!entry) return { missingDownload: true }

        const item = {
          id: entry.track.id,
          kind: 'song',
          title: entry.track.title,
          subtitle: entry.track.artist,
          artists: [entry.track.artist],
          album: entry.track.album,
          albumId: entry.track.albumId,
          releaseType: entry.track.releaseType,
          durationSec: entry.track.durationSec,
          thumbnail: entry.track.thumbnail,
          videoType: entry.track.videoType
        }

        const original = HTMLMediaElement.prototype.play
        let calls = 0
        window.__scenario = { afterError: null }
        HTMLMediaElement.prototype.play = function () {
          calls += 1
          const result = original.call(this)
          if (calls === 1) {
            result
              .then(() => {
                setTimeout(() => {
                  const player = window.__viby.player
                  // The download is the stable recovery source. Pretend this
                  // attempt was remote so recovery does not discard it.
                  if (player.stream) {
                    player.stream = { ...player.stream, kind: 'remote', source: null }
                  }
                  this.dispatchEvent(new Event('error'))
                  window.__scenario.afterError = {
                    playing: player.playing,
                    reconnecting: player.reconnecting,
                    error: player.error
                  }
                }, 700)
              })
              .catch(() => undefined)
            HTMLMediaElement.prototype.play = original
          }
          return result
        }
        window.__restorePlay = () => {
          HTMLMediaElement.prototype.play = original
        }

        await p.playList([item], 0)

        const states = []
        let final = null
        for (let i = 0; i < 200; i++) {
          await wait(100)
          final = {
            playing: p.playing,
            reconnecting: p.reconnecting,
            busy: p.busy,
            error: p.error,
            position: Math.round(p.position),
            stream: p.stream && { kind: p.stream.kind, source: p.stream.source ?? null },
            button: document.querySelector('.dock .play')?.getAttribute('aria-label') ?? null,
            alert: document.querySelector('.alert-card')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
            afterError: window.__scenario.afterError
          }
          states.push(final)
          const recovered =
            final.error === null &&
            final.playing &&
            final.position > 0 &&
            !final.reconnecting
          if (window.__scenario.afterError && recovered) break
          if (final.error) break
        }

        return {
          found: true,
          title: entry.track.title,
          afterError: window.__scenario.afterError,
          final,
          sawReconnecting: states.some((state) => state.reconnecting === true),
          calls
        }
      })()`,
      { userGesture: true }
    )

    check('a downloaded track is available for the recovery check', media.found === true, JSON.stringify(media))
    check(
      'the media error stopped the UI instead of faking Pause',
      media.afterError?.playing === false && media.afterError?.reconnecting === true,
      JSON.stringify(media.afterError)
    )
    check(
      'the error shows the loading state while retrying',
      media.sawReconnecting === true,
      `${media.calls} play calls`
    )

    const recovered =
      media.final?.error === null &&
      media.final.playing === true &&
      media.final.position > 0 &&
      media.final.reconnecting === false
    const failedVisible =
      typeof media.final?.error === 'string' &&
      media.final.error.length > 0 &&
      media.final.playing === false &&
      media.final.reconnecting === false &&
      media.final.button === 'Play' &&
      /Playback problem/.test(media.final.alert ?? '')
    check(
      'the failure recovers from the download or shows a visible error',
      recovered || failedVisible,
      JSON.stringify(media.final)
    )
  } finally {
    await app.evaluate(
      `(() => {
        window.__restorePlay?.()
        const p = window.__viby.player
        p.clearQueue()
        p.error = null
        return true
      })()`
    ).catch(() => undefined)
  }
}
