package space.ondavi.android

import android.content.Context
import android.util.AtomicFile
import androidx.core.net.toUri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.util.UUID

internal data class LocalPlaylist(val id: String, val name: String, val songs: List<Song> = emptyList())
internal data class ListeningEntry(val id: String, val song: Song, val playedAt: Long)

internal data class LibrarySnapshot(
    val favorites: List<Song> = emptyList(),
    val playlists: List<LocalPlaylist> = emptyList(),
    val history: List<ListeningEntry> = emptyList()
)

internal class LocalLibrary private constructor(context: Context) {
    private val file = AtomicFile(File(context.filesDir, "library.json"))
    private val lock = Mutex()
    private val snapshot = MutableStateFlow<LibrarySnapshot?>(null)
    val state = snapshot.asStateFlow()

    suspend fun load() = withContext(Dispatchers.IO) {
        lock.withLock { readIfNeeded() }
    }

    suspend fun toggleFavorite(song: Song) = change { current ->
        val songs = current.favorites.filterNot { it.id == song.id }
        current.copy(favorites = if (songs.size == current.favorites.size) listOf(song) + songs else songs)
    }

    suspend fun createPlaylist(name: String, song: Song? = null): String {
        val playlist = LocalPlaylist(UUID.randomUUID().toString(), cleanName(name), listOfNotNull(song))
        change { it.copy(playlists = listOf(playlist) + it.playlists) }
        return playlist.id
    }

    suspend fun renamePlaylist(id: String, name: String) = editPlaylist(id) { it.copy(name = cleanName(name)) }

    suspend fun deletePlaylist(id: String) = change { current ->
        current.copy(playlists = current.playlists.filterNot { it.id == id })
    }

    suspend fun addToPlaylist(id: String, song: Song) = editPlaylist(id) {
        if (it.songs.any { item -> item.id == song.id }) it else it.copy(songs = it.songs + song)
    }

    suspend fun removeFromPlaylist(id: String, songId: String) = editPlaylist(id) {
        it.copy(songs = it.songs.filterNot { song -> song.id == songId })
    }

    suspend fun moveInPlaylist(id: String, songId: String, offset: Int) = editPlaylist(id) {
        val from = it.songs.indexOfFirst { song -> song.id == songId }
        val to = from + offset
        if (from < 0 || to !in it.songs.indices) return@editPlaylist it
        val songs = it.songs.toMutableList()
        songs.add(to, songs.removeAt(from))
        it.copy(songs = songs)
    }

    suspend fun recordPlay(song: Song, playedAt: Long) = change { current ->
        val entry = ListeningEntry(UUID.randomUUID().toString(), song, playedAt)
        current.copy(history = (listOf(entry) + current.history).take(5_000))
    }

    private suspend fun editPlaylist(id: String, update: (LocalPlaylist) -> LocalPlaylist) = change { current ->
        current.copy(playlists = current.playlists.map { if (it.id == id) update(it) else it })
    }

    private suspend fun change(update: (LibrarySnapshot) -> LibrarySnapshot) = withContext(Dispatchers.IO) {
        lock.withLock {
            val current = readIfNeeded()
            val next = update(current)
            if (next != current) {
                val stream = file.startWrite()
                try {
                    stream.write(encode(next).toString().encodeToByteArray())
                    file.finishWrite(stream)
                } catch (error: Exception) {
                    file.failWrite(stream)
                    throw error
                }
                snapshot.value = next
            }
        }
    }

    private fun readIfNeeded(): LibrarySnapshot {
        snapshot.value?.let { return it }
        val current = try {
            decode(JSONObject(file.readFully().decodeToString()))
        } catch (error: FileNotFoundException) {
            if (file.baseFile.exists()) throw error
            LibrarySnapshot()
        }
        snapshot.value = current
        return current
    }

    companion object {
        @Volatile private var instance: LocalLibrary? = null

        fun get(context: Context): LocalLibrary = instance ?: synchronized(this) {
            instance ?: LocalLibrary(context.applicationContext).also { instance = it }
        }
    }
}

private fun cleanName(name: String): String = name.trim().take(80).also { require(it.isNotEmpty()) }

private fun encode(snapshot: LibrarySnapshot): JSONObject = JSONObject().apply {
    put("favorites", JSONArray(snapshot.favorites.map(Song::json)))
    put("playlists", JSONArray(snapshot.playlists.map { playlist ->
        JSONObject().put("id", playlist.id).put("name", playlist.name)
            .put("songs", JSONArray(playlist.songs.map(Song::json)))
    }))
    put("history", JSONArray(snapshot.history.map { entry ->
        JSONObject().put("id", entry.id).put("playedAt", entry.playedAt).put("song", entry.song.json())
    }))
}

private fun decode(json: JSONObject): LibrarySnapshot = LibrarySnapshot(
    favorites = json.objects("favorites").mapNotNull(JSONObject::song).distinctBy(Song::id),
    playlists = json.objects("playlists").mapNotNull {
        val id = it.optString("id")
        val name = it.optString("name")
        if (id.isBlank() || name.isBlank()) null else LocalPlaylist(
            id, name, it.objects("songs").mapNotNull(JSONObject::song).distinctBy(Song::id)
        )
    }.distinctBy(LocalPlaylist::id),
    history = json.objects("history").mapNotNull {
        val song = it.optJSONObject("song")?.song() ?: return@mapNotNull null
        val id = it.optString("id")
        val playedAt = it.optLong("playedAt")
        if (id.isBlank() || playedAt <= 0) null else ListeningEntry(id, song, playedAt)
    }.take(5_000)
)

private fun JSONObject.objects(key: String): List<JSONObject> {
    val values = optJSONArray(key) ?: return emptyList()
    return (0 until values.length()).mapNotNull(values::optJSONObject)
}

private fun Song.json(): JSONObject = JSONObject()
    .put("id", id).put("title", title).put("artist", artist)
    .put("artwork", artwork?.toString()).put("mimeType", mimeType)

private val catalogId = Regex("[A-Za-z0-9_-]{11}")

private fun JSONObject.song(): Song? {
    val id = optString("id")
    if (!catalogId.matches(id) && id.toUri().scheme != "content") return null
    return Song(
        id, optString("title").ifBlank { "Audio" }, optString("artist"),
        optString("artwork").toUri().takeIf { it.scheme == "https" },
        optString("mimeType").takeIf(String::isNotBlank)
    )
}
