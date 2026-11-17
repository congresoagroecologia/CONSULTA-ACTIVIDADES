#!/usr/bin/env node
// Valida e importa los CSV de SOMEXA 2026 a PostgreSQL/Supabase.
//
// Uso:
//   node scripts/importar.mjs --solo-validar            (no toca la base)
//   ADMIN_DATABASE_URL=... node scripts/importar.mjs    (valida, importa y verifica)
//
// Opciones:
//   --dir <carpeta>        Carpeta con personas.csv, asistencias.csv y participaciones.csv (por defecto ./datos)
//   --solo-validar         Solo valida y muestra el informe.
//   --eliminar-sobrantes   Borra de la base registros que ya no estén en los CSV.
//
// La importación es idempotente: usa INSERT ... ON CONFLICT (id) DO UPDATE,
// por lo que ejecutarla varias veces no duplica registros.
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import postgres from 'postgres';
import { leerCsv } from './csv.mjs';

const args = process.argv.slice(2);
const opt = (n) => args.includes(n);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DIR = resolve(val('--dir', 'datos'));
const SOLO_VALIDAR = opt('--solo-validar');
const ELIMINAR_SOBRANTES = opt('--eliminar-sobrantes');

const ENC = {
  personas: ['ID_Persona', 'Nombre_completo', 'Correo', 'Institucion', 'ID_Categoria', 'Categoria', 'Perfil_evento', 'N_asistencias', 'N_participaciones', 'Constancia_asistencia', 'Constancia_participacion', 'Tipo_constancia'],
  asistencias: ['ID_Asistencia', 'ID_Persona', 'Nombre', 'ID_Categoria', 'ID_Sesion', 'Nombre_sesion', 'Tipo_sesion', 'Fecha_sesion', 'Horario', 'Fecha_hora_registro', 'Origen'],
  participaciones: ['ID_Participacion', 'ID_Persona', 'Nombre', 'ID_Categoria', 'ID_Sesion', 'Nombre_sesion', 'Fecha_sesion', 'Modalidad', 'Titulo_participacion'],
};
const MIN_ASISTENCIAS = 5;
const RE_CLAVE = /^SMX-[A-Z0-9-]{3,16}$/;

const errores = [];
const avisos = [];
const err = (m) => errores.push(m);
const aviso = (m) => avisos.push(m);

function cargar(nombre) {
  const ruta = join(DIR, `${nombre}.csv`);
  if (!existsSync(ruta)) { err(`No existe ${ruta}`); return []; }
  const { encabezados, registros, problemas } = leerCsv(ruta);
  problemas.forEach((p) => err(`${nombre}.csv ${p}`));
  const esperados = ENC[nombre];
  if (encabezados.join('|') !== esperados.join('|')) {
    err(`${nombre}.csv: encabezados inesperados.\n  Recibidos: ${encabezados.join(', ')}\n  Esperados: ${esperados.join(', ')}`);
  }
  return registros;
}

const nulo = (s) => (s == null || s.trim() === '' ? null : s.trim());
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const esFechaHora = (s) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) && esFecha(s.slice(0, 10));
const siNo = (s) => (s === 'SÍ' || s === 'SI' ? true : s === 'NO' ? false : undefined);

// ---------------------------------------------------------------- lectura
const P = cargar('personas');
const A = cargar('asistencias');
const R = cargar('participaciones');

// ---------------------------------------------------------------- validación
const personas = new Map();
const clavesMayus = new Map();
for (const p of P) {
  const f = `personas.csv fila ${p.__fila}`;
  const id = p.ID_Persona;
  if (!id || id !== id.trim()) err(`${f}: ID_Persona vacío o con espacios`);
  if (personas.has(id)) { err(`${f}: ID_Persona duplicado ${id}`); continue; }
  if (!RE_CLAVE.test(id.toUpperCase())) err(`${f}: ID_Persona con formato no reconocido "${id}"`);
  const up = id.toUpperCase();
  if (clavesMayus.has(up)) err(`${f}: ID_Persona ${id} coincide (sin distinguir mayúsculas) con ${clavesMayus.get(up)}`);
  clavesMayus.set(up, id);
  if (!nulo(p.Nombre_completo)) err(`${f}: Nombre_completo vacío`);
  if (!nulo(p.Tipo_constancia)) err(`${f}: Tipo_constancia vacío`);
  const na = Number(p.N_asistencias), np = Number(p.N_participaciones);
  if (!Number.isInteger(na) || na < 0) err(`${f}: N_asistencias no es entero ≥ 0`);
  if (!Number.isInteger(np) || np < 0) err(`${f}: N_participaciones no es entero ≥ 0`);
  const ca = siNo(p.Constancia_asistencia), cp = siNo(p.Constancia_participacion);
  if (ca === undefined) err(`${f}: Constancia_asistencia debe ser SÍ/NO`);
  if (cp === undefined) err(`${f}: Constancia_participacion debe ser SÍ/NO`);
  if (ca !== undefined && ca !== na >= MIN_ASISTENCIAS) aviso(`${id}: Constancia_asistencia=${p.Constancia_asistencia} pero N_asistencias=${na}`);
  if (cp !== undefined && cp !== np >= 1) aviso(`${id}: Constancia_participacion=${p.Constancia_participacion} pero N_participaciones=${np}`);
  const tipoEsperado = ca && cp ? 'Asistencia + Participación' : ca ? 'Asistencia' : cp ? 'Participación' : null;
  if (tipoEsperado && p.Tipo_constancia !== tipoEsperado) aviso(`${id}: Tipo_constancia "${p.Tipo_constancia}" no coincide con las banderas (${tipoEsperado})`);
  if (!ca && !cp) aviso(`${id}: no cumple ningún criterio de constancia`);
  personas.set(id, p);
}

function validarDetalle(nombre, filas, idCampo, conFechaHora) {
  const ids = new Set();
  const porPersonaSesion = new Map();
  const conteo = new Map();
  for (const r of filas) {
    const f = `${nombre}.csv fila ${r.__fila}`;
    const id = r[idCampo];
    if (!nulo(id)) { err(`${f}: ${idCampo} vacío`); continue; }
    if (ids.has(id)) err(`${f}: ${idCampo} duplicado ${id}`);
    ids.add(id);
    const p = personas.get(r.ID_Persona);
    if (!p) { err(`${f}: ID_Persona ${r.ID_Persona} no existe en personas.csv`); continue; }
    conteo.set(r.ID_Persona, (conteo.get(r.ID_Persona) ?? 0) + 1);
    if (r.Nombre !== p.Nombre_completo) aviso(`${f}: Nombre "${r.Nombre}" difiere del padrón "${p.Nombre_completo}"`);
    if (r.ID_Categoria !== p.ID_Categoria) aviso(`${f}: ID_Categoria ${r.ID_Categoria} difiere del padrón ${p.ID_Categoria}`);
    if (!nulo(r.Nombre_sesion)) aviso(`${f}: Nombre_sesion vacío`);
    if (!esFecha(r.Fecha_sesion)) err(`${f}: Fecha_sesion inválida "${r.Fecha_sesion}"`);
    if (conFechaHora && nulo(r.Fecha_hora_registro)) {
      if (!esFechaHora(r.Fecha_hora_registro)) err(`${f}: Fecha_hora_registro inválida "${r.Fecha_hora_registro}"`);
      else if (r.Fecha_hora_registro.slice(0, 10) !== r.Fecha_sesion) aviso(`${f} (${id}): registro ${r.Fecha_hora_registro} en fecha distinta a la sesión ${r.Fecha_sesion} (se conserva tal cual)`);
    }
    const k = `${r.ID_Persona}|${r.ID_Sesion}`;
    if (porPersonaSesion.has(k)) {
      const otro = porPersonaSesion.get(k);
      const igual = Object.keys(r).filter((c) => c !== idCampo && c !== '__fila').every((c) => r[c] === otro[c]);
      aviso(`${nombre}: ${otro[idCampo]} y ${id} son de la misma persona (${r.ID_Persona}) y sesión (${r.ID_Sesion})${igual ? ' y tienen contenido idéntico (posible duplicado en origen; se conserva)' : ''}`);
    } else porPersonaSesion.set(k, r);
  }
  return conteo;
}

const conteoA = validarDetalle('asistencias', A, 'ID_Asistencia', true);
const conteoR = validarDetalle('participaciones', R, 'ID_Participacion', false);

for (const [id, p] of personas) {
  if (Number(p.N_asistencias) !== (conteoA.get(id) ?? 0)) err(`${id}: N_asistencias=${p.N_asistencias} pero hay ${conteoA.get(id) ?? 0} filas en asistencias.csv`);
  if (Number(p.N_participaciones) !== (conteoR.get(id) ?? 0)) err(`${id}: N_participaciones=${p.N_participaciones} pero hay ${conteoR.get(id) ?? 0} filas en participaciones.csv`);
}

// Resumen
const cuenta = (fn) => [...personas.values()].filter(fn).length;
const resumen = {
  personas: personas.size,
  asistencias: A.length,
  participaciones: R.length,
  con_constancia_asistencia: cuenta((p) => siNo(p.Constancia_asistencia)),
  con_constancia_participacion: cuenta((p) => siNo(p.Constancia_participacion)),
  ambas: cuenta((p) => siNo(p.Constancia_asistencia) && siNo(p.Constancia_participacion)),
  formatos_de_clave: [...personas.keys()].reduce((m, k) => { const f = k.replace(/[0-9]/g, '9').replace(/(?<=SMX-)[0-9a-f]{8}$/, 'hhhhhhhh'); m[f] = (m[f] ?? 0) + 1; return m; }, {}),
  asistencias_sin_hora_de_registro: A.filter((a) => !nulo(a.Fecha_hora_registro)).length,
  asistencias_por_origen: A.reduce((m, a) => { m[a.Origen] = (m[a.Origen] ?? 0) + 1; return m; }, {}),
  asistencias_sin_tipo_de_sesion: A.filter((a) => !nulo(a.Tipo_sesion)).length,
};

console.log('\n=== Informe de validación ===');
console.log(`Carpeta: ${DIR}`);
console.log(JSON.stringify(resumen, null, 2));
console.log(`\nAvisos (${avisos.length}) — no impiden importar:`);
avisos.forEach((a) => console.log('  - ' + a));
console.log(`\nErrores (${errores.length}):`);
errores.forEach((e) => console.log('  - ' + e));

if (errores.length) {
  console.error('\nSe encontraron errores. No se importó nada.');
  process.exit(1);
}
if (SOLO_VALIDAR) {
  console.log(`\nValidación correcta. Se cargarían ${resumen.personas} personas, ${resumen.asistencias} asistencias y ${resumen.participaciones} participaciones.`);
  process.exit(0);
}

// ---------------------------------------------------------------- importación
const url = process.env.ADMIN_DATABASE_URL;
if (!url) {
  console.error('\nFalta la variable ADMIN_DATABASE_URL (conexión con rol administrador). Ver README.');
  process.exit(1);
}
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });

const filasP = P.map((p) => ({
  id_persona: p.ID_Persona,
  nombre_completo: p.Nombre_completo.trim(),
  id_categoria: nulo(p.ID_Categoria),
  categoria: nulo(p.Categoria),
  n_asistencias: Number(p.N_asistencias),
  n_participaciones: Number(p.N_participaciones),
  constancia_asistencia: siNo(p.Constancia_asistencia),
  constancia_participacion: siNo(p.Constancia_participacion),
  tipo_constancia: p.Tipo_constancia.trim(),
}));
const filasA = A.map((a) => ({
  id_asistencia: a.ID_Asistencia,
  id_persona: a.ID_Persona,
  id_sesion: nulo(a.ID_Sesion),
  nombre_sesion: nulo(a.Nombre_sesion),
  tipo_sesion: nulo(a.Tipo_sesion),
  fecha_sesion: a.Fecha_sesion,
  horario: nulo(a.Horario),
  fecha_hora_registro: nulo(a.Fecha_hora_registro),
  origen: nulo(a.Origen),
}));
const filasR = R.map((r) => ({
  id_participacion: r.ID_Participacion,
  id_persona: r.ID_Persona,
  id_sesion: nulo(r.ID_Sesion),
  nombre_sesion: nulo(r.Nombre_sesion),
  fecha_sesion: r.Fecha_sesion,
  modalidad: nulo(r.Modalidad),
  titulo_participacion: nulo(r.Titulo_participacion),
}));

async function upsert(tx, tabla, pk, filas) {
  const cols = Object.keys(filas[0]);
  const set = cols.filter((c) => c !== pk).map((c) => `${c} = excluded.${c}`).join(', ');
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500);
    await tx`insert into ${tx('somexa.' + tabla)} ${tx(lote, cols)}
             on conflict (${tx(pk)}) do update set ${tx.unsafe(set)}`;
  }
}

async function sobrantes(tx, tabla, pk, ids) {
  const enBase = await tx`select ${tx(pk)} as id from ${tx('somexa.' + tabla)}`;
  return enBase.map((r) => r.id).filter((id) => !ids.has(id));
}

try {
  await sql.begin(async (tx) => {
    await upsert(tx, 'personas', 'id_persona', filasP);
    await upsert(tx, 'asistencias', 'id_asistencia', filasA);
    await upsert(tx, 'participaciones', 'id_participacion', filasR);

    const sob = {
      participaciones: await sobrantes(tx, 'participaciones', 'id_participacion', new Set(filasR.map((r) => r.id_participacion))),
      asistencias: await sobrantes(tx, 'asistencias', 'id_asistencia', new Set(filasA.map((r) => r.id_asistencia))),
      personas: await sobrantes(tx, 'personas', 'id_persona', new Set(filasP.map((r) => r.id_persona))),
    };
    const totalSob = Object.values(sob).reduce((n, l) => n + l.length, 0);
    if (totalSob) {
      if (!ELIMINAR_SOBRANTES) {
        throw new Error(`La base contiene ${totalSob} registros que no están en los CSV (${JSON.stringify(Object.fromEntries(Object.entries(sob).map(([k, v]) => [k, v.length])))}). Usa --eliminar-sobrantes si deben borrarse.`);
      }
      await tx`delete from somexa.participaciones where id_participacion in ${tx(sob.participaciones.length ? sob.participaciones : [''])}`;
      await tx`delete from somexa.asistencias where id_asistencia in ${tx(sob.asistencias.length ? sob.asistencias : [''])}`;
      await tx`delete from somexa.personas where id_persona in ${tx(sob.personas.length ? sob.personas : [''])}`;
      console.log(`Se eliminaron ${totalSob} registros sobrantes.`);
    }

    // ------------------------------------------------ verificación completa
    const canon = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k] instanceof Date ? o[k].toISOString() : o[k]]));
    const comparar = async (tabla, pk, filas, consulta) => {
      const enBase = await consulta;
      if (enBase.length !== filas.length) throw new Error(`${tabla}: la base tiene ${enBase.length} filas y el CSV ${filas.length}`);
      const mapa = new Map(enBase.map((r) => [r[pk], canon(r)]));
      for (const f of filas) {
        if (mapa.get(f[pk]) !== canon(f)) throw new Error(`${tabla}: el registro ${f[pk]} no coincide con el CSV`);
      }
      console.log(`  ✔ ${tabla}: ${enBase.length} filas, contenido idéntico al CSV`);
    };
    console.log('\n=== Verificación posterior a la importación ===');
    await comparar('personas', 'id_persona', filasP, tx`select * from somexa.personas`);
    await comparar('asistencias', 'id_asistencia', filasA, tx`
      select id_asistencia, id_persona, id_sesion, nombre_sesion, tipo_sesion,
             to_char(fecha_sesion, 'YYYY-MM-DD') as fecha_sesion, horario,
             to_char(fecha_hora_registro, 'YYYY-MM-DD HH24:MI:SS') as fecha_hora_registro, origen
        from somexa.asistencias`);
    await comparar('participaciones', 'id_participacion', filasR, tx`
      select id_participacion, id_persona, id_sesion, nombre_sesion,
             to_char(fecha_sesion, 'YYYY-MM-DD') as fecha_sesion, modalidad, titulo_participacion
        from somexa.participaciones`);
    const [desc] = await tx`
      select count(*)::int as n from somexa.personas p
       where p.n_asistencias <> (select count(*) from somexa.asistencias a where a.id_persona = p.id_persona)
          or p.n_participaciones <> (select count(*) from somexa.participaciones r where r.id_persona = p.id_persona)`;
    if (desc.n) throw new Error(`${desc.n} personas con conteos que no coinciden con sus registros`);
    console.log('  ✔ N_asistencias y N_participaciones coinciden con los registros de cada persona');
  });
  console.log(`\nImportación completada: ${filasP.length} personas, ${filasA.length} asistencias, ${filasR.length} participaciones.`);
} catch (e) {
  console.error('\nError: ' + e.message + '\nLa transacción se revirtió; la base quedó sin cambios.');
  process.exitCode = 1;
} finally {
  await sql.end();
}
