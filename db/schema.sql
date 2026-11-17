-- =====================================================================
-- SOMEXA 2026 · Portal de consulta individual
-- Esquema PostgreSQL (compatible con Supabase).
--
-- Modelo de seguridad:
--   * Los datos viven en el esquema privado "somexa", que NO se expone por la
--     API REST de Supabase (solo se expone "public").
--   * RLS activado y sin políticas: los roles anon/authenticated no pueden leer.
--   * La aplicación se conecta con el rol "somexa_consulta", que SOLO puede
--     ejecutar somexa.consultar(clave, ip_hash). No puede hacer SELECT a tablas.
--   * La función aplica el límite de intentos por IP (hash) dentro de la base,
--     por lo que funciona igual aunque Vercel ejecute varias instancias.
--
-- Es seguro ejecutar este archivo más de una vez (idempotente).
-- No contiene contraseñas: la contraseña del rol se asigna aparte
-- (ver README, sección "Rol de consulta").
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS somexa;

-- ---------------------------------------------------------------------
-- Tablas de datos (solo los campos necesarios para la consulta; NO se
-- importan correo ni institución: minimización de datos personales).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS somexa.personas (
  id_persona               text PRIMARY KEY,
  nombre_completo          text    NOT NULL,
  id_categoria             text,
  categoria                text,
  n_asistencias            integer NOT NULL DEFAULT 0 CHECK (n_asistencias >= 0),
  n_participaciones        integer NOT NULL DEFAULT 0 CHECK (n_participaciones >= 0),
  constancia_asistencia    boolean NOT NULL DEFAULT false,
  constancia_participacion boolean NOT NULL DEFAULT false,
  tipo_constancia          text    NOT NULL
);

-- Búsqueda insensible a mayúsculas/minúsculas.
CREATE UNIQUE INDEX IF NOT EXISTS personas_id_upper_idx
  ON somexa.personas (upper(id_persona));

CREATE TABLE IF NOT EXISTS somexa.asistencias (
  id_asistencia       text PRIMARY KEY,
  id_persona          text NOT NULL REFERENCES somexa.personas (id_persona) ON DELETE CASCADE,
  id_sesion           text,
  nombre_sesion       text,
  tipo_sesion         text,
  fecha_sesion        date,
  horario             text,
  fecha_hora_registro timestamp without time zone,
  origen              text
);
CREATE INDEX IF NOT EXISTS asistencias_persona_idx ON somexa.asistencias (id_persona);

CREATE TABLE IF NOT EXISTS somexa.participaciones (
  id_participacion     text PRIMARY KEY,
  id_persona           text NOT NULL REFERENCES somexa.personas (id_persona) ON DELETE CASCADE,
  id_sesion            text,
  nombre_sesion        text,
  fecha_sesion         date,
  modalidad            text,
  titulo_participacion text
);
CREATE INDEX IF NOT EXISTS participaciones_persona_idx ON somexa.participaciones (id_persona);

-- ---------------------------------------------------------------------
-- Registro de intentos para limitar consultas (no guarda la IP en claro,
-- solo un hash con sal secreta calculado por la aplicación; no guarda
-- la clave consultada).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS somexa.intentos (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash   text        NOT NULL,
  exito     boolean     NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intentos_ip_fecha_idx ON somexa.intentos (ip_hash, creado_en);
CREATE INDEX IF NOT EXISTS intentos_fecha_idx    ON somexa.intentos (creado_en);

ALTER TABLE somexa.personas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE somexa.asistencias     ENABLE ROW LEVEL SECURITY;
ALTER TABLE somexa.participaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE somexa.intentos        ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- Función de consulta
--   Devuelve jsonb con "estado":
--     'ok'           -> datos de ESA persona únicamente
--     'no_encontrado'-> la clave no existe en el padrón de constancias
--     'limite'       -> demasiados intentos desde esa IP
--     'invalida'     -> la clave no tiene un formato aceptable
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION somexa.consultar(p_clave text, p_ip_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  -- Límites (ajustables): fallidos por IP en 15 min, totales por IP en 1 h,
  -- y fallidos globales en 10 min (freno a enumeración distribuida).
  c_max_fallidos_ip     constant int := 10;
  c_max_totales_ip      constant int := 40;
  c_max_fallidos_global constant int := 400;
  v_clave    text;
  v_persona  somexa.personas%ROWTYPE;
  v_fallidos int;
  v_totales  int;
  v_global   int;
BEGIN
  IF p_ip_hash IS NULL OR length(p_ip_hash) < 16 OR length(p_ip_hash) > 128 THEN
    RAISE EXCEPTION 'ip_hash inválido';
  END IF;

  v_clave := upper(btrim(coalesce(p_clave, '')));
  IF v_clave !~ '^SMX-[A-Z0-9-]{3,16}$' THEN
    RETURN jsonb_build_object('estado', 'invalida');
  END IF;

  -- Serializa por IP para que intentos simultáneos no rebasen el límite.
  PERFORM pg_advisory_xact_lock(hashtext('somexa:' || p_ip_hash));

  SELECT count(*) FILTER (WHERE NOT exito AND creado_en > now() - interval '15 minutes'),
         count(*)
    INTO v_fallidos, v_totales
    FROM somexa.intentos
   WHERE ip_hash = p_ip_hash
     AND creado_en > now() - interval '1 hour';

  SELECT count(*) INTO v_global
    FROM somexa.intentos
   WHERE NOT exito AND creado_en > now() - interval '10 minutes';

  IF v_fallidos >= c_max_fallidos_ip
     OR v_totales >= c_max_totales_ip
     OR v_global >= c_max_fallidos_global THEN
    RETURN jsonb_build_object('estado', 'limite');
  END IF;

  SELECT * INTO v_persona
    FROM somexa.personas
   WHERE upper(id_persona) = v_clave;

  INSERT INTO somexa.intentos (ip_hash, exito) VALUES (p_ip_hash, FOUND);

  -- Limpieza ocasional de intentos antiguos (~1 de cada 50 llamadas).
  IF random() < 0.02 THEN
    DELETE FROM somexa.intentos WHERE creado_en < now() - interval '2 days';
  END IF;

  IF v_persona.id_persona IS NULL THEN
    RETURN jsonb_build_object('estado', 'no_encontrado');
  END IF;

  RETURN jsonb_build_object(
    'estado', 'ok',
    'persona', jsonb_build_object(
      'clave',                    v_persona.id_persona,
      'nombre',                   v_persona.nombre_completo,
      'categoria',                v_persona.categoria,
      'n_asistencias',            v_persona.n_asistencias,
      'n_participaciones',        v_persona.n_participaciones,
      'constancia_asistencia',    v_persona.constancia_asistencia,
      'constancia_participacion', v_persona.constancia_participacion,
      'tipo_constancia',          v_persona.tipo_constancia
    ),
    'asistencias', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'sesion',   a.nombre_sesion,
               'tipo',     a.tipo_sesion,
               'fecha',    a.fecha_sesion,
               'horario',  a.horario,
               'registro', to_char(a.fecha_hora_registro, 'YYYY-MM-DD"T"HH24:MI:SS'),
               'origen',   a.origen)
             ORDER BY a.fecha_sesion, a.horario, a.id_asistencia)
        FROM somexa.asistencias a
       WHERE a.id_persona = v_persona.id_persona), '[]'::jsonb),
    'participaciones', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'sesion',    p.nombre_sesion,
               'fecha',     p.fecha_sesion,
               'modalidad', p.modalidad,
               'titulo',    p.titulo_participacion)
             ORDER BY p.fecha_sesion, p.id_participacion)
        FROM somexa.participaciones p
       WHERE p.id_persona = v_persona.id_persona), '[]'::jsonb)
  );
END;
$$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'somexa_consulta') THEN
    -- Se crea SIN login; la contraseña y el LOGIN se asignan manualmente
    -- (ver README) para no dejar secretos en el repositorio.
    CREATE ROLE somexa_consulta NOLOGIN;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA somexa FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA somexa FROM PUBLIC;
REVOKE ALL ON FUNCTION somexa.consultar(text, text) FROM PUBLIC;

-- En Supabase existen anon/authenticated; se les retira cualquier acceso.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA somexa FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA somexa FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION somexa.consultar(text, text) FROM %I', r);
    END IF;
  END LOOP;
END
$$;

GRANT USAGE   ON SCHEMA somexa TO somexa_consulta;
GRANT EXECUTE ON FUNCTION somexa.consultar(text, text) TO somexa_consulta;
