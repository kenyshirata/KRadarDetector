import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NativeModules, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';
import { simulateApproach, OPTION_VALUES, DEFAULT_SETTINGS } from './src/detector';
import { UFS, loadConfig, saveConfig, updateDatabases, getDbs, getMeta, closeAll } from './src/database';
import { isServiceRunning, requestPermissions, startService, stopService } from './src/background';

export default function App() {
  const [ufs, setUfs] = useState([]);
  const [info, setInfo] = useState({}); // uf -> data da base instalada
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [showOptions, setShowOptions] = useState(false);
  const autoDone = useRef(false);

  const refresh = useCallback(async () => {
    const cfg = await loadConfig();
    setUfs(cfg.ufs);
    setSettings(cfg.settings);
    setRunning(await isServiceRunning());
    const next = {};
    try {
      for (const d of await getDbs()) next[d.uf] = String(getMeta(d).built_at || '?').slice(0, 10);
    } catch (e) {
      setError(String(e.message || e));
    }
    setInfo(next);
    return cfg;
  }, []);

  // Atualiza as bases selecionadas; reinicia o serviço se estava ativo (o arquivo é trocado).
  const update = useCallback(async (force = false, quiet = false) => {
    setError('');
    const cfg = await loadConfig();
    const wasRunning = await isServiceRunning();
    try {
      if (!cfg.ufs.length) return;
      if (wasRunning) await stopService();
      closeAll();
      const r = await updateDatabases(cfg.ufs, setBusy, force);
      const fails = Object.values(r.failed);
      if (fails.length && !quiet) setError(fails.join('\n'));
      setBusy(r.updated.length ? `Atualizado: ${r.updated.join(', ')}` : quiet ? '' : 'Tudo já está na versão mais recente.');
    } catch (e) {
      if (!quiet) setError(String(e.message || e)); // offline ao abrir: silencioso
      setBusy('');
    } finally {
      if (wasRunning) await startService().catch(() => {});
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    (async () => {
      const cfg = await refresh();
      if (autoDone.current) return;
      autoDone.current = true;
      // ao abrir: baixa o que falta / o que mudou (sem alarde se estiver offline)
      if (cfg.ufs.length) update(false, true);
    })();
  }, [refresh, update]);

  const toggleUf = async (u) => {
    const next = ufs.includes(u) ? ufs.filter((x) => x !== u) : [...ufs, u].sort();
    setUfs(next);
    await saveConfig({ ufs: next });
    if (!next.includes(u)) {
      // removido: apaga o arquivo para liberar espaço
      closeAll();
      await FileSystem.deleteAsync(FileSystem.documentDirectory + `pardal-${u}.sqlite`, { idempotent: true });
      await refresh();
    }
  };

  const toggleService = async () => {
    setError('');
    try {
      if (running) {
        await stopService();
        await saveConfig({ enabled: false });
      } else {
        if (!Object.keys(info).length) return setError('Baixe a base de pelo menos um estado primeiro.');
        if (!(await requestPermissions())) return setError('Permissão de localização (sempre) negada.');
        await startService();
        await saveConfig({ enabled: true });
      }
      setRunning(await isServiceRunning());
    } catch (e) {
      setError(String(e.message || e));
    }
  };

  // Simula a chegada a um radar (real da base instalada, ou fictício sem base).
  // mode: 'below' = abaixo do limite (beep compassado); 'above' = acima (beep rápido).
  const testAlert = async (mode) => {
    setError('');
    const say = (m) => Speech.speak(m, { language: 'pt-BR', rate: 1.05 });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const beep = (ms) => { try { NativeModules.KRadarZstd.setBeep(ms); } catch {} };
    try {
      const steps = simulateApproach(await getDbs(), mode, settings);
      for (const st of steps) {
        setBusy(`Teste ${mode === 'above' ? 'ACIMA' : 'abaixo'} do limite: ${st.dist} m · ${Math.round(st.speedKmh)} km/h (limite ${st.limit})...`);
        beep(st.beepMs);
        st.msgs.forEach(say);
        await wait(st.msgs.length ? 3500 : 1500);
      }
      beep(0);
      setBusy('Teste concluído.');
    } catch (e) {
      try { NativeModules.KRadarZstd.setBeep(0); } catch {}
      setBusy('');
      setError(String(e.message || e));
    }
  };

  const setOption = async (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    await saveConfig({ settings: next });
  };

  const fmt = (v) => (v === 0 ? 'Desligado' : `${v} m`);
  const groups = [
    { key: 'beepM', title: 'Beep começa a tocar a (antes do radar)' },
    { key: 'firstM', title: 'Primeiro aviso falado' },
    { key: 'secondM', title: 'Segundo aviso falado' },
  ];

  if (showOptions) {
    return (
      <View style={s.root}>
        <Text style={s.title}>Opções</Text>
        <ScrollView>
          {groups.map((g) => (
            <View key={g.key} style={{ marginBottom: 14 }}>
              <Text style={s.line}>{g.title}</Text>
              <View style={s.grid}>
                {OPTION_VALUES[g.key].map((v) => (
                  <Pressable key={v} style={[s.chip, settings[g.key] === v && s.chipOn]} onPress={() => setOption(g.key, v)}>
                    <Text style={s.chipText}>{fmt(v)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          <Text style={s.foot}>Acima do limite de velocidade do radar o beep fica mais rápido (0,2 s).</Text>
        </ScrollView>
        <Pressable style={[s.btn, s.btnBlue]} onPress={() => setShowOptions(false)}>
          <Text style={s.btnText}>Voltar</Text>
        </Pressable>
      </View>
    );
  }

  const missing = ufs.filter((u) => !info[u]);

  return (
    <View style={s.root}>
      <Text style={s.title}>KRadarDetector</Text>
      <Text style={s.line}>Serviço: <Text style={{ color: running ? '#4ade80' : '#f87171' }}>{running ? 'ATIVO' : 'parado'}</Text></Text>

      <Pressable style={[s.btn, running && s.btnOff]} onPress={toggleService}>
        <Text style={s.btnText}>{running ? 'Desativar' : 'Ativar'}</Text>
      </Pressable>

      <Text style={[s.line, { marginTop: 18 }]}>Estados (toque para marcar/desmarcar):</Text>
      <View style={s.grid}>
        {UFS.map((u) => (
          <Pressable key={u} style={[s.chip, ufs.includes(u) && s.chipOn]} onPress={() => toggleUf(u)} disabled={!!busy && busy.includes('...')}>
            <Text style={s.chipText}>{u}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={{ marginTop: 10 }}>
        {ufs.map((u) => (
          <Text key={u} style={s.line}>
            {u}: {info[u] ? `base de ${info[u]}` : <Text style={{ color: '#facc15' }}>não instalada</Text>}
          </Text>
        ))}
        {!ufs.length && <Text style={s.line}>Nenhum estado selecionado.</Text>}
      </ScrollView>

      <Pressable style={[s.btn, s.btnBlue]} onPress={() => update(false)} disabled={!!busy && busy.includes('...')}>
        <Text style={s.btnText}>{missing.length ? 'Baixar bases' : 'Atualizar bases'}</Text>
      </Pressable>

      <Pressable style={[s.btn, s.btnGray]} onPress={() => setShowOptions(true)}>
        <Text style={s.btnText}>Opções</Text>
      </Pressable>
      <Pressable style={[s.btn, s.btnGray]} onPress={() => testAlert('below')} disabled={!!busy && busy.includes('...')}>
        <Text style={s.btnText}>Testar: abaixo do limite</Text>
      </Pressable>
      <Pressable style={[s.btn, s.btnWarn]} onPress={() => testAlert('above')} disabled={!!busy && busy.includes('...')}>
        <Text style={s.btnText}>Testar: acima do limite</Text>
      </Pressable>

      {!!busy && <Text style={s.info}>{busy}</Text>}
      {!!error && <Text style={s.err}>{error}</Text>}
      <Text style={s.foot}>Dados: Pardal (OpenStreetMap, ODbL 1.0)</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', padding: 20, paddingTop: 48 },
  title: { color: '#fff', fontSize: 24, fontWeight: 'bold', marginBottom: 12 },
  line: { color: '#ddd', fontSize: 16, marginVertical: 3 },
  btn: { backgroundColor: '#16a34a', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 12 },
  btnOff: { backgroundColor: '#dc2626' },
  btnBlue: { backgroundColor: '#2563eb' },
  btnGray: { backgroundColor: '#4b5563' },
  btnWarn: { backgroundColor: '#ea580c' },
  btnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  chip: { backgroundColor: '#222', paddingVertical: 8, paddingHorizontal: 12, margin: 3, borderRadius: 6 },
  chipOn: { backgroundColor: '#2563eb' },
  chipText: { color: '#fff', fontSize: 15 },
  info: { color: '#facc15', marginTop: 8 },
  err: { color: '#f87171', marginTop: 8 },
  foot: { color: '#666', fontSize: 11, marginTop: 8 },
});
