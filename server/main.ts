// Punto de entrada ejecutable: `npm run server` (desarrollo) o `node server/dist/server.mjs` (producción).
import { startServer } from './index';

const s = startServer();
const port = process.env.PORT ?? '8080';
console.log(
  `Turbo Arena server escuchando en el puerto ${port}${process.env.STATIC_DIR ? ` (estáticos: ${process.env.STATIC_DIR})` : ''}`,
);
const stop = (): void => {
  void s.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
