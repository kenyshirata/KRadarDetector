package com.kradarzstd;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.facebook.react.HeadlessJsTaskService;

/** Ao ligar o Android, sobe uma task JS sem tela ("KRadarBoot") que inicia o serviço de radar. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            context.startService(new Intent(context, BootTaskService.class));
            HeadlessJsTaskService.acquireWakeLockNow(context);
        } catch (Throwable ignored) {
        }
    }
}
