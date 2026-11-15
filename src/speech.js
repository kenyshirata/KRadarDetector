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
