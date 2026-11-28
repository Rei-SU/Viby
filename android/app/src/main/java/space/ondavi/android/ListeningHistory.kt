package space.ondavi.android

import android.os.Handler
import android.os.SystemClock
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

internal class ListeningHistory(private val player: Player, private val library: LocalLibrary) : Player.Listener {
    private val handler = Handler(player.applicationLooper)
    private val check = Runnable { refresh() }
    private var song: Song? = player.currentMediaItem?.librarySong()
    private var occurrenceId = player.currentMediaItem?.mediaId
    private var elapsed = 0L
    private var startedAt: Long? = null
    private var recorded = false

    init {
        player.addListener(this)
        refresh()
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        val id = mediaItem?.mediaId
        if (id == occurrenceId && reason != Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT) return
        checkpoint()
        occurrenceId = id
        song = mediaItem?.librarySong()
        elapsed = 0
        recorded = false
    }

    override fun onEvents(player: Player, events: Player.Events) {
        if (events.containsAny(Player.EVENT_MEDIA_ITEM_TRANSITION, Player.EVENT_IS_PLAYING_CHANGED)) refresh()
    }

    private fun refresh() {
        checkpoint()
        handler.removeCallbacks(check)
        if (player.isPlaying && !recorded && song != null) {
            startedAt = SystemClock.elapsedRealtime()
            handler.postDelayed(check, (30_000 - elapsed).coerceAtLeast(1))
        }
    }

    private fun checkpoint() {
        startedAt?.let { elapsed += SystemClock.elapsedRealtime() - it }
        startedAt = null
        val played = song ?: return
        if (recorded || elapsed < 30_000) return
        recorded = true
        val playedAt = System.currentTimeMillis()
        writes.launch {
            try {
                library.recordPlay(played, playedAt)
            } catch (error: Exception) {
                Log.w("OndaviLibrary", "Couldn’t save listening history", error)
            }
        }
    }

    fun close() {
        player.removeListener(this)
        handler.removeCallbacks(check)
        checkpoint()
    }

    companion object {
        private val writes = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    }
}
