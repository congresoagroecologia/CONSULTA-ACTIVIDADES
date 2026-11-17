// Pruebas de integración contra la app en ejecución y la base de datos.
// Requiere: BASE_URL (p. ej. http://localhost:3000) y ADMIN_DATABASE_URL.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const sql = postgres(process.env.ADMIN_DATABASE_URL, { max: 2, onnotice: () => {} });
let ipN = 0;
const nuevaIp = () => `10.0.${Math.floor(++ipN / 250)}.${ipN % 250}`;

async function consultar(cuerpo, { ip = nuevaIp(), headers = {}, method = 'POST', crudo } = {}) {
  const r = await fetch(`${BASE}/api/consulta`, {
    method,
    headers: { 'content-type': 'application/json', 'x-real-ip': ip, ...headers },
    body: method === 'POST' ? (crudo ?? JSON.stringify(cuerpo)) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json, headers: r.headers };
}

async function esperado(id) {
  const [p] = await sql`select * from somexa.personas where id_persona = ${id}`;
  const a = await sql`select nombre_sesion as sesion, tipo_sesion as tipo, to_char(fecha_sesion,'YYYY-MM-DD') as fecha, horario,
                             to_char(fecha_hora_registro,'YYYY-MM-DD"T"HH24:MI:SS') as registro, origen
                        from somexa.asistencias where id_persona = ${id} order by fecha_sesion, horario, id_asistencia`;
  const r = await sql`select nombre_sesion as sesion, to_char(fecha_sesion,'YYYY-MM-DD') as fecha, modalidad, titulo_participacion as titulo
                        from somexa.participaciones where id_persona = ${id} order by fecha_sesion, id_participacion`;
  return {
    persona: {
      clave: p.id_persona, nombre: p.nombre_completo, categoria: p.categoria,
      n_asistencias: p.n_asistencias, n_participaciones: p.n_participaciones,
      constancia_asistencia: p.constancia_asistencia, constancia_participacion: p.constancia_participacion,
      tipo_constancia: p.tipo_constancia,
    },
    asistencias: a.map((x) => ({ ...x })),
    participaciones: r.map((x) => ({ ...x })),
  };
}

const ordenar = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v)));

before(async () => { await sql`delete from somexa.intentos`; });
beforeEach(async () => { await sql`delete from somexa.intentos`; });
after(async () => { await sql`delete from somexa.intentos`; await sql.end(); });

test('clave válida devuelve exactamente los registros de esa persona', async () => {
  const r = await consultar({ clave: 'SMX-0001' });
  assert.equal(r.status, 200);
  assert.deepEqual(ordenar(r.json), ordenar(await esperado('SMX-0001')));
  assert.equal(r.json.asistencias.length, 6);
  assert.equal(r.json.participaciones.length, 2);
  assert.match(r.headers.get('cache-control'), /no-store/);
});

test('acepta minúsculas, espacios y clave con formato hexadecimal', async () => {
  const r = await consultar({ clave: '  smx-f96ab04d ' });
  assert.equal(r.status, 200);
  assert.equal(r.json.persona.clave, 'SMX-f96ab04d');
  const r2 = await consultar({ clave: 'smx-p-001' });
  assert.equal(r2.status, 200);
  assert.equal(r2.json.persona.clave, 'SMX-P-001');
});

test('la respuesta no incluye correo, institución ni identificadores internos', async () => {
  const r = await consultar({ clave: 'SMX-0009' });
  assert.equal(r.status, 200);
  const texto = JSON.stringify(r.json);
  assert.ok(!/@/.test(texto), 'no debe contener correos');
  assert.deepEqual(Object.keys(r.json).sort(), ['asistencias', 'participaciones', 'persona']);
  assert.deepEqual(Object.keys(r.json.persona).sort(), ['categoria', 'clave', 'constancia_asistencia', 'constancia_participacion', 'n_asistencias', 'n_participaciones', 'nombre', 'tipo_constancia']);
  for (const k of ['Correo', 'correo', 'institucion', 'Institucion', 'perfil_evento', 'id_persona']) assert.ok(!texto.includes(`"${k}"`), k);
});

test('clave inexistente se rechaza sin revelar información', async () => {
  const r = await consultar({ clave: 'SMX-9999' });
  assert.equal(r.status, 404);
  assert.deepEqual(r.json, { error: 'no_encontrado' });
});

test('formato inválido e intento de inyección SQL se rechazan', async () => {
  for (const clave of ['hola', "SMX-0001' OR '1'='1", 'SMX-%', '']) {
    const r = await consultar({ clave });
    assert.equal(r.status, 400, clave);
    assert.deepEqual(r.json, { error: 'formato' });
  }
});

test('manipular parámetros no permite ver datos ajenos', async () => {
  // Parámetros extra son ignorados: solo cuenta "clave".
  const r = await consultar({ clave: 'SMX-0001', id_persona: 'SMX-0002', persona: 'SMX-0003' });
  assert.equal(r.status, 200);
  assert.equal(r.json.persona.clave, 'SMX-0001');
  // Tipos no esperados
  assert.equal((await consultar({ clave: ['SMX-0001', 'SMX-0002'] })).status, 400);
  assert.equal((await consultar({ clave: { $ne: '' } })).status, 400);
  assert.equal((await consultar(null, { crudo: 'clave=SMX-0001' })).status, 400);
  // Parámetros por URL o GET no sirven
  const g = await fetch(`${BASE}/api/consulta?clave=SMX-0001`);
  assert.equal(g.status, 405);
  assert.ok(!(await g.text()).includes('Adlay'));
});

test('solicitudes de otro origen, otro content-type o cuerpo enorme se rechazan', async () => {
  assert.equal((await consultar({ clave: 'SMX-0001' }, { headers: { origin: 'https://atacante.example' } })).status, 403);
  assert.equal((await consultar(null, { headers: { 'content-type': 'text/plain' }, crudo: '{"clave":"SMX-0001"}' })).status, 415);
  assert.equal((await consultar(null, { crudo: JSON.stringify({ clave: 'SMX-0001', x: 'a'.repeat(2000) }) })).status, 413);
});

test('límite de intentos: tras 10 fallos en 15 min la IP queda bloqueada', async () => {
  const ip = '192.0.2.77';
  for (let i = 0; i < 10; i++) {
    const r = await consultar({ clave: `SMX-99${String(i).padStart(2, '0')}` }, { ip });
    assert.equal(r.status, 404);
  }
  const bloqueada = await consultar({ clave: 'SMX-0001' }, { ip });
  assert.equal(bloqueada.status, 429);
  assert.deepEqual(bloqueada.json, { error: 'limite' });
  assert.equal(bloqueada.headers.get('retry-after'), '900');
  // Otra IP no se ve afectada
  assert.equal((await consultar({ clave: 'SMX-0001' }, { ip: '192.0.2.78' })).status, 200);
  // La base no guarda la IP en claro
  const filas = await sql`select ip_hash from somexa.intentos`;
  assert.ok(filas.every((f) => /^[0-9a-f]{64}$/.test(f.ip_hash) && !f.ip_hash.includes('192.0.2')));
});

test('consultas concurrentes desde una IP no rebasan el límite', async () => {
  const ip = '192.0.2.90';
  const rs = await Promise.all(Array.from({ length: 25 }, (_, i) => consultar({ clave: `SMX-98${String(i).padStart(2, '0')}` }, { ip })));
  assert.equal(rs.filter((r) => r.status === 404).length, 10);
  assert.equal(rs.filter((r) => r.status === 429).length, 15);
});

test('barrido completo: cada una de las 291 claves devuelve solo sus propios datos', async () => {
  const ids = (await sql`select id_persona from somexa.personas order by id_persona`).map((r) => r.id_persona);
  assert.equal(ids.length, 291);
  const otrosNombres = new Map((await sql`select id_persona, nombre_completo from somexa.personas`).map((r) => [r.id_persona, r.nombre_completo]));
  let totA = 0, totR = 0;
  for (const id of ids) {
    const r = await consultar({ clave: id });
    assert.equal(r.status, 200, id);
    assert.deepEqual(ordenar(r.json), ordenar(await esperado(id)), id);
    totA += r.json.asistencias.length;
    totR += r.json.participaciones.length;
    if (ids.indexOf(id) % 25 === 0) await sql`delete from somexa.intentos`;
  }
  assert.equal(totA, 1620);
  assert.equal(totR, 205);
  void otrosNombres;
});
