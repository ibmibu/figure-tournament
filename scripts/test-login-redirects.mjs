import test from 'node:test';
import assert from 'node:assert/strict';
import { safeLoginNext } from '../lib/safe-login-next.js';

const origin = 'https://figure-tournament.vercel.app';

test('legitimate same-origin OAuth return targets retain their query', () => {
  assert.equal(safeLoginNext('/tournaments/new?edit=t-1', origin), '/tournaments/new?edit=t-1');
  assert.equal(safeLoginNext('/mypage/colors', origin), '/mypage/colors');
  assert.equal(safeLoginNext('/tournaments/t-4#bracket', origin), '/tournaments/t-4#bracket');
  assert.equal(safeLoginNext('/', origin), '/');
});

test('external navigation, JS schemes, control chars and encoded separators are rejected', () => {
  for (const input of [
    null, '', '//evil.example/', '/\\evil.example/', 'https://evil.example/',
    'javascript:alert(1)', 'data:text/html,hello',
    '/%2Fevil.example', '/%5cevil.example', '/%255cevil.example', '/%252fevil.example',
    '/foo\n//evil.example', '/foo\rbar', ' /mypage',
    'x'.repeat(2049),
  ]) {
    assert.equal(safeLoginNext(input, origin), '/', String(input));
  }
});

test('normalizes dot segments and refuses invalid origins', () => {
  assert.equal(safeLoginNext('/tournaments/../mypage', origin), '/mypage');
  assert.equal(safeLoginNext('/mypage', 'not-a-url'), '/');
});
