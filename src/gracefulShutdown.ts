import type { FastifyInstance } from 'fastify';
import { consola } from 'consola';

export const setGracefulShutdown = (app: FastifyInstance): (() => void) => {
  let closing = false;
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const onSignal = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    consola.info('Stopping Number API');
    try {
      await app.close();
      process.exitCode = 0;
    } catch {
      consola.error('Number API shutdown failed');
      process.exitCode = 1;
    }
  };
  signals.forEach((signal) => process.on(signal, onSignal));
  return () => { signals.forEach((signal) => process.off(signal, onSignal)); };
};
