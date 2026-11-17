export interface Persona {
  clave: string;
  nombre: string;
  categoria: string | null;
  n_asistencias: number;
  n_participaciones: number;
  constancia_asistencia: boolean;
  constancia_participacion: boolean;
  tipo_constancia: string;
}

export interface Asistencia {
  sesion: string | null;
  tipo: string | null;
  fecha: string | null; // YYYY-MM-DD
  horario: string | null;
  registro: string | null; // YYYY-MM-DDTHH:MM:SS (hora local del evento)
  origen: string | null;
}

export interface Participacion {
  sesion: string | null;
  fecha: string | null;
  modalidad: string | null;
  titulo: string | null;
}

export interface ResultadoConsulta {
  persona: Persona;
  asistencias: Asistencia[];
  participaciones: Participacion[];
}

export type CodigoError = 'formato' | 'no_encontrado' | 'limite' | 'servicio' | 'solicitud';

export const MIN_ASISTENCIAS = 5;
