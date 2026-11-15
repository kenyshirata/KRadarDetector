import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { logError } from './errorlog';

const MIN_KMH = 2; // abaixo disso é ruído do GPS parado
const MAX_ACCURACY_M = 50; // pior que isso: a velocidade do GPS não é confiável

/** Velocímetro por GPS (funciona offline). Mostra velocidade atual, máxima e qualidade do sinal. */
export default function Speedometer() {
  const [speed, setSpeed] = useState(0);
  const [max, setMax] = useState(0);
  const [acc, setAcc] = useState(null);
  const [state, setState] = useState('Aguardando GPS...');

  useEffect(() => {
    let alive = true;
    let sub = null;
    (async () => {
      try {
        const p = await Location.requestForegroundPermissionsAsync();
        if (p.status !== 'granted') {
          setState('Sem permissão de localização');
          return;
        }
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
          (l) => {
            if (!alive) return;
            const a = l.coords.accuracy;
            const ms = l.coords.speed;
            let kmh = ms != null && ms > 0 ? ms * 3.6 : 0;
            if (kmh < MIN_KMH) kmh = 0;
            const reliable = a != null && a <= MAX_ACCURACY_M;
            setAcc(a);
            setState(reliable ? 'GPS ok' : 'GPS fraco');
            if (reliable) {
              setSpeed(kmh);
              setMax((m) => Math.max(m, kmh));
            }
          }
        );
        if (!alive && sub) sub.remove();
      } catch (e) {
        setState('GPS indisponível');
        logError('speedometer', e);
      }
    })();
    return () => {
      alive = false;
      try { sub && sub.remove(); } catch {}
    };
  }, []);

  return (
    <View style={s.card}>
      <View style={s.center}>
        <Text style={s.speed}>{Math.round(speed)}</Text>
        <Text style={s.unit}>km/h</Text>
      </View>
      <View style={s.side}>
        <Text style={s.small}>Máxima: {Math.round(max)} km/h</Text>
        <Text style={s.small}>{state}{acc != null ? ` · ±${Math.round(acc)} m` : ''}</Text>
        <Pressable style={s.reset} onPress={() => setMax(0)}>
          <Text style={s.resetText}>Zerar máxima</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderRadius: 10, padding: 12, marginBottom: 6 },
  center: { flex: 1, alignItems: 'center' },
  speed: { color: '#fff', fontSize: 72, fontWeight: 'bold', lineHeight: 78 },
  unit: { color: '#9ca3af', fontSize: 16 },
  side: { flex: 1, paddingLeft: 10 },
  small: { color: '#d1d5db', fontSize: 14, marginVertical: 2 },
  reset: { backgroundColor: '#374151', borderRadius: 6, paddingVertical: 8, paddingHorizontal: 10, marginTop: 6, alignSelf: 'flex-start' },
  resetText: { color: '#fff', fontSize: 14 },
});
