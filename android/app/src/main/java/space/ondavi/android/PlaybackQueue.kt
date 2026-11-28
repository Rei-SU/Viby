package space.ondavi.android

import android.net.Uri
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ShuffleOrder
import androidx.media3.session.SessionCommand
import java.util.UUID
import kotlin.random.Random

internal val ENQUEUE = SessionCommand("space.ondavi.android.enqueue", Bundle.EMPTY)
internal const val ITEM_KEY = "item"
internal const val PLAY_NEXT_KEY = "playNext"
private const val LIBRARY_ID_KEY = "ondavi.libraryId"
private const val LIBRARY_MIME_KEY = "ondavi.libraryMime"

internal fun queueItem(
    uri: Uri,
    title: String,
    artist: String? = null,
    artwork: Uri? = null,
    mimeType: String? = null,
    id: String = UUID.randomUUID().toString()
): MediaItem = MediaItem.Builder()
    .setMediaId(id)
    .setUri(uri)
    .setMimeType(mimeType)
    .setMediaMetadata(MediaMetadata.Builder().setTitle(title).setArtist(artist).setArtworkUri(artwork)
        .setExtras(Bundle().apply {
            val libraryId = if (isSongUri(uri)) uri.lastPathSegment else uri.toString()
            putString(LIBRARY_ID_KEY, libraryId)
            putString(LIBRARY_MIME_KEY, mimeType)
        }).build())
    .build()

internal fun Song.queueItem(quality: AudioQuality): MediaItem =
    queueItem(if (isLocal) Uri.parse(id) else songUri(this, quality), title, artist, artwork, mimeType)

internal fun MediaItem.librarySong(): Song? {
    val metadata = mediaMetadata
    val id = metadata.extras?.getString(LIBRARY_ID_KEY) ?: return null
    return Song(
        id = id,
        title = metadata.title?.toString().orEmpty().ifBlank { "Audio" },
        artist = metadata.artist?.toString().orEmpty(),
        artwork = metadata.artworkUri,
        mimeType = metadata.extras?.getString(LIBRARY_MIME_KEY)
    )
}

@OptIn(UnstableApi::class)
internal fun Player.queueIndices(): List<Int> {
    if (!shuffleModeEnabled) return (0 until mediaItemCount).toList()
    val timeline = currentTimeline
    val indices = buildList {
        var index = timeline.getFirstWindowIndex(true)
        while (index != C.INDEX_UNSET && size < timeline.windowCount) {
            add(index)
            index = timeline.getNextWindowIndex(index, Player.REPEAT_MODE_OFF, true)
        }
    }
    return indices.takeIf { it.size == mediaItemCount } ?: (0 until mediaItemCount).toList()
}

@OptIn(UnstableApi::class)
internal fun ExoPlayer.insertIntoQueue(item: MediaItem, playNext: Boolean) {
    val count = mediaItemCount
    val current = currentMediaItemIndex.coerceAtMost(count - 1)
    val index = if (playNext) current + 1 else count
    val order = if (shuffleModeEnabled) queueIndices() else null
    addMediaItem(index, item)
    if (order != null) {
        val shuffledInsertion = if (playNext) order.indexOf(current) + 1 else order.size
        val updated = order.map { if (it >= index) it + 1 else it }.toMutableList()
        updated.add(shuffledInsertion, index)
        setQueueOrder(updated)
    }
}

@OptIn(UnstableApi::class)
internal fun ExoPlayer.setQueueOrder(order: List<Int>) {
    setShuffleOrder(ShuffleOrder.DefaultShuffleOrder(order.toIntArray(), Random.nextLong()))
}
