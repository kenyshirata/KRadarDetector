import * as FileSystem from 'expo-file-system';
import { open } from 'react-native-quick-sqlite';
import { NativeModules } from 'react-native';
import { normalizeSettings } from './detector';

const BASE = 'https://github.com/Murkiriel/pardal/releases/latest/download';
// quick-sqlite abre arquivos em context.getFilesDir() == documentDirectory (SQLite próprio, não o do sistema: Android 5 tem 3.8)
const SQLITE_DIR = FileSystem.documentDirectory;
const CONFIG_URI = FileSystem.documentDirectory + 'config.json';
const SUPPORTED_SCHEMA = 1;

export const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const dbs = new Map(); // uf -> adaptador

const fileOf = (uf) => `pardal-${uf}.sqlite`;

export async function loadConfig() {
  let cfg;
  try {
    cfg = JSON.parse(await FileSystem.readAsStringAsync(CONFIG_URI));
  } catch {
    cfg = {};
  }
  // migração do formato antigo (um único estado)
  if (!cfg.ufs) cfg.ufs = cfg.uf ? [cfg.uf] : []; // o usuário escolhe os estados
  cfg.hashes = cfg.hashes || {};
  cfg.enabled = !!cfg.enabled;
  cfg.settings = normalizeSettings(cfg.settings);
  return cfg;
}

export async function saveConfig(patch) {
  const cfg = { ...(await loadConfig()), ...patch };
  await FileSystem.writeAsStringAsync(CONFIG_URI, JSON.stringify(cfg));
  return cfg;
}

/** Mapa nome-do-arquivo -> sha256 publicado na release mais recente. */
async function fetchSums() {
  const res = await fetch(`${BASE}/SHA256SUMS.txt`);
  if (!res.ok) throw new Error(`SHA256SUMS.txt indisponível (HTTP ${res.status})`);
  const out = {};
  const text = await res.text();
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m) out[m[2].trim()] = m[1].toLowerCase();
  }
  return out;
}

/** Baixa pardal-<UF>.sqlite.zst, confere o sha256, descompacta e instala. */
async function downloadOne(uf, want, onStatus) {
  const file = `pardal-${uf}.sqlite.zst`;
  const tmp = FileSystem.cacheDirectory + file;
  onStatus(`${uf}: baixando...`);
  const dl = await FileSystem.downloadAsync(`${BASE}/${file}`, tmp);
  if (dl.status !== 200) throw new Error(`${uf}: download falhou (HTTP ${dl.status})`);
  onStatus(`${uf}: verificando...`);
  const got = await NativeModules.KRadarZstd.sha256File(tmp);
  if (got !== want) throw new Error(`${uf}: sha256 não confere`);
  onStatus(`${uf}: descompactando...`);
  closeDb(uf);
  const name = fileOf(uf);
  const partial = SQLITE_DIR + name + '.tmp';
  // streaming arquivo -> arquivo no código nativo (SP tem ~86 MB: não cabe como string no JS)
  await NativeModules.KRadarZstd.decompressFile(tmp, partial);
  await FileSystem.deleteAsync(SQLITE_DIR + name, { idempotent: true });
  await FileSystem.moveAsync({ from: partial, to: SQLITE_DIR + name });
  await FileSystem.deleteAsync(tmp, { idempotent: true });
}

/**
 * Instala/atualiza as bases dos estados informados.
 * Só baixa o que mudou (compara o sha256 publicado com o da última instalação).
 * Retorna { updated: [...], current: [...], failed: { UF: msg } }.
 */
export async function updateDatabases(ufs, onStatus = () => {}, force = false) {
  const result = { updated: [], current: [], failed: {} };
  onStatus('Consultando versão mais recente...');
  const sums = await fetchSums();
  const cfg = await loadConfig();
  const hashes = { ...cfg.hashes };
  for (const uf of ufs) {
    const want = sums[`pardal-${uf}.sqlite.zst`];
    try {
      if (!want) throw new Error(`${uf}: base ainda não publicada no Pardal`);
      const exists = (await FileSystem.getInfoAsync(SQLITE_DIR + fileOf(uf))).exists;
      if (!force && exists && hashes[uf] === want) {
        result.current.push(uf);
        continue;
      }
      await downloadOne(uf, want, onStatus);
      hashes[uf] = want;
      await saveConfig({ hashes });
      result.updated.push(uf);
    } catch (e) {
      result.failed[uf] = String(e.message || e);
    }
  }
  return result;
}

export function closeDb(uf) {
  const d = dbs.get(uf);
  try { d?.closeSync(); } catch {}
  dbs.delete(uf);
}

export function closeAll() {
  for (const uf of [...dbs.keys()]) closeDb(uf);
}

// Adaptador com a mesma interface sync usada pelo detector.
function openDb(uf) {
  if (dbs.has(uf)) return dbs.get(uf);
  const q = open({ name: fileOf(uf) });
  const run = (sql, params = []) => q.execute(sql, params).rows?._array ?? [];
  const d = {
    uf,
    getAllSync: run,
    getFirstSync: (sql, p) => run(sql, p)[0],
    closeSync: () => q.close(),
  };
  const v = d.getFirstSync('PRAGMA user_version');
  if (v && v.user_version > SUPPORTED_SCHEMA) {
    d.closeSync();
    throw new Error(`${uf}: base com schema mais novo que o suportado; atualize o app.`);
  }
  dbs.set(uf, d);
  return d;
}

/** Abre todas as bases selecionadas e instaladas (usado também pelo serviço em segundo plano). */
export async function getDbs() {
  const { ufs } = await loadConfig();
  const out = [];
  for (const uf of ufs) {
    if (!dbs.has(uf) && !(await FileSystem.getInfoAsync(SQLITE_DIR + fileOf(uf))).exists) continue;
    out.push(openDb(uf));
  }
  // fecha as que saíram da seleção
  for (const uf of [...dbs.keys()]) if (!ufs.includes(uf)) closeDb(uf);
  return out;
}

export function getMeta(d) {
  const out = {};
  for (const r of d.getAllSync('SELECT * FROM meta')) {
    const v = Object.values(r); // colunas chave/valor (nomes não documentados)
    out[v[0]] = v[1];
  }
  return out;
}
