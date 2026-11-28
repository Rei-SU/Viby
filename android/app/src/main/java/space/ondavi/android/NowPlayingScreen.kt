package space.ondavi.android

import android.graphics.Bitmap
import android.net.Uri
import androidx.annotation.OptIn
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.BitmapLoader
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import kotlinx.coroutines.delay
import java.util.Locale

internal data class QueueRow(val index: Int, val item: MediaItem)

internal data class PlaybackView(
    val current: MediaItem? = null,
    val queue: List<QueueRow> = emptyList(),
    val duration: Long = 0,
    val playing: Boolean = false,
    val playRequested: Boolean = false,
    val canSeek: Boolean = false,
    val canSkip: Boolean = false,
    val state: Int = Player.STATE_IDLE,
    val shuffle: Boolean = false,
    val repeat: Int = Player.REPEAT_MODE_OFF,
    val error: String? = null
) {
    val showPause: Boolean get() = playRequested && state != Player.STATE_ENDED && error == null
}

@Composable
internal fun rememberPlayback(player: MediaController?): PlaybackView {
    fun view(): PlaybackView {
        if (player == null) return PlaybackView()
        val failure = player.playerError
        return PlaybackView(
            current = player.currentMediaItem,
            queue = player.queueIndices().map { QueueRow(it, player.getMediaItemAt(it)) },
            duration = player.duration.coerceAtLeast(0L),
            playing = player.isPlaying,
            playRequested = player.playWhenReady,
            canSeek = player.isCurrentMediaItemSeekable,
            canSkip = player.hasNextMediaItem(),
            state = player.playbackState,
            shuffle = player.shuffleModeEnabled,
            repeat = player.repeatMode,
            error = failure?.let {
                generateSequence(it.cause) { cause -> cause.cause }
                    .filterIsInstance<MusicSourceException>().firstOrNull()?.message
                    ?: "Playback failed. Play to retry, or skip to the next song."
            }
        )
    }
    var playback by remember(player) { mutableStateOf(view()) }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onEvents(player: Player, events: Player.Events) {
                playback = view()
            }
        }
        player?.addListener(listener)
        playback = view()
        onDispose { player?.removeListener(listener) }
    }
    return playback
}

@Composable
@OptIn(UnstableApi::class)
internal fun MiniPlayer(
    player: MediaController,
    playback: PlaybackView,
    artworkLoader: BitmapLoader,
    onOpen: () -> Unit
) {
    val current = playback.current ?: return
    HorizontalDivider()
    Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                modifier = Modifier.weight(1f).clickable(onClickLabel = "Open Now Playing", onClick = onOpen)
                    .padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Artwork(current.mediaMetadata.artworkUri, artworkLoader, Modifier.size(44.dp))
                Column(Modifier.weight(1f)) {
                    Text(current.title(), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val detail = when {
                        playback.error != null -> "Playback failed"
                        playback.state == Player.STATE_BUFFERING -> "Buffering…"
                        else -> current.mediaMetadata.artist?.toString().orEmpty()
                    }
                    if (detail.isNotBlank()) {
                        Text(detail, style = MaterialTheme.typography.bodySmall, maxLines = 1)
                    }
                }
                Icon(
                    ExpandIcon,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp)
                )
            }
            PlayPause(player, playback)
            MediaButton(NextIcon, "Next", playback.canSkip) { player.skipNext() }
        }
    }
}

@Composable
@OptIn(UnstableApi::class)
internal fun NowPlayingScreen(
    player: MediaController,
    playback: PlaybackView,
    artworkLoader: BitmapLoader,
    favorites: Set<String>,
    libraryActions: LibraryActions?,
    onClose: () -> Unit
) {
    Scaffold(topBar = {
        Row(
            modifier = Modifier.fillMaxWidth()
                .padding(WindowInsets.statusBars.asPaddingValues())
                .padding(horizontal = 12.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextButton(onClick = onClose) { Text("Back") }
            Text("Now Playing", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 8.dp))
        }
    }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(bottom = 16.dp)) {
            val current = playback.current
            if (current != null) {
                item("playing") { PlayerDetails(player, playback, current, artworkLoader, favorites, libraryActions) }
            }
            item("queue-title") {
                HorizontalDivider()
                Text("Queue", Modifier.padding(horizontal = 20.dp, vertical = 14.dp), style = MaterialTheme.typography.titleLarge)
                if (playback.queue.isEmpty()) Text("Queue is empty.", Modifier.padding(horizontal = 20.dp))
            }
            itemsIndexed(playback.queue, key = { _, row -> row.item.mediaId }) { position, row ->
                QueueItem(player, playback, position, row)
            }
        }
    }
}

@Composable
@OptIn(UnstableApi::class)
private fun PlayerDetails(
    player: MediaController,
    playback: PlaybackView,
    current: MediaItem,
    artworkLoader: BitmapLoader,
    favorites: Set<String>,
    libraryActions: LibraryActions?
) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Artwork(
            current.mediaMetadata.artworkUri, artworkLoader,
            Modifier.widthIn(max = 320.dp).fillMaxWidth().aspectRatio(1f)
        )
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(current.title(), style = MaterialTheme.typography.headlineSmall)
                current.mediaMetadata.artist?.takeIf { it.isNotBlank() }?.let {
                    Text(it.toString(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            val song = current.librarySong()
            if (song != null && libraryActions != null) {
                FavoriteButton(song.id in favorites) { libraryActions.toggleFavorite(song) }
                TrackMenu { close ->
                    DropdownMenuItem(text = { Text("Add to playlist") }, onClick = {
                        close()
                        libraryActions.addToPlaylist(song)
                    })
                }
            }
        }
        PlayerProgress(player, playback, current.mediaId)
        Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            MediaButton(PreviousIcon, "Previous", true) {
                player.seekToPrevious()
                if (player.playWhenReady && player.playbackState == Player.STATE_IDLE) player.prepare()
            }
            PlayPause(player, playback)
            MediaButton(NextIcon, "Next", playback.canSkip) { player.skipNext() }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { player.shuffleModeEnabled = !playback.shuffle }) {
                Text(if (playback.shuffle) "Shuffle · On" else "Shuffle · Off")
            }
            TextButton(onClick = {
                player.repeatMode = when (playback.repeat) {
                    Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
                    Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
                    else -> Player.REPEAT_MODE_OFF
                }
            }) {
                Text(when (playback.repeat) {
                    Player.REPEAT_MODE_ALL -> "Repeat · All"
                    Player.REPEAT_MODE_ONE -> "Repeat · One"
                    else -> "Repeat · Off"
                })
            }
        }
        if (playback.error != null) {
            Text(playback.error, color = MaterialTheme.colorScheme.error)
        } else if (playback.state == Player.STATE_BUFFERING) {
            Text("Buffering…", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun PlayerProgress(player: MediaController, playback: PlaybackView, id: String) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var position by remember(player, id) { mutableLongStateOf(player.currentPosition) }
    var drag by remember(id) { mutableStateOf<Float?>(null) }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onEvents(player: Player, events: Player.Events) {
                position = player.currentPosition
            }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }
    LaunchedEffect(player, lifecycle, playback.playing, id) {
        if (playback.playing) lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                position = player.currentPosition
                delay(500)
            }
        }
    }
    if (playback.duration > 0) {
        Slider(
            value = (drag ?: position.toFloat()).coerceIn(0f, playback.duration.toFloat()),
            valueRange = 0f..playback.duration.toFloat(),
            enabled = playback.canSeek,
            onValueChange = { drag = it },
            onValueChangeFinished = {
                drag?.toLong()?.let(player::seekTo)
                drag = null
            },
            modifier = Modifier.semantics { contentDescription = "Playback position" }
        )
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(elapsed(drag?.toLong() ?: position), style = MaterialTheme.typography.labelMedium)
        if (playback.duration > 0) Text(elapsed(playback.duration), style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun QueueItem(player: MediaController, playback: PlaybackView, position: Int, row: QueueRow) {
    val current = row.item.mediaId == playback.current?.mediaId
    fun playHere() {
        player.seekToDefaultPosition(row.index)
        if (player.playbackState == Player.STATE_IDLE) player.prepare()
        player.play()
    }
    ListItem(
        headlineContent = { Text(row.item.title(), maxLines = 2, overflow = TextOverflow.Ellipsis) },
        supportingContent = {
            val artist = row.item.mediaMetadata.artist?.toString().orEmpty()
            Text(if (current) listOf("Current track", artist).filter(String::isNotBlank).joinToString(" · ") else artist)
        },
        leadingContent = { Text((position + 1).toString()) },
        modifier = Modifier.clickable(onClickLabel = "Play this song", onClick = ::playHere),
        trailingContent = {
            TrackMenu { close ->
                if (!playback.shuffle && position > 0) {
                    DropdownMenuItem(text = { Text("Move up") }, onClick = {
                        close()
                        player.moveMediaItem(row.index, row.index - 1)
                    })
                }
                if (!playback.shuffle && position < playback.queue.lastIndex) {
                    DropdownMenuItem(text = { Text("Move down") }, onClick = {
                        close()
                        player.moveMediaItem(row.index, row.index + 1)
                    })
                }
                DropdownMenuItem(text = { Text("Remove from queue") }, onClick = {
                    close()
                    player.removeMediaItem(row.index)
                })
            }
        }
    )
}

@Composable
internal fun TrackMenu(enabled: Boolean = true, content: @Composable (() -> Unit) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }, enabled = enabled) {
            Text("⋮", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics {
                contentDescription = "More track actions"
            })
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            content { expanded = false }
        }
    }
}

@Composable
private fun PlayPause(player: MediaController, playback: PlaybackView) {
    val icon = if (playback.showPause) PauseIcon else PlayIcon
    MediaButton(icon, if (playback.showPause) "Pause" else "Play", true) {
        if (playback.showPause) {
            player.pause()
        } else {
            if (playback.state == Player.STATE_ENDED) player.seekToDefaultPosition()
            if (playback.state == Player.STATE_IDLE) player.prepare()
            player.play()
        }
    }
}

@Composable
private fun MediaButton(icon: ImageVector, label: String, enabled: Boolean, action: () -> Unit) {
    IconButton(onClick = action, enabled = enabled) {
        Icon(icon, contentDescription = label, modifier = Modifier.size(28.dp))
    }
}

private fun Player.skipNext() {
    seekToNextMediaItem()
    if (playWhenReady && playbackState == Player.STATE_IDLE) prepare()
}

@Composable
@OptIn(UnstableApi::class)
internal fun Artwork(uri: Uri?, loader: BitmapLoader, modifier: Modifier) {
    val bitmap by rememberArtwork(uri, loader)
    Surface(modifier.clip(RoundedCornerShape(10.dp)), color = MaterialTheme.colorScheme.surfaceContainer) {
        val image = bitmap
        if (image != null) {
            Image(image.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        } else {
            Image(painterResource(R.drawable.ondavi_icon), null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
        }
    }
}

@Composable
@OptIn(UnstableApi::class)
private fun rememberArtwork(uri: Uri?, loader: BitmapLoader): State<Bitmap?> {
    val result = remember(uri, loader) { mutableStateOf<Bitmap?>(null) }
    val context = LocalContext.current
    DisposableEffect(uri, loader) {
        var active = true
        if (uri?.scheme == "https") {
            val future = loader.loadBitmap(uri)
            future.addListener({
                if (active) result.value = runCatching { future.get() }.getOrNull()
            }, ContextCompat.getMainExecutor(context))
        }
        onDispose { active = false }
    }
    return result
}

private fun MediaItem.title(): String = mediaMetadata.title?.toString().orEmpty().ifBlank { "Audio" }

private fun elapsed(milliseconds: Long): String {
    val seconds = milliseconds.coerceAtLeast(0) / 1_000
    return if (seconds >= 3_600) {
        String.format(Locale.ROOT, "%d:%02d:%02d", seconds / 3_600, seconds / 60 % 60, seconds % 60)
    } else {
        String.format(Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60)
    }
}

// Transport paths match the desktop player’s icons.
private val PlayIcon = playerIcon("Play", "M7 4.5l12 7.5-12 7.5v-15z")
private val PauseIcon = playerIcon("Pause", "M7 4h3.6v16H7zM13.4 4H17v16h-3.6z")
private val PreviousIcon = playerIcon("Previous", "M6 5v14M18 5l-9 7 9 7V5z")
private val NextIcon = playerIcon("Next", "M18 5v14M6 5l9 7-9 7V5z")
private val ExpandIcon = playerIcon("Expand", "M6 15l6-6 6 6", filled = false)

internal fun playerIcon(name: String, path: String, filled: Boolean = true): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)
        .addPath(
            pathData = PathParser().parsePathString(path).toNodes(),
            fill = if (filled) SolidColor(Color.Black) else null,
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 1.8f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round
        )
        .build()
