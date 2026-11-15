import { NativeModules } from 'react-native';
import * as Speech from 'expo-speech';

// Escolhe explicitamente uma voz em português; sem isso, muitas multimídias caem no idioma padrão (inglês).
let cached; // { voice, status } depois de resolvido

const norm = (l) => String(l || '').toLowerCase().replace('_', '-');

export async function findPortugueseVoice(force = false) {
  if (cached && !force) return cached;
  let voices = [];
  try {
    voices = await Speech.getAvailableVoicesAsync();
  } catch {}
  const pt = voices.filter((v) => norm(v.language).startsWith('pt'));
  const score = (v) =>
    (norm(v.language) === 'pt-br' ? 100 : norm(v.language) === 'pt' ? 50 : 0) +
    (v.quality === 'Enhanced' ? 10 : 0) +
    (/local/i.test(v.identifier) ? 5 : 0) - // voz offline
    (/network/i.test(v.identifier) ? 5 : 0);
  pt.sort((a, b) => score(b) - score(a));
  const voice = pt[0] || null;
  cached = { voice, total: voices.length };
  return cached;
}

/** Fala em português; usa a voz pt encontrada (se não houver, pede pt-BR ao motor). */
export async function speak(text, leadMs = 500) {
  const { voice } = await findPortugueseVoice();
  // abre o áudio (silêncio temporizado no nativo) para a multimídia não cortar o início da fala
  try { if (leadMs > 0) await NativeModules.KRadarZstd.primeAudio(leadMs); } catch {}
  Speech.speak(text, {
    language: voice ? voice.language : 'pt-BR',
    ...(voice ? { voice: voice.identifier } : {}),
    rate: 1.05,
  });
}

export function stopSpeech() {
  Speech.stop();
}

// ---- frases pré-gravadas pt-BR (assets/tts, tocadas pelo código nativo) ----
// Não dependem do motor/idioma de voz da multimídia. Só cobrem limites múltiplos de 5 (5..130);
// qualquer outro caso cai no TTS do sistema (plano B).
const LIMIT_CLIPS = new Set();
for (let v = 5; v <= 130; v += 5) LIMIT_CLIPS.add(v);

/** Lista de trechos de áudio para o aviso, ou null se não houver gravação. */
export function clipsFor(alert) {
  const { kind, limit } = alert;
  if (kind === 'RED_LIGHT') return ['p_semaforo'];
  const base = kind === 'SECTION' ? 'p_trecho' : 'p_radar';
  if (limit == null) return [base + '0'];
  const n = Math.round(Number(limit));
  if (!LIMIT_CLIPS.has(n)) return null;
  return [base, 'n_' + n];
}

let playing = false;

/**
 * Toca o aviso: áudio embutido (offline, sem depender do TTS); se faltar trecho, usa o TTS.
 * alert = { text, kind, limit }. Ignora chamadas enquanto outra fala está tocando só quando
 * `dropIfBusy` (usado pelo botão de teste); os avisos reais ficam em fila no nativo.
 */
export async function speakAlert(alert, leadMs = 500, dropIfBusy = false, source = 'app') {
  if (dropIfBusy && playing) return false;
  playing = true;
  try {
    // source 'android': usa só o TTS do sistema; 'app' (padrão): áudio embutido, TTS como reserva
    const clips = source === 'android' ? null : clipsFor(alert);
    if (clips) {
      try {
        await NativeModules.KRadarZstd.playClips(clips, leadMs);
        return true;
      } catch {
        // cai para o TTS
      }
    }
    try { Speech.stop(); } catch {}
    await speak(alert.text, leadMs);
    return true;
  } finally {
    playing = false;
  }
}
