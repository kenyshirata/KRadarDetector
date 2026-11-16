import { NativeModules } from 'react-native';

// Níveis de volume dos avisos (voz embutida e beeps). O áudio embutido já vem com ganho alto;
// 'gain' é a fração aplicada na reprodução e 'tone' o volume (0-100) do beep.
export const VOLUME_LEVELS = {
  low: { label: 'Baixo', gain: 0.3, tone: 35 },
  medium: { label: 'Médio', gain: 0.55, tone: 60 },
  high: { label: 'Alto', gain: 0.8, tone: 80 },
  max: { label: 'Muito alto', gain: 1.0, tone: 100 },
};

export const levelOf = (settings) => VOLUME_LEVELS[settings && settings.volume] || VOLUME_LEVELS.high;

/** Beep intermitente nativo (0 = parar). */
export function setBeep(ms, settings) {
  try {
    NativeModules.KRadarZstd.setBeep(ms, levelOf(settings).tone);
  } catch {}
}
