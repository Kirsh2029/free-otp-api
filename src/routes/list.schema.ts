import type { FromSchema } from 'json-schema-to-ts';
import type { FastifySchema } from 'fastify';
import { Source, allowedCountries } from '../providers/index.js';

const listParamsSchema = {
  type: 'object',
  properties: { country: { type: 'string', enum: allowedCountries } },
  required: ['country'],
  additionalProperties: false
} as const;

const listQuerySchema = {
  type: 'object',
  properties: {
    source: { type: 'string', enum: Object.values(Source), description: 'Select a provider; omitted queries every available provider for the country' },
    page: { type: 'integer', minimum: 1, maximum: 10000, default: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 1000, default: 1000 }
  },
  additionalProperties: false
} as const;

export type ListParams = FromSchema<typeof listParamsSchema>;
export type ListQuery = FromSchema<typeof listQuerySchema>;

export const replyListSchema = {
  type: 'object',
  required: ['phones'],
  properties: {
    phones: {
      type: 'array',
      items: {
        type: 'object',
        required: ['url', 'value', 'source'],
        properties: {
          url: { type: 'string' },
          value: { type: 'string' },
          source: { type: 'string', enum: Object.values(Source) }
        },
        additionalProperties: false
      }
    },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        required: ['source', 'error'],
        properties: { source: { type: 'string' }, error: { type: 'string' } },
        additionalProperties: false
      }
    },
    pagination: {
      type: 'object',
      required: ['page', 'limit', 'total', 'hasMore'],
      properties: {
        page: { type: 'integer' },
        limit: { type: 'integer' },
        total: { type: 'integer' },
        hasMore: { type: 'boolean' }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
} as const;

export const replyListError = {
  type: 'object',
  required: ['error'],
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
    errors: replyListSchema.properties.errors
  },
  additionalProperties: false
} as const;

export type ReplyList = FromSchema<typeof replyListSchema>;
export type ReplyListError = FromSchema<typeof replyListError>;

export const listPhonesSchema: FastifySchema = {
  tags: ['Phone Numbers'],
  summary: 'Get public phone numbers, with provider filtering and pagination',
  params: listParamsSchema,
  querystring: listQuerySchema,
  response: { 200: replyListSchema, default: replyListError }
};
