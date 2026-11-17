// Prueba de extremo a extremo en navegador (Chromium) en escritorio y celular.
// Uso: BASE_URL=http://localhost:3000 ADMIN_DATABASE_URL=... node tests/e2e/flujo.mjs
import { createRequire } from 'node:module';
// Playwright puede estar instalado globalmente o como dependencia local.
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import postgres from 'postgres';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const DIR = process.env.CAPTURAS ?? 'tests/e2e/capturas';
mkdirSync(DIR, { recursive: true });
const sql = postgres(process.env.ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
await sql`delete from somexa.intentos`;

const navegador = await chromium.launch();
const perfiles = {
  escritorio: { viewport: { width: 1280, height: 900 } },
  celular: { ...devices['Pixel 7'] },
};

for (const [nombre, opciones] of Object.entries(perfiles)) {
  const ctx = await navegador.newContext({ ...opciones, locale: 'es-MX' });
  const page = await ctx.newPage();
  const erroresConsola = [];
  // Los 404/429 esperados de la API los registra el navegador como error de recurso;
  // se verifican aparte con 'response'.
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && erroresConsola.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/api/consulta') && erroresConsola.push(`${r.status()} ${r.url()}`));
  page.on('pageerror', (e) => erroresConsola.push(e.message));

  const resp = await page.goto(BASE);
  assert.equal(resp.status(), 200);
  assert.ok(resp.headers()['content-security-policy']);
  await page.getByRole('heading', { name: 'Consulta de asistencias y participaciones' }).waitFor();
  await page.screenshot({ path: `${DIR}/${nombre}-1-inicio.png`, fullPage: true });

  // 1) Clave con formato inválido: validación inmediata sin llamar al servidor
  await page.getByLabel('Clave de participante').fill('12345');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await page.getByRole('alert').filter({ hasText: 'formato válido' }).waitFor();

  // 2) Clave inexistente
  await page.getByLabel('Clave de participante').fill('SMX-9999');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await page.getByRole('alert').filter({ hasText: 'No encontramos registros' }).waitFor();
  await page.screenshot({ path: `${DIR}/${nombre}-2-no-encontrada.png`, fullPage: true });

  // 3) Clave válida (en minúsculas) muestra sus datos
  await page.getByLabel('Clave de participante').fill('smx-0001');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await page.getByRole('heading', { name: 'Adlay Reyes Betanzos' }).waitFor();
  await page.getByRole('heading', { name: 'Asistencias (6)' }).waitFor();
  await page.getByRole('heading', { name: 'Participaciones (2)' }).waitFor();
  assert.equal(await page.locator('.indicador.si').count(), 2);
  const texto = await page.locator('main').innerText();
  assert.ok(!texto.includes('@'), 'no debe mostrar correos');
  assert.ok(texto.includes('TEJIENDO COMUNIDAD AGROECOLÓGICA'));
  // Sin desbordamiento horizontal
  const anchoDoc = await page.evaluate(() => document.documentElement.scrollWidth);
  const anchoVista = await page.evaluate(() => window.innerWidth);
  assert.ok(anchoDoc <= anchoVista, `desbordamiento horizontal ${anchoDoc} > ${anchoVista}`);
  await page.screenshot({ path: `${DIR}/${nombre}-3-resultado.png`, fullPage: true });
  // La clave no queda en la URL
  assert.equal(new URL(page.url()).search, '');

  // 4) Persona que solo tiene participación (no cumple asistencia)
  await page.getByRole('button', { name: 'Nueva consulta' }).click();
  assert.equal(await page.getByLabel('Clave de participante').inputValue(), '');
  await page.getByLabel('Clave de participante').fill('SMX-0009');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await page.getByRole('heading', { name: 'AMPARO Albalat Botana' }).waitFor();
  assert.equal(await page.locator('.indicador.no').count(), 1);
  await page.screenshot({ path: `${DIR}/${nombre}-4-solo-participacion.png`, fullPage: true });

  // 5) Captura manual sin hora
  await page.getByRole('button', { name: 'Nueva consulta' }).click();
  await page.getByLabel('Clave de participante').fill('SMX-1804bb3a');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await page.getByText('Captura manual (sin hora de registro)').first().waitFor();

  assert.deepEqual(erroresConsola, [], `errores en consola (${nombre})`);
  console.log(`✔ ${nombre}: flujo completo correcto`);
  await ctx.close();
}

// 6) Límite de intentos visible en la interfaz
await sql`delete from somexa.intentos`;
{
  const ctx = await navegador.newContext({ extraHTTPHeaders: { 'x-real-ip': '198.51.100.9' } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  for (let i = 0; i < 11; i++) {
    await page.getByLabel('Clave de participante').fill(`SMX-97${String(i).padStart(2, '0')}`);
    await page.getByRole('button', { name: 'Consultar' }).click();
    await page.getByRole('alert').waitFor();
    await page.getByRole('button', { name: 'Consultar' }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('form[aria-busy="true"]'));
  }
  await page.getByRole('alert').filter({ hasText: 'demasiados intentos' }).waitFor();
  console.log('✔ límite de intentos mostrado al usuario');
  await ctx.close();
}

await sql`delete from somexa.intentos`;
await sql.end();
await navegador.close();
console.log('E2E: todas las comprobaciones pasaron');
