package space.ondavi.android

import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionToken
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.concurrent.Executor

class MainActivity : ComponentActivity() {
    private val source by lazy { createMusicSource() }
    private val controllerFuture by lazy {
        val token = SessionToken(this, ComponentName(this, PlaybackService::class.java))
        MediaController.Builder(this, token).buildAsync()
    }
    private var controller by mutableStateOf<MediaController?>(null)
    private var searchJob: Job? = null
    private var fileJob: Job? = null
    private var results by mutableStateOf(emptyList<Song>())
    private var searching by mutableStateOf(false)
    private var searchStatus by mutableStateOf<String?>(null)
    private var playbackStatus by mutableStateOf<String?>(null)

    private val chooseAudio = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) openAudio(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT)
        )
        controllerFuture.addListener({
            if (!isDestroyed) {
                controller = runCatching { controllerFuture.get() }.getOrNull()
                if (controller == null) playbackStatus = "The player couldn’t start."
            }
        }, Executor { runOnUiThread(it) })
        setContent {
            OndaviScreen(
                controller = controller,
                canSearch = source != null,
                results = results,
                searching = searching,
                searchStatus = searchStatus,
                playbackStatus = playbackStatus,
                library = LocalLibrary.get(this),
                onSearch = ::search,
                onPlay = ::play,
                onPlayCollection = ::playCollection,
                onEnqueue = ::enqueue,
                onOpenFile = { chooseAudio.launch(arrayOf("audio/*")) }
            )
        }
    }

    private fun search(query: String) {
        val music = source ?: return
        searchJob?.cancel()
        searchJob = lifecycleScope.launch {
            searching = true
            searchStatus = null
            results = emptyList()
            try {
                results = music.search(query)
                if (results.isEmpty()) searchStatus = "No songs found."
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                searchStatus = error.messageForUser("Couldn’t search YouTube Music.")
            } finally {
                searching = false
            }
        }
    }

    private fun play(song: Song, quality: AudioQuality) {
        val player = controller ?: return
        fileJob?.cancel()
        playbackStatus = null
        player.setMediaItem(song.queueItem(quality))
        player.prepare()
        player.play()
    }

    private fun playCollection(songs: List<Song>, index: Int, shuffled: Boolean, quality: AudioQuality) {
        val player = controller ?: return
        val selected = songs.getOrNull(index)
        val playable = songs.filter { it.isLocal || source != null }
        if (playable.isEmpty()) return
        fileJob?.cancel()
        playbackStatus = null
        val items = playable.map { it.queueItem(quality) }
        player.shuffleModeEnabled = shuffled
        if (shuffled) {
            player.setMediaItems(items, true)
        } else {
            player.setMediaItems(items, playable.indexOf(selected).coerceAtLeast(0), 0L)
        }
        player.prepare()
        player.play()
    }

    @OptIn(UnstableApi::class)
    private fun enqueue(song: Song, quality: AudioQuality, playNext: Boolean) {
        val player = controller ?: return
        val item = song.queueItem(quality)
        val response = player.sendCustomCommand(ENQUEUE, Bundle().apply {
            putBundle(ITEM_KEY, item.toBundleIncludeLocalConfiguration())
            putBoolean(PLAY_NEXT_KEY, playNext)
        })
        response.addListener({
            if (!isDestroyed) {
                val success = runCatching { response.get().resultCode == SessionResult.RESULT_SUCCESS }
                    .getOrDefault(false)
                val message = when {
                    !success -> "Couldn’t add this song to the queue."
                    playNext -> "Added to play next"
                    else -> "Added to queue"
                }
                Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
            }
        }, Executor { runOnUiThread(it) })
    }

    private fun openAudio(uri: Uri) {
        val player = controller ?: return
        fileJob?.cancel()
        fileJob = lifecycleScope.launch {
            playbackStatus = null
            try {
                val item = withContext(Dispatchers.IO) {
                    val title = contentResolver.query(
                        uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null
                    )?.use { cursor ->
                        if (cursor.moveToFirst()) cursor.getString(0) else null
                    }
                    queueItem(uri, title ?: "Local audio", mimeType = contentResolver.getType(uri))
                }
                try {
                    contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                } catch (_: SecurityException) {
                    // The document can still play through its temporary grant.
                }
                player.setMediaItem(item)
                player.prepare()
                player.play()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                playbackStatus = error.messageForUser("Couldn’t open this audio file.")
            }
        }
    }

    override fun onDestroy() {
        MediaController.releaseFuture(controllerFuture)
        super.onDestroy()
    }

    private fun Exception.messageForUser(fallback: String): String = when (this) {
        is MusicSourceException -> message ?: fallback
        is IOException -> "Couldn’t load the audio or catalog. Check the connection and try again."
        else -> fallback
    }
}
