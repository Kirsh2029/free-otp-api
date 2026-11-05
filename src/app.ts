import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import { pathToFileURL } from 'node:url';
import { config, type AppConfig } from './config.js';
import { browser } from './browser/cluster.js';
import { setGracefulShutdown } from './gracefulShutdown.js';
import swagger from './plugins/swagger.js';
import cors from './plugins/cors.js';
import health, { type HealthOptions } from './plugins/health.js';
import routes, { type RouteOptions } from './routes/index.js';
import { startJobs, stopJobs } from './scheduler/cron.js';
import { connectRedis, closeRedis } from './repository/redis.js';

export interface BuildAppOptions extends RouteOptions, HealthOptions {
  config?: AppConfig;
  logger?: FastifyServerOptions['logger'];
}

export const buildApp = async (options: BuildAppOptions = {}) => {
  const settings = options.config || config;
  const app = Fastify({
    logger: options.logger ?? true,
    // Reject unknown fields rather than silently discarding misspelled filters.
    ajv: { customOptions: { removeAdditional: false } }
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const status = error.validation ? 400 : typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) request.log.error({ err: error }, 'Unhandled API error');
    reply.code(status).send({ error: status >= 500 ? 'The API is temporarily unavailable' : error.message });
  });
  await app.register(cors, { config: settings });
  await app.register(swagger, { config: settings });
  await app.register(health, { healthCheck: options.healthCheck });
  await app.register(routes, { prefix: settings.apiPath, services: options.services, delivery: { ...options.delivery, settings } });
  app.get('/', { schema: { hide: true } }, async () => ({ name: 'Number API', api: settings.apiBaseUrl, docs: '/docs', health: '/health' }));
  return app;
};

export const start = async () => {
  const app = await buildApp();
  let maintenance: ReturnType<typeof setInterval> | undefined;
  app.addHook('onClose', async () => {
    if (maintenance) clearInterval(maintenance);
    try {
      await stopJobs();
    } finally {
      try {
        await browser.closeCluster();
      } finally {
        await closeRedis();
      }
    }
  });
  const removeSignalListeners = setGracefulShutdown(app);
  app.addHook('onClose', async () => { removeSignalListeners(); });
  try {
    // Required dependency is connected and pinged before a listening socket exists.
    await connectRedis();
    await app.listen({ port: config.port, host: config.host });
    startJobs();
    maintenance = setInterval(() => {
      browser.refreshCluster().catch((error: unknown) => app.log.error({ err: error }, 'Browser maintenance failed'));
    }, config.browser.maintenanceIntervalMs);
    maintenance.unref();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch(() => {
    // Configuration and dependencies may contain secrets: keep the process message generic.
    process.stderr.write('Number API startup failed. Check Redis connectivity, browser configuration, and the application logs.\n');
    process.exitCode = 1;
  });
}
