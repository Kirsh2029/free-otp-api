import type { FromSchema } from 'json-schema-to-ts';
import type { FastifySchema } from 'fastify';
import { Source } from '../providers/index.js';

export const replyCountriesSchema = {
  type: 'array',
  items: {
    type: 'object',
    required: ['url', 'country', 'source', 'count'],
    properties: {
      url: { type: 'string' },
      country: { type: 'string' },
      source: { type: 'string' },
      count: { type: 'integer', minimum: 0 }
    },
    additionalProperties: false
  }
} as const;

export const replyCountriesError = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' }, message: { type: 'string' } },
  additionalProperties: false
} as const;

const countriesQuerySchema = {
  type: 'object',
  properties: { source: { type: 'string', enum: Object.values(Source) } },
  additionalProperties: false
} as const;

export type CountriesQuery = FromSchema<typeof countriesQuerySchema>;
export type ReplyCountries = FromSchema<typeof replyCountriesSchema>;
export type ReplyCountriesError = FromSchema<typeof replyCountriesError>;

export const listCountriesSchema: FastifySchema = {
  tags: ['Countries'],
  summary: 'List provider countries and currently cached number counts',
  description: 'Counts reflect Redis cache contents. A zero count may indicate an unpopulated cache; GET /list/{country} performs a live lookup on a cache miss.',
  querystring: countriesQuerySchema,
  response: { 200: replyCountriesSchema, default: replyCountriesError }
};
