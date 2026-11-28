package space.ondavi.android

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.annotation.OptIn
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.BitmapLoader
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.session.MediaController
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private val ondaviColors = darkColorScheme(
    primary = Color(0xffa8d9af),
    onPrimary = Color(0xff132918),
    background = Color(0xff111211),
    surface = Color(0xff111211),
    surfaceContainer = Color(0xff1d201d),
    onSurface = Color(0xffeceeeb)
)

private enum class Tab { Home, Search, Library }
private val tabIcons = mapOf(
    Tab.Home to playerIcon("Home", "M3 10.5L12 3l9 7.5V21H3zM9 21v-7h6v7", filled = false),
    Tab.Search to playerIcon("Search", "M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0 -14zM16.5 16.5L21 21", filled = false),
    Tab.Library to playerIcon("Library", "M4 6h16M4 12h16M4 18h16", filled = false)
)
private data class PlaylistEdit(val playlist: LocalPlaylist? = null, val song: Song? = null)

@Composable
@OptIn(UnstableApi::class)
internal fun OndaviScreen(
    controller: MediaController?,
    canSearch: Boolean,
    results: List<Song>,
    searching: Boolean,
    searchStatus: String?,
    playbackStatus: String?,
    library: LocalLibrary,
    onSearch: (String) -> Unit,
    onPlay: (Song, AudioQuality) -> Unit,
    onPlayCollection: (List<Song>, Int, Boolean, AudioQuality) -> Unit,
    onEnqueue: (Song, AudioQuality, Boolean) -> Unit,
    onOpenFile: () -> Unit
) {
    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    var collection by rememberSaveable { mutableStateOf<String?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var quality by rememberSaveable { mutableStateOf(AudioQuality.Best) }
    var showPlayer by rememberSaveable { mutableStateOf(false) }
    var loadFailed by remember { mutableStateOf(false) }
    var picker by remember { mutableStateOf<Song?>(null) }
    var editor by remember { mutableStateOf<PlaylistEdit?>(null) }
    var deleting by remember { mutableStateOf<LocalPlaylist?>(null) }

    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val application = context.applicationContext
    val loader = remember(application) {
        CacheBitmapLoader(DataSourceBitmapLoader.Builder(application).setMaximumOutputDimension(512).build())
    }
    val playback = rememberPlayback(controller)
    val local by library.state.collectAsStateWithLifecycle()
    val liked = remember(local?.favorites) { local?.favorites.orEmpty().map(Song::id).toSet() }
    val searchScroll = rememberLazyListState()

    suspend fun load() {
        loadFailed = false
        try {
            library.load()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            loadFailed = true
        }
    }
    LaunchedEffect(library) { load() }
    fun write(action: suspend () -> Unit) {
        scope.launch {
            try {
                action()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                Toast.makeText(context, "Couldn’t save your library. Try again.", Toast.LENGTH_SHORT).show()
            }
        }
    }
    val actions = LibraryActions(
        playable = { controller != null && (canSearch || it.isLocal) },
        toggleFavorite = { song -> write { library.toggleFavorite(song) } },
        addToPlaylist = { song -> picker = song },
        enqueue = { song, next -> onEnqueue(song, quality, next) }
    )

    MaterialTheme(colorScheme = ondaviColors) {
        if (showPlayer && controller != null) {
            BackHandler { showPlayer = false }
            NowPlayingScreen(controller, playback, loader, liked, if (local != null) actions else null) {
                showPlayer = false
            }
        } else {
            BackHandler(enabled = collection != null) { collection = null }
            Scaffold(
                bottomBar = {
                    Column {
                        if (controller != null && playback.current != null) {
                            MiniPlayer(controller, playback, loader) { showPlayer = true }
                        }
                        NavigationBar {
                            Tab.entries.filter { it != Tab.Search || canSearch }.forEach { destination ->
                                NavigationBarItem(
                                    selected = tab == destination,
                                    onClick = {
                                        tab = destination
                                        collection = null
                                    },
                                    icon = { Icon(tabIcons.getValue(destination), contentDescription = null) },
                                    label = { Text(destination.name) }
                                )
                            }
                        }
                    }
                }
            ) { padding ->
                Column(Modifier.fillMaxSize().padding(padding)) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Image(painterResource(R.drawable.ondavi_icon), null, Modifier.size(32.dp))
                        Text("Ondavi", style = MaterialTheme.typography.headlineSmall)
                        Spacer(Modifier.weight(1f))
                        TextButton(onClick = onOpenFile, enabled = controller != null) { Text("Open audio") }
                    }
                    val snapshot = local
                    val opened = collection
                    when {
                        opened != null && snapshot != null -> LibraryCollection(
                            opened, snapshot, liked, loader, actions,
                            onBack = { collection = null },
                            onPlay = { songs, index, shuffle -> onPlayCollection(songs, index, shuffle, quality) },
                            onRename = { editor = PlaylistEdit(playlist = it) },
                            onDelete = { deleting = it },
                            onMove = { song, offset -> write { library.moveInPlaylist(opened, song, offset) } },
                            onRemove = { song -> write { library.removeFromPlaylist(opened, song) } },
                            modifier = Modifier.weight(1f)
                        )
                        tab == Tab.Search && canSearch -> SearchContent(
                            query, { query = it }, quality, { quality = it }, results, searching,
                            searchStatus, searchScroll, liked, loader, actions,
                            onSearch = onSearch, onPlay = { onPlay(it, quality) },
                            modifier = Modifier.weight(1f)
                        )
                        snapshot == null -> Column(Modifier.weight(1f).padding(20.dp)) {
                            if (loadFailed) {
                                Text("Couldn’t open your library.")
                                TextButton(onClick = { scope.launch { load() } }) { Text("Retry") }
                            } else {
                                Text("Loading library…")
                            }
                        }
                        tab == Tab.Library -> LibraryIndex(
                            snapshot, { collection = it }, { editor = PlaylistEdit() }, Modifier.weight(1f)
                        )
                        else -> HomeScreen(
                            snapshot, liked, loader, actions, { onPlay(it, quality) }, { collection = it },
                            {
                                if (canSearch) tab = Tab.Search else if (controller != null) onOpenFile()
                            },
                            canSearch, Modifier.weight(1f)
                        )
                    }
                    if (playbackStatus != null) {
                        Text(
                            playbackStatus, Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
            }
        }

        picker?.let { song ->
            PlaylistPicker(
                local?.playlists.orEmpty(),
                onClose = { picker = null },
                onNew = {
                    picker = null
                    editor = PlaylistEdit(song = song)
                },
                onChoose = { playlist ->
                    picker = null
                    write {
                        library.addToPlaylist(playlist.id, song)
                        Toast.makeText(context, "In ${playlist.name}", Toast.LENGTH_SHORT).show()
                    }
                }
            )
        }
        editor?.let { edit ->
            PlaylistEditor(edit.playlist, onClose = { editor = null }) { name ->
                editor = null
                write {
                    if (edit.playlist != null) {
                        library.renamePlaylist(edit.playlist.id, name)
                    } else {
                        val id = library.createPlaylist(name, edit.song)
                        showPlayer = false
                        tab = Tab.Library
                        collection = id
                    }
                }
            }
        }
        deleting?.let { playlist ->
            AlertDialog(
                onDismissRequest = { deleting = null },
                title = { Text("Delete playlist?") },
                text = { Text(playlist.name) },
                confirmButton = {
                    TextButton(onClick = {
                        deleting = null
                        write {
                            library.deletePlaylist(playlist.id)
                            if (collection == playlist.id) collection = null
                        }
                    }) { Text("Delete") }
                },
                dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } }
            )
        }
    }
}

@Composable
@OptIn(UnstableApi::class)
private fun SearchContent(
    query: String,
    onQuery: (String) -> Unit,
    quality: AudioQuality,
    onQuality: (AudioQuality) -> Unit,
    results: List<Song>,
    searching: Boolean,
    searchStatus: String?,
    scroll: androidx.compose.foundation.lazy.LazyListState,
    liked: Set<String>,
    loader: BitmapLoader,
    actions: LibraryActions,
    onSearch: (String) -> Unit,
    onPlay: (Song) -> Unit,
    modifier: Modifier
) {
    val focus = LocalFocusManager.current
    val submit = {
        if (query.isNotBlank() && !searching) {
            focus.clearFocus()
            onSearch(query.trim())
        }
    }
    Column(modifier) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = onQuery,
                label = { Text("Search songs") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { submit() }),
                modifier = Modifier.weight(1f)
            )
            Button(onClick = submit, enabled = query.isNotBlank() && !searching) { Text("Search") }
        }
        TextButton(
            onClick = {
                onQuality(if (quality == AudioQuality.Best) AudioQuality.DataSaver else AudioQuality.Best)
            },
            modifier = Modifier.padding(horizontal = 12.dp)
        ) { Text(if (quality == AudioQuality.Best) "Quality · Best" else "Quality · Data Saver") }
        if (searching) LinearProgressIndicator(Modifier.fillMaxWidth())
        LazyColumn(state = scroll, contentPadding = PaddingValues(bottom = 10.dp)) {
            if (searchStatus != null) item {
                Text(searchStatus, Modifier.padding(horizontal = 20.dp, vertical = 12.dp))
            }
            items(results, key = Song::id) { song ->
                SongRow(song, song.id in liked, loader, actions, { onPlay(song) })
            }
        }
    }
}

@Composable
private fun PlaylistPicker(
    playlists: List<LocalPlaylist>,
    onClose: () -> Unit,
    onNew: () -> Unit,
    onChoose: (LocalPlaylist) -> Unit
) {
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Add to playlist") },
        text = {
            if (playlists.isEmpty()) Text("You haven’t created a playlist yet.")
            else LazyColumn(Modifier.heightIn(max = 320.dp)) {
                items(playlists, key = LocalPlaylist::id) { playlist ->
                    ListItem(
                        modifier = Modifier.clickable { onChoose(playlist) },
                        headlineContent = { Text(playlist.name) },
                        supportingContent = { Text(count(playlist.songs.size, "song")) }
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onNew) { Text("New playlist") } },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } }
    )
}

@Composable
private fun PlaylistEditor(playlist: LocalPlaylist?, onClose: () -> Unit, onSave: (String) -> Unit) {
    var name by rememberSaveable(playlist?.id) { mutableStateOf(playlist?.name.orEmpty()) }
    val submit = { if (name.isNotBlank()) onSave(name.trim()) }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(if (playlist == null) "New playlist" else "Rename playlist") },
        text = {
            OutlinedTextField(
                value = name, onValueChange = { name = it.take(80) },
                label = { Text("Playlist name") }, singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submit() })
            )
        },
        confirmButton = {
            TextButton(onClick = submit, enabled = name.isNotBlank()) {
                Text(if (playlist == null) "Create" else "Save")
            }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } }
    )
}
