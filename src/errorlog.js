import * as FileSystem from 'expo-file-system';

const URI = FileSystem.documentDirectory + 'lasterror.txt';

/** Guarda o último erro em arquivo, para diagnóstico (sem depender de rede nem de adb). */
export async function logError(where, e) {
  try {
    const msg = e && (e.stack || e.message) ? e.stack || e.message : String(e);
    await FileSystem.writeAsStringAsync(URI, `${new Date().toISOString()} [${where}]\n${msg}`.slice(0, 4000));
  } catch {}
}

export async function readLastError() {
  try {
    return await FileSystem.readAsStringAsync(URI);
  } catch {
    return '';
  }
}

export async function clearLastError() {
  try {
    await FileSystem.deleteAsync(URI, { idempotent: true });
  } catch {}
}
