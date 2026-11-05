import type { FastifyPluginAsync } from 'fastify';
import { getOtpCodeSchema } from './phone.schema.js';
import { listPhonesSchema } from './list.schema.js';
import { listCountriesSchema } from './countries.schema.js';
import { getOtpCodeHandler } from './phone.handler.js';
import { listPhonesHandler } from './list.handler.js';
import { listCountriesHandler } from './countries.handler.js';
import { defaultServices, type ApiServices } from './services.js';

export interface RouteOptions {
  services?: Partial<ApiServices>;
}

export const routes: FastifyPluginAsync<RouteOptions> = async (app, options) => {
  const services: ApiServices = { ...defaultServices, ...options.services };
  app.decorate('numberApiServices', services);
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
    countries: provider.countries
  })));
};

export default routes;
