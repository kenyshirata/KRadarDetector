const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PROGUARD = `
# --- KRadarDetector ---
# Expo instancia TaskConsumers/módulos por reflexão: não ofuscar.
-keep class expo.modules.** { *; }
-keep class org.unimodules.** { *; }
-keep class com.kradarzstd.** { *; }
-keep class com.github.luben.zstd.** { *; }
-keep class com.margelo.** { *; }
-keepclassmembers class * implements expo.modules.interfaces.taskManager.TaskConsumerInterface { <init>(...); }
`;

// - react-native-quick-sqlite empacota libs que o RN já fornece: usa a primeira encontrada.
// - Limita o APK às ABIs ARM (multimídia antiga); remove x86 para reduzir o tamanho.
// - Regras do ProGuard/R8 para o expo-task-manager funcionar no release.
module.exports = (config) => {
  config = withAppBuildGradle(config, (c) => {
    let s = c.modResults.contents;
    if (!s.includes('pickFirst "**/*.so"')) {
      s = s.replace(/android\s*\{/, 'android {\n    packagingOptions {\n        pickFirst "**/*.so"\n    }');
    }
    if (!s.includes('abiFilters')) {
      s = s.replace(/defaultConfig\s*\{/, 'defaultConfig {\n        ndk { abiFilters "armeabi-v7a", "arm64-v8a" }');
    }
    c.modResults.contents = s;
    return c;
  });
  return withDangerousMod(config, [
    'android',
    (c) => {
      const file = path.join(c.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (!cur.includes('--- KRadarDetector ---')) fs.writeFileSync(file, cur + PROGUARD);
      return c;
    },
  ]);
};
