package com.silvergridtech.famcall.diagnostics

import android.content.Context
import android.media.AudioFormat
import android.os.SystemClock
import android.util.Log
import com.oney.WebRTCModule.WebRTCModuleOptions
import org.json.JSONObject
import org.webrtc.audio.JavaAudioDeviceModule
import kotlin.math.abs
import kotlin.math.sqrt

/** Opt-in test APK only. Retains aggregate energy, never PCM or speech recordings. */
object FamCallAudioRecordDiagnostics {
  private const val TAG = "FamCallAudioRecord"

  @JvmStatic
  fun install(context: Context) {
    check(context.packageName == "com.silvergridtech.famcall.e2e")
    val options = WebRTCModuleOptions.getInstance()
    check(options.audioDeviceModule == null) { "An audio device module is already configured" }
    val meter = RecordingMeter()
    // Keep react-native-webrtc's default Java ADM settings. The callbacks add
    // observation only; no rate, source, effects, routing or mute overrides.
    options.audioDeviceModule = JavaAudioDeviceModule.builder(context.applicationContext)
      .setEnableVolumeLogger(false)
      .setSamplesReadyCallback(meter)
      .setAudioRecordStateCallback(meter)
      .createAudioDeviceModule()
  }

  private class RecordingMeter : JavaAudioDeviceModule.SamplesReadyCallback,
    JavaAudioDeviceModule.AudioRecordStateCallback {
    private var session = 0
    private var firstAt = 0L
    private var lastAt = 0L
    private var firstElapsed = 0L
    private var sampleRate = 0
    private var channels = 0
    private var callbacks = 0
    private var samples = 0L
    private var zeros = 0L
    private var squares = 0.0
    private var peak = 0

    @Synchronized
    override fun onWebRtcAudioRecordStart() {
      flush()
      session += 1
      event("start")
    }

    @Synchronized
    override fun onWebRtcAudioRecordStop() {
      flush()
      event("stop")
    }

    @Synchronized
    override fun onWebRtcAudioRecordSamplesReady(audio: JavaAudioDeviceModule.AudioSamples) {
      // This SDK callback sees the recording buffer after Java microphone mute.
      // It is not a measurement of the physical microphone before Android effects.
      if (audio.audioFormat != AudioFormat.ENCODING_PCM_16BIT || audio.channelCount < 1
          || audio.sampleRate <= 0 || audio.data.size % (2 * audio.channelCount) != 0) {
        flush()
        event("unsupported-format")
        return
      }
      if (samples > 0 && (sampleRate != audio.sampleRate || channels != audio.channelCount)) flush()
      val now = System.currentTimeMillis()
      if (samples == 0L) {
        firstAt = now
        firstElapsed = SystemClock.elapsedRealtime()
        sampleRate = audio.sampleRate
        channels = audio.channelCount
      }
      lastAt = now
      val data = audio.data
      for (index in data.indices step 2) {
        val value = ((data[index].toInt() and 255) or (data[index + 1].toInt() shl 8)).toShort().toInt()
        squares += value.toDouble() * value
        samples += 1
        if (value == 0) zeros += 1
        peak = maxOf(peak, abs(value))
      }
      callbacks += 1
      if (SystemClock.elapsedRealtime() - firstElapsed >= 1000) flush()
    }

    private fun flush() {
      if (samples == 0L) return
      Log.i(TAG, JSONObject().put("kind", "samples").put("session", session)
        .put("from", firstAt).put("to", lastAt).put("sampleRate", sampleRate)
        .put("channels", channels).put("callbacks", callbacks).put("sampleCount", samples)
        .put("audioSeconds", samples.toDouble() / channels / sampleRate)
        .put("rms", sqrt(squares / samples) / 32768.0).put("peak", peak / 32768.0)
        .put("zeroFraction", zeros.toDouble() / samples).toString())
      samples = 0
      zeros = 0
      squares = 0.0
      peak = 0
      callbacks = 0
    }

    private fun event(kind: String) {
      Log.i(TAG, JSONObject().put("kind", kind).put("session", session)
        .put("at", System.currentTimeMillis()).toString())
    }
  }
}
