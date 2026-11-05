import type { FastifyPluginAsync } from 'fastify';
import { allowedCountries, Source, type Country } from '../providers/index.js';
import { config, type AppConfig } from '../config.js';
import { createDeliveryService } from './service.js';
import { createProbeStore } from './repository.js';
import { DeliveryTestError, type ProbeStore } from './types.js';

export interface DeliveryRouteOptions { store?: ProbeStore; settings?: AppConfig; }

const routes: FastifyPluginAsync<DeliveryRouteOptions> = async (app, options) => {
  const settings = options.settings || config;
  const service = createDeliveryService({ services: app.numberApiServices, store: options.store || createProbeStore(undefined, undefined, settings.deliveryTestRetentionSeconds), settings });
  const run = async (operation: () => Promise<unknown>, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    try { return await operation(); }
    catch (error) {
      if (error instanceof DeliveryTestError) return reply.code(error.statusCode).send({ error: error.message, ...(error.probe ? { probe: error.probe } : {}) });
      throw error;
    }
  };
  app.post<{ Body: { source: Source; country: Country; phoneNumber: string } }>('/delivery-tests', {
    bodyLimit: 2048,
    schema: {
      tags: ['Delivery tests'], summary: 'Prepare a tracked fresh SMS test; this endpoint sends no SMS',
      description: 'Reads the selected public inbox before issuing a unique test message. Send that message yourself, then poll its test ID. Pending means delivery remains unverified.',
      body: {
        type: 'object', additionalProperties: false, required: ['source', 'country', 'phoneNumber'],
        properties: {
          source: { type: 'string', enum: Object.values(Source) },
          country: { type: 'string', enum: allowedCountries },
          phoneNumber: { type: 'string', minLength: 7, maxLength: 30, pattern: '^[+0-9(][0-9 .()-]{5,28}$' }
        }
      }
    }
  }, async (request, reply) => run(() => service.create(request.body), reply));
  app.get<{ Params: { id: string } }>('/delivery-tests/:id', {
    schema: {
      tags: ['Delivery tests'], summary: 'Check whether a fresh unique test SMS has appeared in the public inbox',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$' } }, additionalProperties: false }
    }
  }, async (request, reply) => run(() => service.check(request.params.id), reply));
};

export default routes;
