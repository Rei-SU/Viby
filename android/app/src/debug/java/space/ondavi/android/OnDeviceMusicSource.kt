package space.ondavi.android

import android.net.Uri
import androidx.core.net.toUri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList.YouTube
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.search.SearchInfo
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubeSearchQueryHandlerFactory.MUSIC_SONGS
import org.schabi.newpipe.extractor.stream.DeliveryMethod.PROGRESSIVE_HTTP
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem
import java.util.concurrent.TimeUnit

internal fun createMusicSource(): MusicSource? = OnDeviceMusicSource

private object OnDeviceMusicSource : MusicSource {
    private val videoId = Regex("[a-zA-Z0-9_-]{11}")
    private val requests = Mutex()

    init {
        NewPipe.init(ExtractorDownloader())
    }

    override suspend fun search(query: String): List<Song> = extract {
        val handler = YouTube.searchQHFactory.fromQuery(query, listOf(MUSIC_SONGS), "")
        SearchInfo.getInfo(YouTube, handler).relatedItems
            .filterIsInstance<StreamInfoItem>()
            .mapNotNull { item ->
                val id = YouTube.streamLHFactory.getId(item.url)
                if (!videoId.matches(id)) return@mapNotNull null
                val artwork = item.thumbnails.maxByOrNull { it.width }?.url?.toUri()
                    ?.takeIf { it.scheme == "https" }
                Song(id, item.name, item.uploaderName.orEmpty(), artwork)
            }
            .distinctBy(Song::id)
    }

    override suspend fun resolve(id: String, quality: AudioQuality): Uri = extract {
        require(videoId.matches(id))
        val streams = StreamInfo.getInfo(YouTube, "https://www.youtube.com/watch?v=$id")
            .audioStreams
            .filter { it.isUrl && it.deliveryMethod == PROGRESSIVE_HTTP }
        val stream = when (quality) {
            AudioQuality.Best -> streams.maxByOrNull { it.averageBitrate }
            AudioQuality.DataSaver -> streams
                .filter { it.averageBitrate in 1..64 }
                .maxByOrNull { it.averageBitrate }
        } ?: throw MusicSourceException(
            if (quality == AudioQuality.DataSaver && streams.isNotEmpty()) {
                "This song has no audio stream at 64 kbps or below."
            } else {
                "This song has no playable audio stream."
            }
        )
        val uri = stream.content.toUri()
        if (uri.scheme != "https") throw MusicSourceException("The audio provider returned an invalid stream.")
        uri
    }

    private suspend fun <T> extract(block: () -> T): T = requests.withLock {
        withContext(Dispatchers.IO) {
            try {
                block()
            } catch (_: ReCaptchaException) {
                throw MusicSourceException("YouTube Music is limiting requests. Try again later.")
            }
        }
    }
}

private class ExtractorDownloader : Downloader() {
    private val client = OkHttpClient.Builder()
        .callTimeout(15, TimeUnit.SECONDS)
        .build()

    override fun execute(request: Request): Response {
        val builder = okhttp3.Request.Builder()
            .url(request.url())
            .method(request.httpMethod(), request.dataToSend()?.toRequestBody())
        request.headers().forEach { (name, values) ->
            values.forEach { builder.addHeader(name, it) }
        }
        client.newCall(builder.build()).execute().use { response ->
            if (response.code == 429) {
                throw ReCaptchaException("The music provider is rate-limiting requests.", request.url())
            }
            return Response(
                response.code,
                response.message,
                response.headers.toMultimap(),
                response.body?.string(),
                response.request.url.toString()
            )
        }
    }
}
