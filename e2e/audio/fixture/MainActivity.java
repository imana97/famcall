package com.silvergridtech.famcall.audiofixture;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
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
    try (FileOutputStream file = new FileOutputStream(new File(getFilesDir(), name))) {
      file.write(value.toString().getBytes(StandardCharsets.UTF_8));
    }
  }
  @Override public void onDestroy() { active = false; super.onDestroy(); }
}
