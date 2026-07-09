import test from 'node:test';
import assert from 'node:assert/strict';
import { nasUrlCandidates } from './nas-url.mjs';

test('uses NAS_URL first and NAS_FALLBACK_URL second', () => {
  const env = {
    NAS_URL: 'https://seilcorp.synology.me:5001',
    NAS_FALLBACK_URL: 'http://172.30.1.29:5000',
  };

  assert.deepEqual(nasUrlCandidates(env), [
    'https://seilcorp.synology.me:5001',
    'http://172.30.1.29:5000',
  ]);
});

test('falls back to the company LAN NAS address when no fallback is configured', () => {
  const env = { NAS_URL: 'https://seilcorp.synology.me:5001' };

  assert.deepEqual(nasUrlCandidates(env), [
    'https://seilcorp.synology.me:5001',
    'http://172.30.1.29:5000',
  ]);
});

test('removes duplicate NAS URLs while preserving order', () => {
  const env = {
    NAS_URL: 'http://172.30.1.29:5000',
    NAS_FALLBACK_URL: 'http://172.30.1.29:5000',
  };

  assert.deepEqual(nasUrlCandidates(env), ['http://172.30.1.29:5000']);
});
