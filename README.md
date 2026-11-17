# SOMEXA 2026 · Consulta de asistencias y participaciones

Portal web independiente (no es WordPress) donde cada participante escribe **solo su clave de participante**
(`SMX-…`) y ve el desglose de sus asistencias y participaciones en el congreso.

- **Frontend y API:** Next.js 16 (React 19, TypeScript). Pensado para **Vercel (plan Hobby, gratuito)**.
- **Base de datos:** PostgreSQL. Pensado para **Supabase (plan Free, gratuito)**.
- Interfaz en español, adaptable a celular y computadora, con estados de carga, validación y mensajes de error.

## Cómo protege los datos

| Medida | Detalle |
|---|---|
| Datos privados | Las tablas están en el esquema `somexa`, que la API pública de Supabase no expone. RLS activado y sin políticas; `anon` y `authenticated` no tienen permisos. |
| Mínimo privilegio | La app se conecta con el rol `somexa_consulta`, que **solo** puede ejecutar `somexa.consultar(clave, ip_hash)`. No puede leer tablas aunque se filtrara su contraseña. |
| Sin consulta de datos ajenos | La API recibe únicamente `clave` por `POST`. Ignora cualquier otro parámetro y nunca devuelve registros de otra clave. No hay IDs en la URL. |
| Minimización | **No se importan correo ni institución**. La respuesta solo incluye nombre, categoría, conteos y el detalle de sesiones. |
| Límite de intentos | En la base de datos: 10 consultas fallidas por IP en 15 min, 40 consultas por IP por hora y 400 fallidas en total cada 10 min. Funciona aunque Vercel ejecute varias instancias. Se aplica también a consultas simultáneas. |
| Privacidad del registro | Solo se guarda un hash HMAC de la IP (con sal secreta). No se guardan la IP ni la clave consultada. Los intentos se borran tras 2 días. |
| Mensajes neutros | Una clave inexistente solo responde “No encontramos registros con esa clave”. |
| Encabezados | CSP estricta, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` en la API y `noindex` para buscadores. |

### ⚠️ Limitación importante

Como se pidió, la consulta usa **solo la clave**, sin correo ni código. Quien conozca o adivine una clave
verá el nombre y las sesiones de esa persona. Además, las claves del padrón son **fáciles de adivinar**:

- 170 claves tienen la forma `SMX-0001` … (números consecutivos de 4 dígitos);
- 8 claves tienen la forma `SMX-P-001` …;
- 113 claves tienen la forma `SMX-` + 8 caracteres hexadecimales (difíciles de adivinar).

El límite de intentos frena a una persona que prueba claves desde una sola conexión. **No impide** que alguien
con muchas IPs o con paciencia recorra las claves consecutivas. El freno global (400 fallos/10 min) solo lo hace más lento.
La única forma de eliminar este riesgo sería entregar claves aleatorias largas o agregar una segunda verificación.
Esto se dejó fuera porque así se pidió.

## Estructura

```
app/                 Página (app/page.tsx) y API (app/api/consulta/route.ts)
components/          Formulario y vista de resultados
lib/                 Normalización de clave, tipos, formato de fechas, acceso a BD (lib/servidor)
db/schema.sql        Esquema, función de consulta, límite de intentos y permisos (idempotente)
scripts/importar.mjs Validación e importación de los CSV (idempotente y verificada)
datos/               Aquí van los CSV (ignorados por git: contienen datos personales)
tests/               Pruebas unitarias, de integración (API+BD) y de navegador (Playwright)
```

## Variables de entorno

Ver `.env.example`. **Nunca** subas valores reales al repositorio ni los compartas por chat.

| Variable | Dónde | Para qué |
|---|---|---|
| `DATABASE_URL` | Vercel (y `.env.local`) | Conexión de la app con el rol `somexa_consulta` (pooler de Supabase, puerto 6543). |
| `RATE_LIMIT_SALT` | Vercel (y `.env.local`) | Sal secreta de ≥32 caracteres (`openssl rand -hex 32`). |
| `ADMIN_DATABASE_URL` | Solo en tu computadora | Usuario `postgres`. Solo para importar datos. **No** la pongas en Vercel. |

## Puesta en marcha sin costo (Supabase Free + Vercel Hobby)

> Antes de crear cada recurso, revisa que la pantalla indique **$0 / Free**. No agregues tarjeta ni actives
> planes de pago o complementos (*add-ons*, *compute upgrades*, dominios de pago, etc.).

### 1. Supabase (base de datos)

1. Entra a <https://supabase.com>, crea una cuenta y una organización con el plan **Free**.
2. Crea un proyecto (*New project*) con plan Free y una región cercana (por ejemplo, `East US`).
   Guarda la contraseña de la base en un gestor de contraseñas.
3. Abre **SQL Editor**, pega el contenido completo de `db/schema.sql` y ejecútalo (*Run*).
4. En tu computadora, genera una contraseña para el rol de la app con `openssl rand -hex 24`.
   Luego ejecuta en el **SQL Editor** (sustituye el texto entre `< >`; no la guardes en ningún archivo del repo):
   ```sql
   ALTER ROLE somexa_consulta WITH LOGIN PASSWORD '<contraseña generada>';
   ```
5. En **Connect** (botón superior) copia la cadena del **Transaction pooler** (puerto 6543). Tendrá esta forma:
   `postgres://postgres.<REF>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:6543/postgres`.
   - Para `DATABASE_URL`: cambia el usuario `postgres.<REF>` por `somexa_consulta.<REF>`.
     Pon la contraseña del paso 4 y agrega `?sslmode=require` al final.
   - Para `ADMIN_DATABASE_URL`: usa la cadena del **Session pooler** (puerto 5432) con el usuario `postgres.<REF>`,
     la contraseña de la base y `?sslmode=require`.

### 2. Importar los datos (desde tu computadora)

Requisitos: Node.js 20 o posterior.

```bash
npm install
```

Copia `personas.csv`, `asistencias.csv` y `participaciones.csv` a la carpeta `datos/`. Luego valida:

```bash
npm run validar
```

El informe muestra cuántos registros se cargarán, los avisos y los errores. Si hay errores, no se importa nada.

```bash
ADMIN_DATABASE_URL='<cadena admin>' npm run importar
```

La importación ocurre en una sola transacción y es idempotente: si la repites, no duplica registros.
Al final compara **campo por campo** la base contra los CSV y comprueba que `N_asistencias` y `N_participaciones`
coincidan con los registros. Si algo no coincide, revierte todo. Si quitaste filas de los CSV y quieres borrarlas
también de la base, usa `npm run importar -- --eliminar-sobrantes`.

### 3. Vercel (aplicación)

1. Entra a <https://vercel.com> y crea una cuenta **Hobby** (gratuita) con tu GitHub.
2. *Add New → Project* e importa este repositorio. Vercel detecta Next.js automáticamente.
3. En *Environment Variables* agrega `DATABASE_URL` y `RATE_LIMIT_SALT` (entorno **Production**).
4. *Deploy*. Abre la URL `https://<proyecto>.vercel.app` y prueba una clave.

### Consideraciones del plan gratuito

- **Supabase Free** pausa el proyecto tras ~7 días sin actividad. Si eso pasa, el portal mostrará
  “El servicio no está disponible” hasta que lo reactives (*Restore project*, sin costo) en el panel de Supabase.
- **Vercel Hobby** es gratuito, pero sus términos lo limitan a uso **no comercial**. Un portal informativo sin cobro
  suele encajar ahí. Confirma que se ajusta a tu institución. Si Vercel avisa que excedes un límite, el sitio se
  detiene; no se cobra automáticamente.

## Desarrollo local

```bash
cp .env.example .env.local   # y llena los valores (puede ser un PostgreSQL local)
psql "$ADMIN_DATABASE_URL" -f db/schema.sql
npm run importar
npm run dev
```

Con un PostgreSQL propio (no Supabase), crea primero un usuario administrador con permiso `CREATEROLE`.

## Pruebas

```bash
npm test                                                     # unitarias (normalización de clave)
BASE_URL=http://localhost:3000 npm run test:integracion      # API + BD (requiere ADMIN_DATABASE_URL y la app en marcha)
BASE_URL=http://localhost:3000 npm run test:e2e              # navegador, escritorio y celular (Playwright)
```

Las pruebas de integración recorren las 291 claves y comparan cada respuesta con la base de datos.
También comprueban el rechazo de claves inexistentes o mal formadas, la manipulación de parámetros, otros orígenes
y el límite de intentos (incluidas peticiones simultáneas). Simulan IPs distintas con el encabezado `x-real-ip`.
En Vercel ese encabezado lo fija la plataforma.

## Mantenimiento

- **Ajustar límites:** edita las constantes `c_max_*` en `db/schema.sql` y vuelve a ejecutarlo (es idempotente).
- **Desbloquear a alguien de inmediato:** `DELETE FROM somexa.intentos;` en el SQL Editor.
- **Retirar el portal:** borra el proyecto en Vercel. Para eliminar los datos, ejecuta `DROP SCHEMA somexa CASCADE;` en Supabase.

## Observaciones sobre los datos fuente (validación)

- 291 personas, 1,620 asistencias y 205 participaciones. No hay IDs duplicados ni registros huérfanos.
  Los conteos por persona y las banderas de constancia son consistentes (194 de asistencia, 161 de participación, 64 ambas).
- Archivos en UTF-8 con BOM, tratado correctamente.
- 98 asistencias “Derivada de participación” no tienen hora de registro. 8 son “Captura manual 00:00” y se muestran como *sin hora*.
- 78 asistencias no tienen tipo de sesión.
- 17 asistencias tienen fecha de escaneo distinta a la fecha de la sesión. Se conservan tal cual.
- PAR-0192/PAR-0193 (SMX-0243) y PAR-0194/PAR-0195 (SMX-0244) son filas idénticas: posible duplicado en el origen.
  Se conservan porque los conteos oficiales las incluyen.
- `somexa2026_constancias.sql` (MySQL/WordPress) se usó solo como referencia. Contiene los mismos totales (291/1,620/205).
  Este proyecto no lo ejecuta.
