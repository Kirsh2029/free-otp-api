import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import cors from '@fastify/cors';
import { config, type AppConfig } from '../config.js';

const corsPlugin: FastifyPluginAsync<{ config?: AppConfig }> = async (app, options) => {
  const origins = new Set((options.config || config).corsOrigins);
  await app.register(cors, {
    origin: (origin, callback) => callback(null, !origin || origins.has(origin)),
    credentials: false,
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    maxAge: 600,
    strictPreflight: true
  });
};

export default fp(corsPlugin, { name: 'number-api-cors' });
