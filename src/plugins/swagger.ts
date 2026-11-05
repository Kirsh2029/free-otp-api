import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { config, type AppConfig } from '../config.js';

const docsPlugin: FastifyPluginAsync<{ config?: AppConfig }> = async (app, options) => {
  const settings = options.config || config;
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Number API',
        description: 'Public SMS inboxes for authorized testing. Shared inboxes are public and unsuitable for sensitive accounts or confidential messages.',
        version: '2.0.0'
      },
      servers: [{ url: settings.apiBaseUrl }]
    },
    transform: ({ schema, url }) => {
      // Fastify owns the prefix; OpenAPI's server already includes it.
      const apiRoute = url === settings.apiPath || url.startsWith(`${settings.apiPath}/`);
      return {
        schema: apiRoute ? schema : { ...schema, hide: true },
        url: apiRoute ? url.slice(settings.apiPath.length) || '/' : url
      };
    }
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
    staticCSP: true
  });
};

export default fp(docsPlugin, { name: 'number-api-docs' });
