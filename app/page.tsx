import Consulta from '@/components/Consulta';

export default function Inicio() {
  return (
    <>
      <header className="encabezado">
        <div className="contenedor">
          <p className="evento">SOMEXA 2026</p>
          <h1>Consulta de asistencias y participaciones</h1>
          <p className="bajada">
            Escribe tu clave de participante para ver el desglose de tus asistencias registradas y de tus
            participaciones en el congreso.
          </p>
        </div>
      </header>
      <main className="contenedor">
        <Consulta />
      </main>
      <footer className="pie contenedor">
        <p>
          Tu clave es personal: no la compartas. Si encuentras un error en tus registros, comunícate con el comité
          organizador de SOMEXA 2026.
        </p>
      </footer>
    </>
  );
}
