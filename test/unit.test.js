// Tests unitaires (node:test) sur la logique pure. Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { isNewer } from '../src/updatecore.js';
import { validName } from '../src/epicapi.js';
import { fmtDuration } from '../src/util.js';
import { parseProxyList, makeProxyDispatchers, closeDispatchers, makeProxyPool } from '../src/proxy.js';
import { saveEncrypted, loadEncrypted } from '../src/securebox.js';
import { generateNames, spaceSize, isDictWord } from '../src/generate.js';
import { scoreName, rankNames } from '../src/score.js';

test('isNewer : compare des versions sémantiques', () => {
  assert.equal(isNewer('1.0.1', '1.0.0'), true);
  assert.equal(isNewer('0.2.0', '0.1.9'), true);
  assert.equal(isNewer('1.0.0', '1.0.0'), false);
  assert.equal(isNewer('1.0.0', '1.0.1'), false);
  assert.equal(isNewer('v1.2.0', '1.1.9'), true); // tolère le préfixe v
  assert.equal(isNewer('1.10.0', '1.9.0'), true); // compare numérique, pas lexical
});

test('validName : règles Epic 3-16 caractères', () => {
  assert.equal(validName('abc'), true);
  assert.equal(validName('ab'), false);
  assert.equal(validName('x'.repeat(16)), true);
  assert.equal(validName('x'.repeat(17)), false);
  assert.equal(validName(''), false);
  assert.equal(validName(null), false);
});

test('fmtDuration : format lisible', () => {
  assert.equal(fmtDuration(0), '0s');
  assert.equal(fmtDuration(5000), '5s');
  assert.equal(fmtDuration(65000), '1m 5s');
  assert.equal(fmtDuration(-100), '0s'); // borne à 0
  assert.match(fmtDuration(90_000_000), /^1j/); // > 1 jour
});

test('parseProxyList : nettoie lignes vides et commentaires', () => {
  const txt = '1.2.3.4:8080\n\n# commentaire\n  5.6.7.8:3128  \nuser:pass@9.9.9.9:80';
  assert.deepEqual(parseProxyList(txt), ['1.2.3.4:8080', '5.6.7.8:3128', 'user:pass@9.9.9.9:80']);
});

test('makeProxyDispatchers : construit un dispatcher par proxy valide', async () => {
  const ds = makeProxyDispatchers(['1.2.3.4:8080', 'http://5.6.7.8:3128', '', '# skip']);
  assert.equal(ds.length, 2);
  await closeDispatchers(ds); // ne doit pas jeter
});

test('securebox : round-trip chiffré', () => {
  const file = path.join(os.tmpdir(), `sbtest-${crypto.randomUUID()}.enc`);
  const obj = { a: 1, token: 'secret-xyz', nested: { x: [1, 2, 3] } };
  saveEncrypted(file, obj);
  assert.deepEqual(loadEncrypted(file), obj);
  assert.equal(loadEncrypted(path.join(os.tmpdir(), 'nope-does-not-exist.enc')), null);
});

test('generateNames : longueur, quantité, filtre OG', () => {
  const og = generateNames({ mode: 'random', length: 4, charset: 'alphanum', count: 30, filters: { og: true } });
  assert.ok(og.length > 0 && og.length <= 30);
  assert.ok(og.every((n) => /^[a-z]{4}$/.test(n)), 'OG = 4 lettres exactement, sans chiffre');
  const dict = generateNames({ mode: 'dict', length: 4, count: 5 });
  assert.ok(dict.every((w) => w.length === 4 && isDictWord(w)));
  // Unicité (pas de doublon dans la sortie aléatoire).
  const rnd = generateNames({ mode: 'random', length: 5, count: 100 });
  assert.equal(new Set(rnd).size, rnd.length);
});

test('spaceSize : taille de l\'espace', () => {
  assert.equal(spaceSize(3, 'alpha'), 26 ** 3);
  assert.equal(spaceSize(2, 'alpha'), 26 ** 3); // borné à 3 min
});

test('scoreName : dico > prononçable > chiffres', () => {
  const word = scoreName('fire');   // mot du dico, 4 lettres
  const pron = scoreName('bnfpx');  // pas prononçable
  const digit = scoreName('a1b2');  // chiffres
  assert.ok(word.score > pron.score);
  assert.ok(word.score > digit.score);
  assert.equal(word.tier, 'S');
  const ranked = rankNames(['a1b2c', 'fire', 'zzz']);
  assert.equal(ranked[0].name, 'fire'); // le meilleur en tête
});

test('makeProxyPool : rotation + éjection après échecs', () => {
  const pool = makeProxyPool(['1.1.1.1:80', '2.2.2.2:80', '3.3.3.3:80'], { ejectAfter: 2 });
  assert.equal(pool.size, 3);
  assert.equal(pool.aliveCount(), 3);
  const a = pool.next(); const b = pool.next();
  assert.notEqual(a, b); // rotation
  pool.penalize(a); pool.penalize(a); // 2 échecs -> éjecté
  assert.equal(pool.aliveCount(), 2);
  pool.reward(b); // remet à zéro (pas d'effet néfaste)
  assert.equal(pool.aliveCount(), 2);
});
