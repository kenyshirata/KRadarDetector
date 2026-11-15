import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { speak } from './speech';
import { logError } from './errorlog';
import { AppRegistry } from 'react-native';
import { getDbs, loadConfig } from './database';
import { NativeModules } from 'react-native';
import { analyze, resetStages } from './detector';

const setBeep = (ms) => { try { NativeModules.KRadarZstd.setBeep(ms); } catch {} };

export const TASK_NAME = 'kradar-location';

// Roda em modo headless (Foreground Service) mesmo com o app minimizado/tela apagada.
TaskManager.defineTask(TASK_NAME, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  try {
    const dbs = await getDbs();
    if (!dbs.length) return setBeep(0);
    const l = data.locations[data.locations.length - 1];
    const loc = {
      lat: l.coords.latitude,
      lng: l.coords.longitude,
      heading: l.coords.heading,
      speed: l.coords.speed,
      accuracy: l.coords.accuracy,
    };
    const { settings } = await loadConfig();
    const { msgs, beepMs } = analyze(dbs, loc, undefined, settings);
    setBeep(beepMs); // renovado a cada atualização de GPS; o nativo repete entre elas
    for (const msg of msgs) {
      speak(msg, settings.leadMs);
    }
  } catch (e) {
    logError('task', e);
  }
});

export async function requestPermissions() {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;
  // Android <= 9: concedido junto com o foreground; 10+: pedido separado
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.status === 'granted';
}

export async function isServiceRunning() {
  try {
    return await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
  } catch {
    return false;
  }
}

export async function startService() {
  if (await isServiceRunning()) return;
  resetStages();
  await Location.startLocationUpdatesAsync(TASK_NAME, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 2000, // a cada X segundos (Android)
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'KRadarDetector ativo',
      notificationBody: 'Monitorando radares em segundo plano',
    },
  });
}

export async function stopService() {
  setBeep(0);
  if (await isServiceRunning()) await Location.stopLocationUpdatesAsync(TASK_NAME);
}

// Executada sem tela quando o Android termina de ligar (ver BootReceiver, módulo kradar-zstd).
AppRegistry.registerHeadlessTask('KRadarBoot', () => async () => {
  try {
    const cfg = await loadConfig();
    if (!cfg.autoStart || !cfg.ufs.length) return;
    await startService();
  } catch (e) {
    console.warn('kradar boot', e);
  }
});
