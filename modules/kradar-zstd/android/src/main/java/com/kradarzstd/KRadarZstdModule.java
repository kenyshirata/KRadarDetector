package com.kradarzstd;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.github.luben.zstd.ZstdInputStream;

import android.media.AudioManager;
import android.media.ToneGenerator;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;

public class KRadarZstdModule extends ReactContextBaseJavaModule {
    public KRadarZstdModule(ReactApplicationContext ctx) { super(ctx); }

    @Override
    public String getName() { return "KRadarZstd"; }

    private static String strip(String p) { return p.startsWith("file://") ? p.substring(7) : p; }

    /** Descompacta src (.zst) para dst em streaming, sem carregar nada inteiro na memória. */
    @ReactMethod
    public void decompressFile(final String src, final String dst, final Promise promise) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                File out = new File(strip(dst));
                try (InputStream in = new ZstdInputStream(new BufferedInputStream(new FileInputStream(strip(src)), 1 << 16));
                     OutputStream os = new BufferedOutputStream(new FileOutputStream(out), 1 << 16)) {
                    byte[] buf = new byte[1 << 16];
                    long total = 0;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        os.write(buf, 0, n);
                        total += n;
                    }
                    os.flush();
                    promise.resolve((double) total);
                } catch (Throwable t) {
                    out.delete();
                    promise.reject("E_ZSTD", String.valueOf(t.getMessage()), t);
                }
            }
        }, "kradar-zstd").start();
    }

    /** sha256 hex do arquivo, em streaming. */
    @ReactMethod
    public void sha256File(final String path, final Promise promise) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try (InputStream in = new BufferedInputStream(new FileInputStream(strip(path)), 1 << 16)) {
                    MessageDigest md = MessageDigest.getInstance("SHA-256");
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
                    StringBuilder sb = new StringBuilder();
                    for (byte b : md.digest()) sb.append(String.format("%02x", b));
                    promise.resolve(sb.toString());
                } catch (Throwable t) {
                    promise.reject("E_SHA", String.valueOf(t.getMessage()), t);
                }
            }
        }, "kradar-sha").start();
    }
    // ---- beep nativo: continua tocando mesmo com o JS pausado em segundo plano ----
    private static final Object BEEP_LOCK = new Object();
    private static ToneGenerator tone;
    private static java.util.concurrent.ScheduledExecutorService exec;
    private static java.util.concurrent.ScheduledFuture<?> beepTask;
    private static volatile long lastSet = 0;
    private static int currentMs = 0;
    private static int toneVolume = 80; // 0-100
    private static final long WATCHDOG_MS = 6000; // sem novo setBeep em 6 s => para sozinho

    /** ms > 0: toca beep a cada ms; 0: para. O JS deve renovar a cada atualização de GPS. */
    @ReactMethod
    public void setBeep(final double msD, final double volumeD) {
        final int ms = (int) msD;
        final int vol = Math.max(0, Math.min(100, (int) volumeD));
        synchronized (BEEP_LOCK) {
            lastSet = System.currentTimeMillis();
            if (ms <= 0) {
                if (beepTask != null) { beepTask.cancel(false); beepTask = null; }
                currentMs = 0;
                return;
            }
            if (vol != toneVolume) { // volume mudou: recria o gerador de tom
                toneVolume = vol;
                try { if (tone != null) tone.release(); } catch (Throwable ignored) {}
                tone = null;
            }
            if (beepTask != null && ms == currentMs) return; // já tocando nesse ritmo
            if (beepTask != null) beepTask.cancel(false);
            if (exec == null) exec = java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
            if (tone == null) {
                try { tone = new ToneGenerator(AudioManager.STREAM_MUSIC, toneVolume); } catch (Throwable t) { tone = null; }
            }
            currentMs = ms;
            beepTask = exec.scheduleAtFixedRate(new Runnable() {
                @Override
                public void run() {
                    synchronized (BEEP_LOCK) {
                        if (System.currentTimeMillis() - lastSet > WATCHDOG_MS) {
                            if (beepTask != null) beepTask.cancel(false);
                            beepTask = null;
                            currentMs = 0;
                            return;
                        }
                        if (tone != null) tone.startTone(ToneGenerator.TONE_PROP_BEEP, 120);
                    }
                }
            }, 0, ms, java.util.concurrent.TimeUnit.MILLISECONDS);
        }
    }
    /** Fecha a tela, remove o app dos recentes e encerra o processo (derruba também o beep). */
    @ReactMethod
    public void quitApp() {
        setBeep(0, 0);
        final android.app.Activity act = getCurrentActivity();
        if (act != null) {
            act.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try { act.finishAndRemoveTask(); } catch (Throwable ignored) { act.finish(); }
                }
            });
        }
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() { android.os.Process.killProcess(android.os.Process.myPid()); }
        }, 400);
    }
    /**
     * Abre o caminho de áudio antes da fala: toca um som curto quase inaudível + silêncio por ms (STREAM_MUSIC) e só então resolve.
     * Muitas multimídias demoram para "acordar" o amplificador e cortam o início da fala.
     * O tempo é medido no nativo, então não pausa com o JS em segundo plano.
     */
    @ReactMethod
    public void primeAudio(final double msD, final Promise promise) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                final int ms = (int) msD;
                android.media.AudioTrack track = null;
                try {
                    if (ms > 0) {
                        final int rate = 22050;
                        final int bytes = rate * ms / 1000 * 2;
                        int min = android.media.AudioTrack.getMinBufferSize(rate,
                                android.media.AudioFormat.CHANNEL_OUT_MONO, android.media.AudioFormat.ENCODING_PCM_16BIT);
                        track = new android.media.AudioTrack(AudioManager.STREAM_MUSIC, rate,
                                android.media.AudioFormat.CHANNEL_OUT_MONO, android.media.AudioFormat.ENCODING_PCM_16BIT,
                                Math.max(min, bytes), android.media.AudioTrack.MODE_STREAM);
                        track.play();
                        // som curto e quase inaudível (~4% do volume, 1 kHz, 150 ms, com fade) no início,
                        // seguido de silêncio até completar ms: acorda amplificadores que ignoram silêncio puro.
                        final byte[] pcm = new byte[bytes];
                        final int toneSamples = Math.min(rate * 150 / 1000, bytes / 2);
                        final int fade = rate * 20 / 1000;
                        for (int i = 0; i < toneSamples; i++) {
                            double env = Math.min(1.0, Math.min((double) i / fade, (double) (toneSamples - i) / fade));
                            short v = (short) (Math.sin(2 * Math.PI * 1000.0 * i / rate) * 1300 * env);
                            pcm[2 * i] = (byte) (v & 0xff);
                            pcm[2 * i + 1] = (byte) ((v >> 8) & 0xff);
                        }
                        track.write(pcm, 0, bytes);
                        Thread.sleep(ms);
                    }
                } catch (Throwable ignored) {
                } finally {
                    try { if (track != null) { track.stop(); track.release(); } } catch (Throwable ignored) {}
                    promise.resolve(true);
                }
            }
        }, "kradar-prime").start();
    }
    private static final Object PLAY_LOCK = new Object(); // uma fala por vez

    private static byte[] readClip(android.content.res.AssetManager am, String name) throws java.io.IOException {
        java.io.InputStream in = am.open("tts/" + name + ".wav");
        try {
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            byte[] all = bo.toByteArray();
            // WAV canônico gerado pelo projeto: PCM 16 kHz mono 16 bits, dados a partir do byte 44
            byte[] pcm = new byte[all.length - 44];
            System.arraycopy(all, 44, pcm, 0, pcm.length);
            return pcm;
        } finally {
            in.close();
        }
    }

    /**
     * Toca frases pré-gravadas em pt-BR (assets/tts/*.wav), sem usar o motor de voz do sistema.
     * Antes: som curto quase inaudível + silêncio até completar leadMs (acorda o áudio da multimídia).
     * Resolve quando termina de tocar; rejeita se algum trecho não existir (o JS usa o TTS como plano B).
     */
    @ReactMethod
    public void playClips(final ReadableArray names, final double leadMsD, final double gainD, final Promise promise) {
        final android.content.res.AssetManager am = getReactApplicationContext().getAssets();
        new Thread(new Runnable() {
            @Override
            public void run() {
                synchronized (PLAY_LOCK) {
                    android.media.AudioTrack track = null;
                    try {
                        final int rate = 16000;
                        final int leadMs = (int) leadMsD;
                        java.io.ByteArrayOutputStream pcm = new java.io.ByteArrayOutputStream();
                        if (leadMs > 0) {
                            int leadSamples = rate * leadMs / 1000;
                            int toneSamples = Math.min(rate * 150 / 1000, leadSamples);
                            int fade = rate * 20 / 1000;
                            for (int i = 0; i < leadSamples; i++) {
                                short v = 0;
                                if (i < toneSamples) {
                                    double env = Math.min(1.0, Math.min((double) i / fade, (double) (toneSamples - i) / fade));
                                    v = (short) (Math.sin(2 * Math.PI * 1000.0 * i / rate) * 1300 * env);
                                }
                                pcm.write(v & 0xff);
                                pcm.write((v >> 8) & 0xff);
                            }
                        }
                        final byte[] gap = new byte[rate * 80 / 1000 * 2];
                        for (int i = 0; i < names.size(); i++) {
                            if (i > 0) pcm.write(gap, 0, gap.length);
                            byte[] clip = readClip(am, names.getString(i));
                            pcm.write(clip, 0, clip.length);
                        }
                        final byte[] data = pcm.toByteArray();
                        final float gain = (float) Math.max(0.0, Math.min(1.0, gainD));
                        if (gain < 0.999f) { // volume do aviso (o áudio embutido já vem com ganho alto)
                            for (int i = 0; i + 1 < data.length; i += 2) {
                                int v = (short) ((data[i] & 0xff) | (data[i + 1] << 8));
                                v = Math.round(v * gain);
                                data[i] = (byte) (v & 0xff);
                                data[i + 1] = (byte) ((v >> 8) & 0xff);
                            }
                        }
                        int min = android.media.AudioTrack.getMinBufferSize(rate,
                                android.media.AudioFormat.CHANNEL_OUT_MONO, android.media.AudioFormat.ENCODING_PCM_16BIT);
                        track = new android.media.AudioTrack(AudioManager.STREAM_MUSIC, rate,
                                android.media.AudioFormat.CHANNEL_OUT_MONO, android.media.AudioFormat.ENCODING_PCM_16BIT,
                                Math.max(min, 8192), android.media.AudioTrack.MODE_STREAM);
                        track.play();
                        track.write(data, 0, data.length);
                        Thread.sleep((long) (data.length / 2) * 1000L / rate + 200L);
                        promise.resolve(true);
                    } catch (Throwable t) {
                        promise.reject("E_CLIPS", String.valueOf(t.getMessage()), t);
                    } finally {
                        try { if (track != null) { track.stop(); track.release(); } } catch (Throwable ignored) {}
                    }
                }
            }
        }, "kradar-clips").start();
    }
}
