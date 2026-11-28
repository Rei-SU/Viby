package space.ondavi.android

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    private var sessionStore: PlaybackSessionStore? = null
    private var listeningHistory: ListeningHistory? = null

    override fun onCreate() {
        super.onCreate()
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()
        val player = ExoPlayer.Builder(this)
            .setAudioAttributes(audioAttributes, true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .setMediaSourceFactory(DefaultMediaSourceFactory(PlaybackSource(this, createMusicSource())))
            .build()
        sessionStore = PlaybackSessionStore(this, player)
        listeningHistory = ListeningHistory(player, LocalLibrary.get(this))
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        session = MediaSession.Builder(this, player)
            .setSessionActivity(openApp)
            .setCallback(object : MediaSession.Callback {
                override fun onConnect(
                    session: MediaSession,
                    controller: MediaSession.ControllerInfo
                ): MediaSession.ConnectionResult {
                    val result = MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                    if (controller.uid == applicationInfo.uid) {
                        val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                            .add(ENQUEUE).build()
                        result.setAvailableSessionCommands(commands)
                    } else {
                        val commands = MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS.buildUpon()
                            .remove(Player.COMMAND_CHANGE_MEDIA_ITEMS)
                            .remove(Player.COMMAND_SET_MEDIA_ITEM)
                            .build()
                        result.setAvailablePlayerCommands(commands)
                    }
                    return result.build()
                }

                override fun onCustomCommand(
                    session: MediaSession,
                    controller: MediaSession.ControllerInfo,
                    command: SessionCommand,
                    args: Bundle
                ): ListenableFuture<SessionResult> {
                    if (controller.uid != applicationInfo.uid || command != ENQUEUE) {
                        return Futures.immediateFuture(SessionResult(SessionError.ERROR_PERMISSION_DENIED))
                    }
                    val item = args.getBundle(ITEM_KEY)?.let { MediaItem.fromBundle(it) }
                    val uri = item?.localConfiguration?.uri
                    if (item == null || uri == null || (uri.scheme != "content" && !isSongUri(uri))) {
                        return Futures.immediateFuture(SessionResult(SessionError.ERROR_BAD_VALUE))
                    }
                    player.insertIntoQueue(item, args.getBoolean(PLAY_NEXT_KEY))
                    return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
                }
            })
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
        session.takeIf { controllerInfo.uid == applicationInfo.uid || controllerInfo.isTrusted }

    override fun onDestroy() {
        listeningHistory?.close()
        listeningHistory = null
        sessionStore?.close()
        sessionStore = null
        session?.let {
            it.player.release()
            it.release()
        }
        session = null
        super.onDestroy()
    }
}
