'use client';

import { useRef, useState, useEffect, type FormEvent } from 'react';
import { normalizarClave, claveValida } from '@/lib/clave';
import { MIN_ASISTENCIAS, type CodigoError, type ResultadoConsulta } from '@/lib/tipos';
import { agruparPorFecha, descripcionRegistro, fechaLarga, plural } from '@/lib/formato';

type Estado =
  | { tipo: 'inicial' }
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'resultado'; datos: ResultadoConsulta };

const MENSAJES: Record<CodigoError, string> = {
  formato: 'La clave no tiene un formato válido. Debe comenzar con “SMX-”, por ejemplo SMX-0000.',
  no_encontrado:
    'No encontramos registros con esa clave. Revisa que esté bien escrita. Si es correcta y crees que es un error, comunícate con el comité organizador.',
  limite: 'Se hicieron demasiados intentos desde tu conexión. Espera 15 minutos e inténtalo de nuevo.',
  servicio: 'El servicio no está disponible en este momento. Inténtalo de nuevo en unos minutos.',
  solicitud: 'No pudimos procesar la solicitud. Recarga la página e inténtalo de nuevo.',
};

export default function Consulta() {
  const [clave, setClave] = useState('');
  const [estado, setEstado] = useState<Estado>({ tipo: 'inicial' });
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const entradaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (estado.tipo === 'resultado') tituloRef.current?.focus();
  }, [estado]);

  async function consultar(e: FormEvent) {
    e.preventDefault();
    if (estado.tipo === 'cargando') return;
    const normal = normalizarClave(clave);
    if (!normal) {
      setEstado({ tipo: 'error', mensaje: 'Escribe tu clave de participante.' });
      entradaRef.current?.focus();
      return;
    }
    if (!claveValida(normal)) {
      setEstado({ tipo: 'error', mensaje: MENSAJES.formato });
      entradaRef.current?.focus();
      return;
    }
    setEstado({ tipo: 'cargando' });
    try {
      const resp = await fetch('/api/consulta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clave: normal }),
        cache: 'no-store',
      });
      const json = (await resp.json().catch(() => ({}))) as Partial<ResultadoConsulta> & { error?: CodigoError };
      if (resp.ok && json.persona) {
        setEstado({ tipo: 'resultado', datos: json as ResultadoConsulta });
      } else {
        setEstado({ tipo: 'error', mensaje: MENSAJES[json.error ?? 'servicio'] ?? MENSAJES.servicio });
      }
    } catch {
      setEstado({ tipo: 'error', mensaje: 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.' });
    }
  }

  function nuevaConsulta() {
    setClave('');
    setEstado({ tipo: 'inicial' });
    setTimeout(() => entradaRef.current?.focus(), 0);
  }

  const cargando = estado.tipo === 'cargando';

  return (
    <>
      {estado.tipo !== 'resultado' && (
        <form className="tarjeta formulario" onSubmit={consultar} noValidate aria-busy={cargando}>
          <label htmlFor="clave">Clave de participante</label>
          <p id="ayuda-clave" className="ayuda">
            Comienza con <strong>SMX-</strong>. Ejemplo: SMX-0000. No distingue mayúsculas de minúsculas.
          </p>
          <div className="fila-entrada">
            <input
              ref={entradaRef}
              id="clave"
              name="clave"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={40}
              placeholder="SMX-0000"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              aria-describedby="ayuda-clave mensaje-estado"
              aria-invalid={estado.tipo === 'error'}
              disabled={cargando}
              required
            />
            <button type="submit" disabled={cargando}>
              {cargando ? (
                <>
                  <span className="giro" aria-hidden="true" /> Consultando…
                </>
              ) : (
                'Consultar'
              )}
            </button>
          </div>
          <div id="mensaje-estado" aria-live="polite" role="status">
            {estado.tipo === 'error' && (
              <p className="alerta" role="alert">
                {estado.mensaje}
              </p>
            )}
            {cargando && <p className="sr-only">Consultando tus registros…</p>}
          </div>
        </form>
      )}

      {estado.tipo === 'resultado' && (
        <Resultado datos={estado.datos} tituloRef={tituloRef} onNueva={nuevaConsulta} />
      )}
    </>
  );
}

function Resultado({
  datos,
  tituloRef,
  onNueva,
}: {
  datos: ResultadoConsulta;
  tituloRef: React.RefObject<HTMLHeadingElement | null>;
  onNueva: () => void;
}) {
  const { persona, asistencias, participaciones } = datos;
  return (
    <section className="resultado" aria-labelledby="titulo-resultado">
      <div className="tarjeta resumen">
        <p className="etiqueta">Participante</p>
        <h2 id="titulo-resultado" ref={tituloRef} tabIndex={-1}>
          {persona.nombre}
        </h2>
        <p className="meta">
          Clave <strong>{persona.clave}</strong>
          {persona.categoria && <> · {persona.categoria}</>}
        </p>

        <div className="indicadores">
          <div className={`indicador ${persona.constancia_asistencia ? 'si' : 'no'}`}>
            <span className="cifra">{persona.n_asistencias}</span>
            <span className="texto">
              <strong>Constancia de asistencia</strong>
              {persona.constancia_asistencia
                ? `Cumple el criterio (mínimo ${MIN_ASISTENCIAS} asistencias registradas).`
                : `No cumple el criterio: se requieren al menos ${MIN_ASISTENCIAS} asistencias registradas.`}
            </span>
          </div>
          <div className={`indicador ${persona.constancia_participacion ? 'si' : 'no'}`}>
            <span className="cifra">{persona.n_participaciones}</span>
            <span className="texto">
              <strong>Constancia de participación</strong>
              {persona.constancia_participacion
                ? 'Cumple el criterio (al menos una participación registrada).'
                : 'Sin participaciones registradas.'}
            </span>
          </div>
        </div>
      </div>

      <div className="tarjeta">
        <h3>Participaciones ({participaciones.length})</h3>
        {participaciones.length === 0 ? (
          <p className="vacio">No hay participaciones registradas con esta clave.</p>
        ) : (
          <ul className="lista">
            {participaciones.map((p, i) => (
              <li key={i} className="elemento">
                {p.modalidad && <span className="chip">{p.modalidad}</span>}
                <p className="principal">{p.titulo ?? 'Sin título registrado'}</p>
                {p.sesion && p.sesion !== p.titulo && <p className="secundario">{p.sesion}</p>}
                <p className="secundario">{fechaLarga(p.fecha)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="tarjeta">
        <h3>Asistencias ({asistencias.length})</h3>
        {asistencias.length === 0 ? (
          <p className="vacio">No hay asistencias registradas con esta clave.</p>
        ) : (
          agruparPorFecha(asistencias).map(([fecha, items]) => (
            <div key={fecha ?? 'sin-fecha'} className="dia">
              <h4>
                {fechaLarga(fecha)} <span className="conteo">{plural(items.length, 'registro', 'registros')}</span>
              </h4>
              <ul className="lista">
                {items.map((a, i) => (
                  <li key={i} className="elemento">
                    <div className="cabeza">
                      {a.horario && <span className="hora">{a.horario}</span>}
                      {a.tipo && <span className="chip">{a.tipo}</span>}
                    </div>
                    <p className="principal">{a.sesion ?? 'Sesión sin nombre registrado'}</p>
                    <p className="secundario">{descripcionRegistro(a)}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="acciones">
        <button type="button" className="secundario-btn" onClick={() => window.print()}>
          Imprimir
        </button>
        <button type="button" onClick={onNueva}>
          Nueva consulta
        </button>
      </div>
      <p className="nota">
        Esta información corresponde a los registros de asistencia y participación del congreso. Al terminar, usa
        “Nueva consulta” para que tus datos no queden visibles en este dispositivo.
      </p>
    </section>
  );
}
