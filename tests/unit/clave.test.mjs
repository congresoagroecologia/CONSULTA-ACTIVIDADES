import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarClave, claveValida } from '../../lib/clave.ts';

test('normaliza mayúsculas, espacios y guiones tipográficos', () => {
  assert.equal(normalizarClave('  smx-0001 '), 'SMX-0001');
  assert.equal(normalizarClave('SMX–f96ab04d'), 'SMX-F96AB04D');
  assert.equal(normalizarClave('smx 0001'), 'SMX-0001');
  assert.equal(normalizarClave('SMX0001'), 'SMX-0001');
  assert.equal(normalizarClave('smx-p-001'), 'SMX-P-001');
});

test('acepta los formatos de clave del padrón', () => {
  for (const c of ['SMX-0001', 'SMX-F96AB04D', 'SMX-P-001']) assert.ok(claveValida(c), c);
});

test('rechaza formatos inválidos e intentos de inyección', () => {
  for (const c of ['', 'SMX-', 'ABC-0001', "SMX-0001' OR '1'='1", 'SMX-0001;DROP', 'SMX-%', 'SMX-0001_', 'SMX-12345678901234567']) {
    assert.ok(!claveValida(normalizarClave(c)), c);
  }
});
