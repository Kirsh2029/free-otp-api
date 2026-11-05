import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { isRedisHealthy } from '../repository/redis.js';

export interface HealthOptions {
  healthCheck?: () => Promise<boolean>;
}

const healthPlugin: FastifyPluginAsync<HealthOptions> = async (app, options) => {
  const check = options.healthCheck || isRedisHealthy;
  app.get('/health/live', { schema: { hide: true } }, async () => ({ status: 'ok' }));
  app.get('/health', { schema: { tags: ['Health'], summary: 'Check API and required Redis readiness' } }, async (_req, reply) => {
    let ready: boolean;
    try {
      ready = await check();
    } catch {
      ready = false;
    }
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ok' : 'degraded', redis: ready ? 'up' : 'down' });
  });
};

export default fp(healthPlugin, { name: 'number-api-health' });
