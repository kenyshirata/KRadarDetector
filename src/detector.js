// Lógica pura (sem dependências de RN) para ser testável em Node.
const SCALE = 100000;
const ZOOM_N = 8192;
export const SEARCH_RADIUS_M = 700;
export const FAR_M = 600;
export const NEAR_M = 150;
export const BEEP_M = 200; // abaixo disso toca beep contínuo
export const BEEP_NORMAL_MS = 1000; // compassado (dentro do limite)
export const BEEP_FAST_MS = 200; // acima do limite de velocidade do radar

// Opções configuráveis (0 = desligado). Valores permitidos na tela de opções.
export const OPTION_VALUES = {
  beepM: [50, 100, 150, 200, 250, 300],
  firstM: [0, 200, 300, 400, 500, 600],
  secondM: [0, 50, 100, 150],
  leadMs: [0, 300, 500, 800, 1000, 1500], // atraso antes da fala (acorda o áudio da multimídia)
};
export const DEFAULT_SETTINGS = { beepM: 200, firstM: 600, secondM: 150, leadMs: 500 };

export function normalizeSettings(s) {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(OPTION_VALUES)) {
    if (s && OPTION_VALUES[k].includes(s[k])) out[k] = s[k];
  }
  return out;
}
const MAX_DIR_DIFF = 60;
const MAX_ACCURACY_FOR_DIR = 15;
const MIN_SPEED_MS = 2; // ~7 km/h: abaixo disso o rumo do GPS não é confiável

const toRad = (d) => (d * Math.PI) / 180;

export function distanceM(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingDeg(lat1, lng1, lat2, lng2) {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

const clamp = (v) => Math.max(0, Math.min(ZOOM_N - 1, v));

/** Tile zoom 13 (Web Mercator) da posição. */
export function cellOf(lat, lng) {
  const la = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const x = clamp(Math.floor(((lng + 180) / 360) * ZOOM_N));
  const s = Math.sin(toRad(la));
  const y = clamp(Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * ZOOM_N));
  return { x, y };
}

/** As 9 células ao redor; cada célula é x * 8192 + y. */
export function neighborCells(lat, lng) {
  const { x, y } = cellOf(lat, lng);
  const cells = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      const cx = x + dx;
      const cy = y + dy;
      if (cx >= 0 && cy >= 0 && cx < ZOOM_N && cy < ZOOM_N) cells.push(cx * ZOOM_N + cy);
    }
  return cells;
}

/** Menor distância ao radar (ponto, ou início/fim no radar de trecho). */
function distToRadar(r, lat, lng) {
  const d1 = distanceM(lat, lng, r.lat / SCALE, r.lng / SCALE);
  if (r.end_lat != null && r.end_lng != null) {
    return Math.min(d1, distanceM(lat, lng, r.end_lat / SCALE, r.end_lng / SCALE));
  }
  return d1;
}

export function queryNearby(db, lat, lng) {
  const cells = neighborCells(lat, lng);
  const ph = cells.map(() => '?').join(',');
  const rows = db.getAllSync(
    `SELECT id, kind, lat, lng, end_lat, end_lng, limit_kmh, direction_deg, direction_scope
     FROM event
     WHERE seq IN (SELECT seq FROM event_cell WHERE cell IN (${ph}))
       AND type = 'CAMERA' AND active = 1`,
    cells
  );
  const out = [];
  for (const r of rows) {
    const dist = distToRadar(r, lat, lng);
    if (dist <= SEARCH_RADIUS_M) out.push({ ...r, dist });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

/**
 * Filtro de sentido. loc = { lat, lng, heading, speed, accuracy }.
 * - direction_deg ausente (ou escopo BOTH/UNKNOWN): avisa nos dois sentidos.
 * - Ignora se a diferença para o rumo > 60°, só com precisão <= 15 m e em movimento.
 */
export function passesDirectionFilter(r, loc) {
  const moving = loc.speed != null && loc.speed >= MIN_SPEED_MS && loc.heading != null && loc.heading >= 0;
  const reliable = moving && loc.accuracy != null && loc.accuracy <= MAX_ACCURACY_FOR_DIR;
  if (!reliable) return true;
  if (r.direction_deg != null && r.direction_scope !== 'BOTH' && r.direction_scope !== 'UNKNOWN') {
    if (angleDiff(r.direction_deg, loc.heading) > MAX_DIR_DIFF) return false;
  }
  // radar já ficou para trás
  if (r.dist > NEAR_M / 3) {
    const brg = bearingDeg(loc.lat, loc.lng, r.lat / SCALE, r.lng / SCALE);
    if (angleDiff(brg, loc.heading) > 100) return false;
  }
  return true;
}

// estágio por radar: 1 = aviso longe dado, 2 = aviso perto dado
const stages = new Map();

export function resetStages() {
  stages.clear();
}

/**
 * Analisa a posição. dbs = lista de bases abertas (um estado cada).
 * Retorna { msgs, beepMs }: frases a falar e intervalo do beep (0 = sem beep).
 * Beep a <= 200 m: compassado; se a velocidade passa do limite do radar, mais rápido.
 */
export function analyze(dbs, loc, stageMap = stages, settings = DEFAULT_SETTINGS) {
  const { beepM, firstM, secondM } = normalizeSettings(settings);
  const list = Array.isArray(dbs) ? dbs : [dbs];
  const msgs = [];
  const nearby = [];
  for (const db of list) {
    for (const r of queryNearby(db, loc.lat, loc.lng)) {
      if (passesDirectionFilter(r, loc)) nearby.push({ ...r, key: `${db.uf || ''}:${r.id}` });
    }
  }
  nearby.sort((a, b) => a.dist - b.dist);
  const speedKmh = loc.speed != null && loc.speed >= 0 ? loc.speed * 3.6 : 0;
  let beepMs = 0;
  const seen = new Set();
  for (const r of nearby) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    if (r.dist <= beepM) {
      const over = r.limit_kmh != null && speedKmh > r.limit_kmh;
      const ms = over ? BEEP_FAST_MS : BEEP_NORMAL_MS;
      beepMs = beepMs === 0 ? ms : Math.min(beepMs, ms);
    }
    const st = stageMap.get(r.key) || 0;
    const lim = r.limit_kmh ? `, limite ${r.limit_kmh}` : '';
    const what = r.kind === 'RED_LIGHT' ? 'Câmera de semáforo' : r.kind === 'SECTION' ? 'Radar de trecho' : 'Radar';
    if (secondM > 0 && r.dist <= secondM) {
      if (st < 2) {
        stageMap.set(r.key, 2);
        msgs.push(`Atenção! ${what} à frente${lim}`);
      }
    } else if (firstM > 0 && r.dist <= firstM && r.dist > secondM && st < 1) {
      stageMap.set(r.key, 1);
      msgs.push(`Atenção! ${what} à frente${lim}`);
    }
  }
  // radar fora do alcance libera o estado para avisar de novo numa próxima passagem
  for (const k of [...stageMap.keys()]) if (!seen.has(k)) stageMap.delete(k);
  return { msgs, beepMs };
}

/** Compatibilidade: só as frases. */
export function evaluate(dbs, loc, stageMap = stages, settings = DEFAULT_SETTINGS) {
  return analyze(dbs, loc, stageMap, settings).msgs;
}

// radar sintético usado quando não há base instalada
const FAKE_RADAR = {
  id: 1, kind: 'FIXED', lat: -2355000, lng: -4663000, end_lat: null, end_lng: null,
  limit_kmh: 60, direction_deg: 90, direction_scope: 'ONE',
};

const SIM_DISTANCES = [700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 100, 50, 0];

/**
 * Simulação para teste: "dirige" até um radar real da base (ou um radar fictício se não
 * houver base), de 700 m a 0, usando a mesma lógica de avisos e beeps.
 * mode: 'below' (10 km/h abaixo do limite) ou 'above' (20 km/h acima).
 * Retorna [{ dist, speedKmh, limit, msgs, beepMs }]. Usa estado de avisos próprio.
 */
export function simulateApproach(dbs, mode = 'below', settings = DEFAULT_SETTINGS) {
  let row = null;
  let owner = null;
  for (const db of dbs) {
    const q = (extra) =>
      db.getAllSync(
        `SELECT id, kind, lat, lng, end_lat, end_lng, limit_kmh, direction_deg, direction_scope
         FROM event WHERE type = 'CAMERA' AND active = 1 AND kind = 'FIXED' ${extra} LIMIT 1`
      )[0];
    row = q('AND limit_kmh IS NOT NULL') || q('');
    if (row) { owner = db; break; }
  }
  if (!row) row = FAKE_RADAR;
  const limit = row.limit_kmh != null ? row.limit_kmh : 60;
  const radar = { ...row, limit_kmh: limit };
  const speedKmh = mode === 'above' ? limit + 20 : Math.max(10, limit - 10);
  const only = { uf: owner ? owner.uf : 'SIM', getAllSync: () => [radar] };

  const rlat = radar.lat / SCALE;
  const rlng = radar.lng / SCALE;
  const heading = radar.direction_deg != null ? radar.direction_deg : 0;
  const h = toRad(heading);
  const sim = new Map();
  return SIM_DISTANCES.map((dist) => {
    const loc = {
      lat: rlat - (Math.cos(h) * dist) / 111320,
      lng: rlng - (Math.sin(h) * dist) / (111320 * Math.cos(toRad(rlat))),
      heading,
      speed: speedKmh / 3.6,
      accuracy: 5,
    };
    const { msgs, beepMs } = analyze([only], loc, sim, settings);
    return { dist, speedKmh, limit, msgs, beepMs };
  });
}
