import assert from 'node:assert/strict';
import { evaluate, resetStages, cellOf, neighborCells, passesDirectionFilter } from '../src/detector.js';

// Radar em (-23.55000, -46.63000), sentido 90° (leste)
const radar = { id: 1, kind: 'FIXED', lat: -2355000, lng: -4663000, end_lat: null, end_lng: null, limit_kmh: 60, direction_deg: 90, direction_scope: 'ONE' };
const db = { getAllSync: () => [radar] };
const at = (dLngM, o = {}) => ({ lat: -23.55, lng: -46.63 + dLngM / 102000, heading: 90, speed: 15, accuracy: 5, ...o });

resetStages();
assert.equal(evaluate(db, at(-900)).length, 0, 'fora do raio');
let m = evaluate(db, at(-550)); assert.equal(m.length, 1, 'aviso longe'); console.log(m[0]);
assert.equal(evaluate(db, at(-500)).length, 0, 'sem repetir');
m = evaluate(db, at(-100)); assert.equal(m.length, 1, 'aviso perto'); console.log(m[0]);
assert.equal(evaluate(db, at(-90)).length, 0);
// sentido oposto, boa precisão => ignora
resetStages(); assert.equal(evaluate(db, at(-500, { heading: 270 })).length, 0, 'sentido oposto');
// precisão ruim => avisa
resetStages(); assert.equal(evaluate(db, at(-500, { heading: 270, accuracy: 30 })).length, 1, 'precisão ruim');
// parado => avisa
resetStages(); assert.equal(evaluate(db, at(-500, { heading: 270, speed: 0 })).length, 1, 'parado');
// sem direção => dois sentidos
const r2 = { ...radar, direction_deg: null, direction_scope: 'UNKNOWN' };
resetStages(); assert.equal(evaluate({ getAllSync: () => [r2] }, at(500, { heading: 270 })).length, 1, 'sem direção avisa nos dois sentidos');
resetStages(); assert.equal(evaluate(db, at(500, { heading: 270 })).length, 0, 'direção 90 vindo do leste ignora');
assert.equal(neighborCells(-23.55, -46.63).length, 9);
console.log('cell', cellOf(-23.55, -46.63), 'OK');

import { simulateApproach } from '../src/detector.js';
const steps = simulateApproach([{ uf: 'XX', getAllSync: (sql) => (sql.includes('LIMIT 1') ? [radar] : [radar]) }]);
const said = steps.flatMap((s) => s.msgs);
assert.equal(said.length, 2, 'simulação: 2 avisos'); console.log('sim', said);

import { simulateApproach as sim2 } from '../src/detector.js';
const below = sim2([], 'below'); // sem base: radar fictício
const above = sim2([], 'above');
const beeps = (st) => st.filter((s) => s.dist <= 200).map((s) => s.beepMs);
assert.ok(beeps(below).length > 0 && beeps(below).every((m) => m === 1000), 'abaixo: compassado');
assert.ok(beeps(above).length > 0 && beeps(above).every((m) => m === 200), 'acima: rápido');
assert.ok(below.filter((s) => s.dist > 200).every((s) => s.beepMs === 0), 'sem beep >200 m');
console.log('beeps below', beeps(below), 'above', beeps(above));

import { analyze as an2, simulateApproach as sim3, normalizeSettings } from '../src/detector.js';
// opções: primeiro aviso desligado, segundo 100 m, beep a 300 m
const st = sim3([], 'below', { beepM: 300, firstM: 0, secondM: 100 });
assert.equal(st.flatMap((x) => x.msgs).length, 1, 'só o segundo aviso');
assert.ok(st.find((x) => x.dist === 300).beepMs === 1000 && st.find((x) => x.dist === 350).beepMs === 0, 'beep a 300 m');
const st2 = sim3([], 'below', { beepM: 50, firstM: 200, secondM: 0 });
assert.equal(st2.flatMap((x) => x.msgs).length, 1, 'só o primeiro aviso');
assert.deepEqual(normalizeSettings({ beepM: 123 }), { beepM: 200, firstM: 600, secondM: 150 });
console.log('opções OK');
