package com.silvergridtech.famcall.audiofixture;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.content.res.Configuration;
import android.media.AudioRecord;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecordingConfiguration;
import android.media.AudioDeviceInfo;
import android.media.MediaRecorder;
import android.view.WindowManager;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Separate, network-free fixture for generated audio on disposable emulators. */
public class MainActivity extends Activity {
  private volatile boolean active = true;
  private volatile int observationWriteFailures = 0;
  private String runId;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    runId = getIntent().getStringExtra("runId");
    if (!(Build.HARDWARE.equals("ranchu") || Build.HARDWARE.equals("goldfish")) ||
        runId == null || !runId.matches("[A-Za-z0-9_-]{1,60}")) {
      finish();
      return;
    }
    lifecycle("create");
    try {
      // A configuration recreation must not truncate the first recorder's PCM
      // or launch a second capture with the same evidence identifiers.
      if (!new File(getFilesDir(), runId + ".claim").createNewFile()) {
        lifecycle("duplicate-refused");
        finish();
        return;
      }
    } catch (Exception error) {
      lifecycle("claim-failed");
      finish();
      return;
    }
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    TextView label = new TextView(this);
    label.setText("Generated audio fixture — emulator only");
    setContentView(label);
    new Thread(this::record, "fixture-recording").start();
  }

  private void record() {
    AudioRecord recorder = null;
    ScheduledExecutorService observations = null;
    AudioManager manager = (AudioManager)getSystemService(AUDIO_SERVICE);
    int priorMode = manager.getMode();
    JSONObject result = new JSONObject();
    try (FileOutputStream pcm = new FileOutputStream(new File(getFilesDir(), runId + ".pcm"))) {
      android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO);
      manager.setMode(AudioManager.MODE_IN_COMMUNICATION);
      int rate = 8000;
      int minimum = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
      if (minimum <= 0) throw new IllegalStateException("Unsupported recording format");
      recorder = new AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
        .setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
        .setBufferSizeInBytes(2 * minimum).setContext(this).build();
      if (recorder.getState() != AudioRecord.STATE_INITIALIZED || manager.isMicrophoneMute())
        throw new IllegalStateException("Recorder unavailable or microphone muted");
      recorder.startRecording();
      final AudioRecord observedRecorder = recorder;
      observations = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "fixture-observation");
        thread.setDaemon(true);
        return thread;
      });
      // Observe policy without changing source, rate, mute, focus or routing.
      // A separate thread keeps Binder queries/file writes off the PCM reader.
      observations.scheduleWithFixedDelay(() -> observeRecording(observedRecorder, manager),
        0, 1, TimeUnit.SECONDS);
      result.put("runId", runId).put("pid", android.os.Process.myPid())
        .put("rate", recorder.getSampleRate()).put("source", recorder.getAudioSource())
        .put("startedAt", System.currentTimeMillis());
      save(runId + "-started.json", result);
      short[] buffer = new short[80];
      byte[] bytes = new byte[160];
      long samples = 0, deadline = SystemClock.elapsedRealtime() + 45000;
      while (active && SystemClock.elapsedRealtime() < deadline) {
        int count = recorder.read(buffer, 0, buffer.length, AudioRecord.READ_BLOCKING);
        if (count <= 0) throw new IllegalStateException("AudioRecord read failed: " + count);
        for (int i = 0; i < count; i++) {
          bytes[2 * i] = (byte)buffer[i];
          bytes[2 * i + 1] = (byte)(buffer[i] >> 8);
        }
        pcm.write(bytes, 0, count * 2);
        samples += count;
      }
      result.put("sampleCount", samples).put("completed", active)
        .put("microphoneMuted", manager.isMicrophoneMute());
    } catch (Exception error) {
      try { result.put("error", error.getClass().getSimpleName() + ": " + error.getMessage()); }
      catch (Exception ignored) {}
    } finally {
      if (observations != null) {
        observations.shutdownNow();
        try { result.put("observationThreadStopped", observations.awaitTermination(2, TimeUnit.SECONDS)); }
        catch (Exception ignored) {}
      }
      try { result.put("observationWriteFailures", observationWriteFailures); }
      catch (Exception ignored) {}
      if (recorder != null) {
        try { recorder.stop(); } catch (Exception ignored) {}
        recorder.release();
      }
      manager.setMode(priorMode);
      try {
        result.put("finishedAt", System.currentTimeMillis());
        save(runId + "-result.json", result);
      } catch (Exception ignored) {}
    }
  }

  private void save(String name, JSONObject value) throws Exception {
    File pending = new File(getFilesDir(), name + ".pending");
    try (FileOutputStream file = new FileOutputStream(pending)) {
      file.write(value.toString().getBytes(StandardCharsets.UTF_8));
    }
    if (!pending.renameTo(new File(getFilesDir(), name)))
      throw new IllegalStateException("Could not publish recorder status");
  }

  private JSONObject format(AudioFormat value) throws Exception {
    return new JSONObject().put("sampleRate", value.getSampleRate())
      .put("channelCount", value.getChannelCount()).put("channelMask", value.getChannelMask())
      .put("encoding", value.getEncoding());
  }

  private void observeRecording(AudioRecord recorder, AudioManager manager) {
    JSONObject value = new JSONObject();
    try {
      value.put("at", System.currentTimeMillis()).put("known", false)
        .put("audioSessionId", recorder.getAudioSessionId())
        .put("recordingState", recorder.getRecordingState())
        .put("microphoneMuted", manager.isMicrophoneMute());
      AudioRecordingConfiguration config = recorder.getActiveRecordingConfiguration();
      if (config == null) {
        value.put("status", "inactive-or-unavailable");
      } else {
        AudioDeviceInfo device = config.getAudioDevice();
        value.put("known", true).put("clientSilenced", config.isClientSilenced())
          .put("clientAudioSessionId", config.getClientAudioSessionId())
          .put("clientAudioSource", config.getClientAudioSource())
          .put("clientFormat", format(config.getClientFormat()))
          .put("deviceFormat", format(config.getFormat()));
        if (device != null) value.put("deviceId", device.getId()).put("deviceType", device.getType());
      }
    } catch (Exception error) {
      try { value.put("known", false).put("error", error.getClass().getSimpleName()); }
      catch (Exception ignored) {}
    }
    try (FileOutputStream file = new FileOutputStream(new File(getFilesDir(), runId + "-recording-config.jsonl"), true)) {
      file.write((value.toString() + "\n").getBytes(StandardCharsets.UTF_8));
    } catch (Exception ignored) { observationWriteFailures++; }
  }

  private void lifecycle(String event) {
    if (runId == null || !runId.matches("[A-Za-z0-9_-]{1,60}")) return;
    try (FileOutputStream file = new FileOutputStream(new File(getFilesDir(), runId + "-lifecycle.jsonl"), true)) {
      JSONObject value = new JSONObject().put("event", event).put("at", System.currentTimeMillis())
        .put("instance", System.identityHashCode(this)).put("pid", android.os.Process.myPid())
        .put("isFinishing", isFinishing()).put("isChangingConfigurations", isChangingConfigurations())
        .put("changingConfigurations", getChangingConfigurations()).put("windowFocused", hasWindowFocus());
      file.write((value.toString() + "\n").getBytes(StandardCharsets.UTF_8));
    } catch (Exception ignored) {}
  }
  @Override public void onStart() { super.onStart(); lifecycle("start"); }
  @Override public void onResume() { super.onResume(); lifecycle("resume"); }
  @Override public void onPause() { lifecycle("pause"); super.onPause(); }
  @Override public void onStop() { lifecycle("stop"); super.onStop(); }
  @Override public void onWindowFocusChanged(boolean focused) {
    super.onWindowFocusChanged(focused);
    lifecycle(focused ? "window-focused" : "window-unfocused");
  }
  @Override public void onConfigurationChanged(Configuration config) {
    super.onConfigurationChanged(config);
    lifecycle("configuration-changed");
  }
  @Override public void onDestroy() {
    lifecycle("destroy");
    active = false;
    super.onDestroy();
  }
}
