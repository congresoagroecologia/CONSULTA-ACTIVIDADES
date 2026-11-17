import 'server-only';
import postgres from 'postgres';

// Conexión con el rol de mínimo privilegio "somexa_consulta", que solo puede
// ejecutar somexa.consultar(). Se reutiliza entre invocaciones de la función.
let cliente: ReturnType<typeof postgres> | null = null;

export function db() {
  if (!cliente) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('Falta la variable de entorno DATABASE_URL');
    cliente = postgres(url, {
      prepare: false, // requerido por el pooler de Supabase en modo transacción
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }
  return cliente;
}
