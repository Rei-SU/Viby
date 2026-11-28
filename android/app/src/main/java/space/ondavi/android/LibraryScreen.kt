package space.ondavi.android

import android.text.format.DateUtils
import androidx.annotation.OptIn
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.BitmapLoader
import androidx.media3.common.util.UnstableApi

internal const val LIKED_SONGS = "liked"
internal const val LISTENING_HISTORY = "history"

internal class LibraryActions(
    val playable: (Song) -> Boolean,
    val toggleFavorite: (Song) -> Unit,
    val addToPlaylist: (Song) -> Unit,
    val enqueue: (Song, Boolean) -> Unit
)

private val heartPath =
    "M20.8 4.6a5.5 5.5 0 0 0 -7.8 0L12 5.7l-1 -1.1a5.5 5.5 0 0 0 -7.8 7.8L12 21.2l8.8 -8.8a5.5 5.5 0 0 0 0 -7.8z"
private val emptyHeart = playerIcon("Like", heartPath, filled = false)
private val filledHeart = playerIcon("Liked", heartPath)

@Composable
internal fun FavoriteButton(liked: Boolean, onClick: () -> Unit) {
    IconButton(onClick = onClick) {
        Icon(
            if (liked) filledHeart else emptyHeart,
            contentDescription = if (liked) "Unlike song" else "Like song",
            tint = if (liked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(23.dp)
        )
    }
}

@Composable
@OptIn(UnstableApi::class)
internal fun SongRow(
    song: Song,
    liked: Boolean,
    loader: BitmapLoader,
    actions: LibraryActions,
    onPlay: () -> Unit,
    subtitle: String = song.artist,
    onMoveUp: (() -> Unit)? = null,
    onMoveDown: (() -> Unit)? = null,
    onRemove: (() -> Unit)? = null
) {
    val playable = actions.playable(song)
    ListItem(
        modifier = Modifier.clickable(enabled = playable, onClickLabel = "Play ${song.title}", onClick = onPlay),
        leadingContent = { Artwork(song.artwork, loader, Modifier.size(46.dp)) },
        headlineContent = { Text(song.title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        supportingContent = subtitle.takeIf(String::isNotBlank)?.let { label ->
            { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        },
        trailingContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                FavoriteButton(liked) { actions.toggleFavorite(song) }
                TrackMenu { close ->
                    DropdownMenuItem(
                        text = { Text("Play next") }, enabled = playable, onClick = {
                            close()
                            actions.enqueue(song, true)
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Add to queue") }, enabled = playable, onClick = {
                            close()
                            actions.enqueue(song, false)
                        }
                    )
                    DropdownMenuItem(text = { Text("Add to playlist") }, onClick = {
                        close()
                        actions.addToPlaylist(song)
                    })
                    if (onMoveUp != null) DropdownMenuItem(text = { Text("Move up") }, onClick = {
                        close()
                        onMoveUp()
                    })
                    if (onMoveDown != null) DropdownMenuItem(text = { Text("Move down") }, onClick = {
                        close()
                        onMoveDown()
                    })
                    if (onRemove != null) DropdownMenuItem(text = { Text("Remove from playlist") }, onClick = {
                        close()
                        onRemove()
                    })
                }
            }
        }
    )
}

@Composable
@OptIn(UnstableApi::class)
internal fun HomeScreen(
    library: LibrarySnapshot,
    favorites: Set<String>,
    loader: BitmapLoader,
    actions: LibraryActions,
    onPlay: (Song) -> Unit,
    onOpenCollection: (String) -> Unit,
    onFindMusic: () -> Unit,
    canSearch: Boolean,
    modifier: Modifier = Modifier
) {
    val recent = library.history.distinctBy { it.song.id }.take(8)
    val sevenDays = System.currentTimeMillis() - 7 * 24 * 60 * 60 * 1_000L
    val weekly = library.history.filter { it.playedAt >= sevenDays }
    val tracks = weekly.map { it.song.id }.distinct().size
    val topArtist = weekly.map { it.song.artist }.filter(String::isNotBlank)
        .groupingBy { it }.eachCount().maxByOrNull { it.value }?.key
    LazyColumn(modifier, contentPadding = PaddingValues(bottom = 10.dp)) {
        item("week") {
            Text("Home", Modifier.padding(horizontal = 20.dp, vertical = 9.dp), style = MaterialTheme.typography.headlineMedium)
            Card(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Last 7 days", style = MaterialTheme.typography.titleLarge)
                    Text("${count(weekly.size, "play")} · ${count(tracks, "track")}")
                    if (topArtist != null) {
                        Text("Top artist · $topArtist", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        Text("Listening history starts after 30 seconds of playback.")
                    }
                }
            }
            CollectionLink("Liked Songs", count(library.favorites.size, "song")) { onOpenCollection(LIKED_SONGS) }
        }
        item("recent-header") {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Recently played", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                if (recent.isNotEmpty()) TextButton(onClick = { onOpenCollection(LISTENING_HISTORY) }) { Text("View all") }
            }
            if (recent.isEmpty()) {
                Text("Your recent plays will show up here.", Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                TextButton(onClick = onFindMusic, modifier = Modifier.padding(horizontal = 10.dp)) {
                    Text(if (canSearch) "Find music" else "Open audio")
                }
            }
        }
        items(recent, key = { it.id }) { entry ->
            SongRow(entry.song, entry.song.id in favorites, loader, actions, { onPlay(entry.song) })
        }
    }
}

@Composable
internal fun LibraryIndex(
    library: LibrarySnapshot,
    onOpenCollection: (String) -> Unit,
    onCreatePlaylist: () -> Unit,
    modifier: Modifier = Modifier
) {
    LazyColumn(modifier, contentPadding = PaddingValues(bottom = 10.dp)) {
        item("heading") {
            Text("Library", Modifier.padding(horizontal = 20.dp, vertical = 9.dp), style = MaterialTheme.typography.headlineMedium)
            CollectionLink("Liked Songs", count(library.favorites.size, "song")) { onOpenCollection(LIKED_SONGS) }
            CollectionLink("Listening History", count(library.history.size, "play")) { onOpenCollection(LISTENING_HISTORY) }
            Row(
                Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Playlists", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                TextButton(onClick = onCreatePlaylist) { Text("New playlist") }
            }
            if (library.playlists.isEmpty()) {
                Text("Create a playlist to collect songs.", Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
            }
        }
        items(library.playlists, key = LocalPlaylist::id) { playlist ->
            CollectionLink(playlist.name, count(playlist.songs.size, "song")) { onOpenCollection(playlist.id) }
        }
    }
}

@Composable
@OptIn(UnstableApi::class)
internal fun LibraryCollection(
    id: String,
    library: LibrarySnapshot,
    favorites: Set<String>,
    loader: BitmapLoader,
    actions: LibraryActions,
    onBack: () -> Unit,
    onPlay: (List<Song>, Int, Boolean) -> Unit,
    onRename: (LocalPlaylist) -> Unit,
    onDelete: (LocalPlaylist) -> Unit,
    onMove: (String, Int) -> Unit,
    onRemove: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val playlist = library.playlists.firstOrNull { it.id == id }
    val isHistory = id == LISTENING_HISTORY
    val title = when (id) {
        LIKED_SONGS -> "Liked Songs"
        LISTENING_HISTORY -> "Listening History"
        else -> playlist?.name ?: "Playlist"
    }
    val songs = when (id) {
        LIKED_SONGS -> library.favorites
        LISTENING_HISTORY -> library.history.map(ListeningEntry::song)
        else -> playlist?.songs.orEmpty()
    }
    Column(modifier) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("Back") }
            Text(title, Modifier.weight(1f).padding(start = 6.dp), style = MaterialTheme.typography.headlineSmall)
            if (playlist != null) TrackMenu { close ->
                DropdownMenuItem(text = { Text("Rename playlist") }, onClick = {
                    close()
                    onRename(playlist)
                })
                DropdownMenuItem(text = { Text("Delete playlist") }, onClick = {
                    close()
                    onDelete(playlist)
                })
            }
        }
        if (songs.isEmpty()) {
            val message = when (id) {
                LIKED_SONGS -> "Like a song from Search or Now Playing to keep it here."
                LISTENING_HISTORY -> "Your plays will appear here."
                else -> "Use a song’s menu to add it to this playlist."
            }
            Text(message, Modifier.padding(horizontal = 20.dp, vertical = 12.dp))
        } else {
            if (!isHistory) Row(
                Modifier.padding(horizontal = 20.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                val playable = songs.any(actions.playable)
                Button(enabled = playable, onClick = { onPlay(songs, 0, false) }) { Text("Play all") }
                OutlinedButton(enabled = playable, onClick = { onPlay(songs, 0, true) }) { Text("Shuffle") }
            }
            LazyColumn(contentPadding = PaddingValues(bottom = 10.dp)) {
                items(songs.size, key = { if (isHistory) library.history[it].id else songs[it].id }) { index ->
                    val song = songs[index]
                    val subtitle = if (isHistory) {
                        val relative = DateUtils.getRelativeTimeSpanString(
                            library.history[index].playedAt, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS
                        ).toString()
                        listOf(song.artist, relative).filter(String::isNotBlank).joinToString(" · ")
                    } else song.artist
                    SongRow(
                        song, song.id in favorites, loader, actions,
                        onPlay = { if (isHistory) onPlay(listOf(song), 0, false) else onPlay(songs, index, false) },
                        subtitle = subtitle,
                        onMoveUp = if (playlist != null && index > 0) ({ onMove(song.id, -1) }) else null,
                        onMoveDown = if (playlist != null && index < songs.lastIndex) ({ onMove(song.id, 1) }) else null,
                        onRemove = if (playlist == null) null else ({ onRemove(song.id) })
                    )
                }
            }
        }
    }
}

@Composable
private fun CollectionLink(title: String, subtitle: String, onClick: () -> Unit) {
    ListItem(
        modifier = Modifier.clickable(onClick = onClick),
        headlineContent = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = { Text(subtitle) },
        trailingContent = { Text("›", style = MaterialTheme.typography.titleLarge) }
    )
}

internal fun count(number: Int, singular: String): String = "$number $singular${if (number == 1) "" else "s"}"
