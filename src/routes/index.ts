import type { FastifyPluginAsync } from 'fastify';
import { getOtpCodeSchema } from './phone.schema.js';
import { listPhonesSchema } from './list.schema.js';
import { listCountriesSchema } from './countries.schema.js';
import { getOtpCodeHandler } from './phone.handler.js';
import { listPhonesHandler } from './list.handler.js';
import { listCountriesHandler } from './countries.handler.js';
import { defaultServices, type ApiServices } from './services.js';
import deliveryRoutes, { type DeliveryRouteOptions } from '../delivery/routes.js';

export interface RouteOptions {
  services?: Partial<ApiServices>;
  delivery?: DeliveryRouteOptions;
}

export const routes: FastifyPluginAsync<RouteOptions> = async (app, options) => {
  const services: ApiServices = { ...defaultServices, ...options.services };
  app.decorate('numberApiServices', services);
  app.addHook('onSend', (_request, reply, payload, done) => {
    // Inbox reads and delivery probe state must be rechecked, including empty
    // matches and upstream errors; Redis remains the phone-list cache.
    reply.header('Cache-Control', 'no-store');
    done(null, payload);
  });
  app.addHook('preValidation', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    for (const [name, value] of Object.entries(query)) {
      if (Array.isArray(value)) return reply.code(400).send({ error: `Query parameter ${name} must occur once` });
      // AJV coerces whitespace-only strings to numeric zero. For since, that
      // would silently remove the requested time filter and read all history.
      if (['since', 'page', 'limit', 'timeout'].includes(name) && typeof value === 'string' && !value.trim()) {
        return reply.code(400).send({ error: `Query parameter ${name} must be a number` });
      }
    }
  });
  await app.register(deliveryRoutes, options.delivery || {});
  app.route({ method: 'GET', url: '/list/:country', schema: listPhonesSchema, handler: listPhonesHandler });
  app.route({ method: 'GET', url: '/:country/:phoneNumber', schema: getOtpCodeSchema, handler: getOtpCodeHandler });
  app.route({ method: 'GET', url: '/countries', schema: listCountriesSchema, handler: listCountriesHandler });
  app.get('/providers', {
    schema: { tags: ['Providers'], summary: 'Show enabled, disabled, and unverified source status' }
  }, async () => services.allProviders.map((provider) => ({
    source: provider.name,
    baseUrl: provider.baseUrl,
    enabled: provider.enabled,
    status: provider.status,
    reason: provider.statusReason,
    verifiedAt: provider.verifiedAt,
    verification: provider.verification,
    countries: provider.countries,
    unavailableCountries: provider.unavailableCountries
  })));
};

export default routes;
