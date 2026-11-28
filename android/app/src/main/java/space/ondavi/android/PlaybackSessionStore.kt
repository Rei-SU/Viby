package space.ondavi.android

import android.content.Context
import android.os.Handler
import androidx.annotation.OptIn
import androidx.core.content.edit
import androidx.core.net.toUri
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONArray
import org.json.JSONObject

@OptIn(UnstableApi::class)
internal class PlaybackSessionStore(context: Context, private val player: ExoPlayer) : Player.Listener {
    private val preferences = context.getSharedPreferences("playback", Context.MODE_PRIVATE)
    private val handler = Handler(player.applicationLooper)
    private var lastSaved = preferences.getString("session", null)
    private val checkpoint = Runnable { saveAndSchedule() }

    init {
        restore()
        player.addListener(this)
    }

    private fun restore() {
        val session = lastSaved?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return
        val items = session.optJSONArray("items") ?: return
        val queue = buildList {
            for (index in 0 until items.length()) {
                val item = items.optJSONObject(index) ?: continue
                val id = item.optString("id").takeIf(String::isNotBlank) ?: continue
                val uri = item.optString("uri").toUri()
                if (uri.scheme != "content" && !isSongUri(uri)) continue
                add(
                    queueItem(
                        uri = uri,
                        title = item.optString("title", "Audio"),
                        artist = item.optionalString("artist"),
                        artwork = item.optionalString("artwork")?.toUri()?.takeIf { it.scheme == "https" },
                        mimeType = item.optionalString("mimeType"),
                        id = id
                    )
                )
            }
        }.distinctBy { it.mediaId }
        val repeat = session.optInt("repeat")
        if (repeat in Player.REPEAT_MODE_OFF..Player.REPEAT_MODE_ALL) player.repeatMode = repeat
        if (queue.isNotEmpty()) {
            val active = queue.indexOfFirst { it.mediaId == session.optString("current") }
            val position = if (active >= 0) session.optLong("position").coerceAtLeast(0L) else 0L
            player.setMediaItems(queue, active.coerceAtLeast(0), position)
            session.optJSONArray("order")?.let { order ->
                val indices = queue.mapIndexed { index, item -> item.mediaId to index }.toMap()
                val restored = (0 until order.length()).mapNotNull { indices[order.optString(it)] }
                if (restored.size == queue.size && restored.toSet().size == queue.size) {
                    player.setQueueOrder(restored)
                }
            }
        }
        player.shuffleModeEnabled = session.optBoolean("shuffle")
    }

    override fun onEvents(player: Player, events: Player.Events) {
        if (events.containsAny(
                Player.EVENT_TIMELINE_CHANGED,
                Player.EVENT_MEDIA_ITEM_TRANSITION,
                Player.EVENT_POSITION_DISCONTINUITY,
                Player.EVENT_IS_PLAYING_CHANGED,
                Player.EVENT_PLAY_WHEN_READY_CHANGED,
                Player.EVENT_SHUFFLE_MODE_ENABLED_CHANGED,
                Player.EVENT_REPEAT_MODE_CHANGED
            )
        ) saveAndSchedule()
    }

    private fun saveAndSchedule() {
        save()
        handler.removeCallbacks(checkpoint)
        if (player.isPlaying) handler.postDelayed(checkpoint, 5_000L)
    }

    private fun save() {
        val items = (0 until player.mediaItemCount).map(player::getMediaItemAt)
        val queue = JSONArray()
        items.forEach { item ->
            val source = item.localConfiguration ?: return@forEach
            val metadata = item.mediaMetadata
            queue.put(JSONObject().apply {
                put("id", item.mediaId)
                put("uri", source.uri.toString())
                put("title", metadata.title?.toString())
                put("artist", metadata.artist?.toString())
                put("artwork", metadata.artworkUri?.toString())
                put("mimeType", source.mimeType)
            })
        }
        val session = JSONObject().apply {
            put("items", queue)
            put("current", player.currentMediaItem?.mediaId)
            put("position", if (player.playbackState == Player.STATE_ENDED) 0L else player.currentPosition)
            put("shuffle", player.shuffleModeEnabled)
            put("repeat", player.repeatMode)
            if (player.shuffleModeEnabled) {
                put("order", JSONArray(player.queueIndices().map { items[it].mediaId }))
            }
        }.toString()
        if (session == lastSaved) return
        lastSaved = session
        preferences.edit { putString("session", session) }
    }

    fun close() {
        player.removeListener(this)
        handler.removeCallbacks(checkpoint)
        save()
    }
}

private fun JSONObject.optionalString(key: String): String? =
    optString(key).takeIf(String::isNotBlank)
