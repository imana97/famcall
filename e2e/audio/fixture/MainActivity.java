package com.silvergridtech.famcall.audiofixture;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.content.res.Configuration;
import android.media.AudioRecord;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.MediaRecorder;
import android.view.WindowManager;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** Separate, network-free fixture for generated audio on disposable emulators. */
public class MainActivity extends Activity {
  private volatile boolean active = true;
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
  private void lifecycle(String event) {
    if (runId == null || !runId.matches("[A-Za-z0-9_-]{1,60}")) return;
    try (FileOutputStream file = new FileOutputStream(new File(getFilesDir(), runId + "-lifecycle.jsonl"), true)) {
      JSONObject value = new JSONObject().put("event", event).put("at", System.currentTimeMillis())
        .put("instance", System.identityHashCode(this)).put("pid", android.os.Process.myPid())
        .put("isFinishing", isFinishing()).put("isChangingConfigurations", isChangingConfigurations())
        .put("changingConfigurations", getChangingConfigurations());
      file.write((value.toString() + "\n").getBytes(StandardCharsets.UTF_8));
    } catch (Exception ignored) {}
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
