package com.kradarzstd;

import android.content.Intent;

import com.facebook.react.HeadlessJsTaskService;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.jstasks.HeadlessJsTaskConfig;

public class BootTaskService extends HeadlessJsTaskService {
    @Override
    protected HeadlessJsTaskConfig getTaskConfig(Intent intent) {
        // timeout 60 s; permitida mesmo com o app em primeiro plano
        return new HeadlessJsTaskConfig("KRadarBoot", Arguments.createMap(), 60000, true);
    }
}
