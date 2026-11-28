package space.ondavi.android

import android.content.Context
import android.net.Uri
import android.os.SystemClock
import android.util.LruCache
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.HttpDataSource
import kotlinx.coroutines.runBlocking
import java.io.IOException
import java.io.InterruptedIOException

private const val SONG_SCHEME = "ondavi-song"
private val VIDEO_ID = Regex("[a-zA-Z0-9_-]{11}")

internal fun songUri(song: Song, quality: AudioQuality): Uri =
    Uri.Builder().scheme(SONG_SCHEME).authority("youtube").appendPath(song.id)
        .appendQueryParameter("quality", quality.name).build()

internal fun isSongUri(uri: Uri): Boolean =
    uri.scheme == SONG_SCHEME && uri.authority == "youtube" &&
        uri.pathSegments.singleOrNull()?.let(VIDEO_ID::matches) == true

// Media3 calls open on its loader thread. Queue items keep stable URIs so each
// item can resolve when needed, even if it was queued hours ago.
@OptIn(UnstableApi::class)
internal class PlaybackSource(context: Context, private val music: MusicSource?) : DataSource.Factory {
    private data class Resolved(val uri: Uri, val validUntil: Long)

    private val upstream = DefaultDataSource.Factory(context)
    private val urls = LruCache<Uri, Resolved>(12)

    override fun createDataSource(): DataSource {
        val source = upstream.createDataSource()
        return object : DataSource by source {
            override fun open(dataSpec: DataSpec): Long {
                val uri = dataSpec.uri
                if (!isSongUri(uri)) return source.open(dataSpec)
                val resolved = resolve(uri)
                return try {
                    source.open(dataSpec.withUri(resolved.uri))
                } catch (error: HttpDataSource.InvalidResponseCodeException) {
                    if (error.responseCode != 403 && error.responseCode != 410) throw error
                    source.close()
                    synchronized(urls) {
                        if (urls.get(uri) == resolved) urls.remove(uri)
                    }
                    source.open(dataSpec.withUri(resolve(uri).uri))
                }
            }
        }
    }

    private fun resolve(uri: Uri): Resolved {
        val cached = urls.get(uri)
        if (cached != null && cached.validUntil > SystemClock.elapsedRealtime()) return cached
        val provider = music ?: throw IOException("YouTube Music is unavailable in this build.")
        val quality = if (uri.getQueryParameter("quality") == AudioQuality.DataSaver.name) {
            AudioQuality.DataSaver
        } else {
            AudioQuality.Best
        }
        val resolved = try {
            runBlocking { provider.resolve(requireNotNull(uri.lastPathSegment), quality) }
        } catch (error: InterruptedException) {
            throw InterruptedIOException().apply { initCause(error) }
        } catch (error: MusicSourceException) {
            throw IOException(error.message, error)
        } catch (error: Exception) {
            throw IOException("Couldn’t load the audio stream.", error)
        }
        val now = SystemClock.elapsedRealtime()
        val lifetime = resolved.getQueryParameter("expire")?.toLongOrNull()?.let { expiresAt ->
            (expiresAt * 1_000 - System.currentTimeMillis() - 30_000).coerceIn(0, 600_000)
        } ?: 600_000
        return Resolved(resolved, now + lifetime).also { urls.put(uri, it) }
    }
}
