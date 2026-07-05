// Tests unitaires (node:test) sur la logique pure. Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { isNewer } from '../src/updatecore.js';
import { validName } from '../src/epicapi.js';
import { fmtDuration } from '../src/util.js';
import { parseProxyList, makeProxyDispatchers, closeDispatchers } from '../src/proxy.js';
import { saveEncrypted, loadEncrypted } from '../src/securebox.js';

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
