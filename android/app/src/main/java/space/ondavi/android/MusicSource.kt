package space.ondavi.android

import android.net.Uri

internal data class Song(
    val id: String,
    val title: String,
    val artist: String,
    val artwork: Uri? = null,
    val mimeType: String? = null
) {
    val isLocal: Boolean get() = id.startsWith("content://")
}

internal enum class AudioQuality { Best, DataSaver }

internal interface MusicSource {
    suspend fun search(query: String): List<Song>
    suspend fun resolve(id: String, quality: AudioQuality): Uri
}

internal class MusicSourceException(message: String) : Exception(message)
