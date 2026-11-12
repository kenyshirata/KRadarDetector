package com.kradarzstd;

import com.facebook.react.bridge.Promise;
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
    private static final long WATCHDOG_MS = 6000; // sem novo setBeep em 6 s => para sozinho

    /** ms > 0: toca beep a cada ms; 0: para. O JS deve renovar a cada atualização de GPS. */
    @ReactMethod
    public void setBeep(final double msD) {
        final int ms = (int) msD;
        synchronized (BEEP_LOCK) {
            lastSet = System.currentTimeMillis();
            if (ms <= 0) {
                if (beepTask != null) { beepTask.cancel(false); beepTask = null; }
                currentMs = 0;
                return;
            }
            if (beepTask != null && ms == currentMs) return; // já tocando nesse ritmo
            if (beepTask != null) beepTask.cancel(false);
            if (exec == null) exec = java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
            if (tone == null) {
                try { tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 100); } catch (Throwable t) { tone = null; }
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
}
