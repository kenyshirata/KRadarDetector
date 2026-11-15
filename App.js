import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, NativeModules, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { speakAlert, stopSpeech, findPortugueseVoice } from './src/speech';
import Speedometer from './src/Speedometer';
import { readLastError, clearLastError } from './src/errorlog';
import { simulateApproach, OPTION_VALUES, DEFAULT_SETTINGS } from './src/detector';
import { UFS, loadConfig, saveConfig, updateDatabases, findPending, getDbs, getMeta, closeAll } from './src/database';
import { isServiceRunning, requestPermissions, startService, stopService } from './src/background';

export default function App() {
  const [ufs, setUfs] = useState([]);
  const [info, setInfo] = useState({}); // uf -> data da base instalada
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [showOptions, setShowOptions] = useState(false);
  const [autoStart, setAutoStart] = useState(true);
  const [voiceInfo, setVoiceInfo] = useState('Verificando voz...');
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [lastError, setLastError] = useState('');
  const autoDone = useRef(false);
  const voiceTesting = useRef(false);

  const refresh = useCallback(async () => {
    const cfg = await loadConfig();
    setAutoUpdate(cfg.autoUpdate);
    setLastError(await readLastError());
    setUfs(cfg.ufs);
    setSettings(cfg.settings);
    setAutoStart(cfg.autoStart);
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

  // Atualiza as bases selecionadas. Só mexe no serviço se houver algo para baixar:
  // sem internet (ou sem novidade) o serviço em segundo plano segue intacto.
  const update = useCallback(async (force = false, quiet = false) => {
    setError('');
    const cfg = await loadConfig();
    if (!cfg.ufs.length) return;
    let pending;
    try {
      setBusy('Consultando versão mais recente...');
      pending = await findPending(cfg.ufs, force);
    } catch (e) {
      setBusy('');
      if (!quiet) setError('Sem conexão com a internet para consultar atualizações.');
      return;
    }
    if (!pending.length) {
      setBusy(quiet ? '' : 'Tudo já está na versão mais recente.');
      return;
    }
    const wasRunning = await isServiceRunning();
    try {
      if (wasRunning) await stopService(); // o arquivo da base será trocado
      closeAll();
      const r = await updateDatabases(pending, setBusy, force);
      const fails = Object.values(r.failed);
      if (fails.length && !quiet) setError(fails.join(String.fromCharCode(10)));
      setBusy(r.updated.length ? 'Atualizado: ' + r.updated.join(', ') : '');
    } catch (e) {
      if (!quiet) setError(String(e.message || e));
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
      // por padrão o app NÃO usa a rede ao abrir; só se a opção estiver ligada
      if (cfg.autoUpdate && cfg.ufs.length) update(false, true).catch(() => {});
    })().catch(() => {});
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
    const say = (al) => speakAlert(al, settings.leadMs, false, settings.voice);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const beep = (ms) => { try { NativeModules.KRadarZstd.setBeep(ms); } catch {} };
    try {
      const steps = simulateApproach(await getDbs(), mode, settings);
      for (const st of steps) {
        setBusy(`Teste ${mode === 'above' ? 'ACIMA' : 'abaixo'} do limite: ${st.dist} m · ${Math.round(st.speedKmh)} km/h (limite ${st.limit})...`);
        beep(st.beepMs);
        st.alerts.forEach(say);
        await wait(st.alerts.length ? 4500 : 1500);
      }
      beep(0);
      setBusy('Teste concluído.');
    } catch (e) {
      try { NativeModules.KRadarZstd.setBeep(0); } catch {}
      setBusy('');
      setError(String(e.message || e));
    }
  };

  // Para o serviço (e o beep), marca como desativado e encerra o processo do app.
  const quit = async () => {
    try {
      await stopService();
      await saveConfig({ enabled: false });
    } catch {}
    try { NativeModules.KRadarZstd.quitApp(); } catch { BackHandler.exitApp(); }
  };

  const checkVoice = async (force) => {
    const { voice, total } = await findPortugueseVoice(force);
    setVoiceInfo(voice ? 'Voz em português: ' + voice.name + ' (' + voice.language + ')' : 'Nenhuma voz em português instalada (' + total + ' vozes no aparelho). Instale pt-BR nas configurações de voz do Android.');
  };

  // Testar voz: toca UMA vez; ignora toques enquanto estiver falando (evita repetição em fila).
  const testVoice = async () => {
    if (voiceTesting.current) return;
    voiceTesting.current = true;
    try {
      stopSpeech();
      checkVoice(true);
      await speakAlert({ text: 'Atenção! Radar à frente, limite 60', kind: 'FIXED', limit: 60 }, settings.leadMs, true, settings.voice);
    } finally {
      voiceTesting.current = false;
    }
  };

  const openVoiceSettings = async () => {
    try {
      await Linking.sendIntent('com.android.settings.TTS_SETTINGS');
    } catch {
      try { await Linking.sendIntent('android.settings.SETTINGS'); } catch { setError('Não consegui abrir as configurações de voz do Android.'); }
    }
  };

  const setOption = async (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    await saveConfig({ settings: next });
  };

  const fmt = (v, key) => (key === 'voice' ? (v === 'app' ? 'App (pt-BR embutida)' : 'Android (voz do sistema)') : v === 0 ? 'Desligado' : key === 'leadMs' ? `${v / 1000} s` : `${v} m`);
  const groups = [
    { key: 'beepM', title: 'Beep começa a tocar a (antes do radar)' },
    { key: 'firstM', title: 'Primeiro aviso falado' },
    { key: 'secondM', title: 'Segundo aviso falado' },
    { key: 'voice', title: 'Voz dos avisos' },
    { key: 'leadMs', title: 'Atraso e som de abertura antes da fala (evita cortar o começo)' },
  ];

  if (showOptions) {
    return (
      <View style={s.root}>
        <View style={s.header}>
          <Text style={s.title}>Opções</Text>
          <Pressable style={[s.btn, s.btnBlue, { marginTop: 0, paddingHorizontal: 24 }]} onPress={() => { stopSpeech(); setShowOptions(false); }}>
            <Text style={s.btnText}>Voltar</Text>
          </Pressable>
        </View>
        <ScrollView>
          {groups.map((g) => (
            <View key={g.key} style={{ marginBottom: 14 }}>
              <Text style={s.line}>{g.title}</Text>
              <View style={s.grid}>
                {OPTION_VALUES[g.key].map((v) => (
                  <Pressable key={v} style={[s.chip, settings[g.key] === v && s.chipOn]} onPress={() => setOption(g.key, v)}>
                    <Text style={s.chipText}>{fmt(v, g.key)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          <View style={{ marginBottom: 14 }}>
            <Text style={s.line}>Iniciar junto com o Android</Text>
            <View style={s.grid}>
              {[[true, 'Ligado'], [false, 'Desligado']].map(([v, label]) => (
                <Pressable key={label} style={[s.chip, autoStart === v && s.chipOn]} onPress={async () => { setAutoStart(v); await saveConfig({ autoStart: v }); }}>
                  <Text style={s.chipText}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={{ marginBottom: 14 }}>
            <Text style={s.line}>Voz da narração</Text>
            <Text style={s.info}>Padrão: voz pt-BR embutida no app (offline, não depende do idioma da multimídia; a voz do sistema só entra como reserva). Opção "Android": usa sempre a voz do sistema, abaixo.</Text>
            <Text style={s.info}>{voiceInfo}</Text>
            <View style={s.row}>
              <Pressable style={[s.btn, s.flex, s.btnGray]} onPress={testVoice}>
                <Text style={s.btnText}>Testar voz</Text>
              </Pressable>
              <Pressable style={[s.btn, s.flex, s.btnGray]} onPress={openVoiceSettings}>
                <Text style={s.btnText}>Config. de voz do Android</Text>
              </Pressable>
            </View>
          </View>
          <View style={{ marginBottom: 14 }}>
            <Text style={s.line}>Atualizar bases ao abrir o app (usa internet)</Text>
            <View style={s.grid}>
              {[[true, 'Ligado'], [false, 'Desligado']].map(([v, label]) => (
                <Pressable key={label} style={[s.chip, autoUpdate === v && s.chipOn]} onPress={async () => { setAutoUpdate(v); await saveConfig({ autoUpdate: v }); }}>
                  <Text style={s.chipText}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Text style={s.foot}>Acima do limite de velocidade do radar o beep fica mais rápido (0,2 s).</Text>
        </ScrollView>
      </View>
    );
  }

  const missing = ufs.filter((u) => !info[u]);

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>KRadarDetector</Text>
        <Text style={s.line}>Serviço: <Text style={{ color: running ? '#4ade80' : '#f87171' }}>{running ? 'ATIVO' : 'parado'}</Text></Text>
      </View>

      {/* status e erros sempre visíveis, no topo (telas pequenas cortam o rodapé) */}
      {!!busy && <Text style={s.info}>{busy}</Text>}
      {!!error && <Text style={s.err} onPress={() => setError('')}>{error}  (toque para fechar)</Text>}

      {!!lastError && (
        <Text style={s.err} onPress={async () => { await clearLastError(); setLastError(''); }} numberOfLines={3}>
          Último erro registrado (toque para limpar): {lastError}
        </Text>
      )}

      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        <Speedometer />
        <View style={s.row}>
          <Pressable style={[s.btn, s.flex, running && s.btnOff]} onPress={toggleService}>
            <Text style={s.btnText}>{running ? 'Desativar' : 'Ativar'}</Text>
          </Pressable>
          <Pressable style={[s.btn, s.flex, s.btnBlue]} onPress={() => update(false)} disabled={busy.includes('...')}>
            <Text style={s.btnText}>{missing.length ? 'Baixar bases' : 'Atualizar bases'}</Text>
          </Pressable>
        </View>

        <View style={s.row}>
          <Pressable style={[s.btn, s.flex, s.btnGray]} onPress={() => testAlert('below')} disabled={busy.includes('...')}>
            <Text style={s.btnText}>Testar: abaixo do limite</Text>
          </Pressable>
          <Pressable style={[s.btn, s.flex, s.btnWarn]} onPress={() => testAlert('above')} disabled={busy.includes('...')}>
            <Text style={s.btnText}>Testar: acima do limite</Text>
          </Pressable>
        </View>

        <View style={s.row}>
          <Pressable style={[s.btn, s.flex, s.btnGray]} onPress={() => { setShowOptions(true); checkVoice(false); }}>
            <Text style={s.btnText}>Opções</Text>
          </Pressable>
          <Pressable style={[s.btn, s.flex, s.btnOff]} onPress={quit}>
            <Text style={s.btnText}>Encerrar app</Text>
          </Pressable>
        </View>

        <Text style={[s.line, { marginTop: 14 }]}>Estados (toque para marcar/desmarcar):</Text>
        <View style={s.grid}>
          {UFS.map((u) => (
            <Pressable key={u} style={[s.chip, ufs.includes(u) && s.chipOn]} onPress={() => toggleUf(u)} disabled={busy.includes('...')}>
              <Text style={s.chipText}>{u}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ marginTop: 8 }}>
          {ufs.map((u) => (
            <Text key={u} style={s.line}>
              {u}: {info[u] ? `base de ${info[u]}` : <Text style={{ color: '#facc15' }}>não instalada</Text>}
            </Text>
          ))}
          {!ufs.length && <Text style={s.line}>Nenhum estado selecionado.</Text>}
        </View>

        <Text style={s.foot}>Dados: Pardal (OpenStreetMap, ODbL 1.0)</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', padding: 14, paddingTop: 28 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  line: { color: '#ddd', fontSize: 16, marginVertical: 3 },
  row: { flexDirection: 'row' },
  flex: { flex: 1, marginHorizontal: 3 },
  btn: { backgroundColor: '#16a34a', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  btnOff: { backgroundColor: '#dc2626' },
  btnBlue: { backgroundColor: '#2563eb' },
  btnGray: { backgroundColor: '#4b5563' },
  btnWarn: { backgroundColor: '#ea580c' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: 'bold', textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  chip: { backgroundColor: '#222', paddingVertical: 8, paddingHorizontal: 12, margin: 3, borderRadius: 6 },
  chipOn: { backgroundColor: '#2563eb' },
  chipText: { color: '#fff', fontSize: 15 },
  info: { color: '#facc15', fontSize: 15, marginBottom: 4 },
  err: { color: '#f87171', fontSize: 15, marginBottom: 4 },
  foot: { color: '#666', fontSize: 11, marginTop: 10 },
});
