import type { FromSchema } from 'json-schema-to-ts';
import type { FastifySchema } from 'fastify';
import { allowedCountries, Source } from '../providers/index.js';

const paramsSchema = {
  type: 'object',
  properties: {
    country: { type: 'string', enum: allowedCountries },
    phoneNumber: {
      type: 'string', minLength: 6, maxLength: 27,
      pattern: '^[+0-9(][0-9 .()-]{5,25}$',
      description: 'International digits, optional leading +, or a national number for the selected country'
    }
  },
  required: ['country', 'phoneNumber'],
  additionalProperties: false
} as const;

export type Params = FromSchema<typeof paramsSchema>;

const querystringSchema = {
  type: 'object',
  properties: {
    ago: {
      type: 'string', maxLength: 20,
      description: 'Relative time window (seconds, minutes, hours, days, or weeks)',
      pattern: '^[0-9]+[smhdw]$', default: '30s'
    },
    since: { type: 'number', minimum: 0, description: 'Unix timestamp in milliseconds; overrides ago' },
    match: { type: 'string', maxLength: 1024, description: 'Case-sensitive substring to match in the SMS' },
    source: { type: 'string', enum: Object.values(Source), description: 'Provider that owns the number; inferred from cache when omitted, then prefers verified inbox-read compatibility. Historical reads do not verify fresh SMS delivery.' },
    page: { type: 'integer', minimum: 1, maximum: 100, default: 1, description: 'Public provider inbox page, where supported' },
    limit: { type: 'integer', minimum: 1, maximum: 1000, default: 1000 },
    timeout: { type: 'integer', minimum: 0, maximum: 20000, default: 0, description: 'Optional bounded polling duration in milliseconds; default checks once' }
  },
  additionalProperties: false
} as const;

export type Querystring = FromSchema<typeof querystringSchema>;

const resultSchema = {
  type: 'object',
  required: ['ago', 'agoText', 'message', 'url'],
  properties: {
    ago: { type: 'number' },
    agoText: { type: 'string' },
    message: { type: 'string' },
    otp: { type: 'string' },
    url: { type: 'string' }
  },
  additionalProperties: false
} as const;

const requestedSchema = {
  type: 'object',
  required: ['country', 'phoneNumber', 'ago', 'match'],
  properties: {
    country: { type: 'string' },
    phoneNumber: { type: 'string' },
    ago: { type: 'number' },
    agoText: { type: 'string' },
    match: { type: 'string' },
    timeFilter: { type: 'string', enum: ['ago', 'since'], description: 'The effective time filter; since overrides ago' },
    source: { type: 'string' }
  },
  additionalProperties: false
} as const;

const diagnosticsSchema = {
  type: 'object',
  description: 'Observed provider inbox read and filter counts. Present only after a real read. A historical inbox read does not verify delivery of a newly sent SMS.',
  required: [
    'providerUrl', 'readAt', 'readDurationMs', 'rawRowCount', 'parseDrops',
    'droppedTimestampCount', 'droppedMessageCount', 'observedMessageCount',
    'matchedMessageCount', 'returnedMessageCount', 'timeFilteredCount',
    'matcherFilteredCount', 'page', 'pollCount', 'emptyInbox', 'deliveryStatus'
  ],
  properties: {
    providerUrl: { type: 'string' },
    readAt: { type: 'string', format: 'date-time' },
    readDurationMs: { type: 'number', minimum: 0 },
    rawRowCount: { type: 'integer', minimum: 0 },
    parseDrops: { type: 'integer', minimum: 0 },
    droppedTimestampCount: { type: 'integer', minimum: 0 },
    droppedMessageCount: { type: 'integer', minimum: 0 },
    observedMessageCount: { type: 'integer', minimum: 0 },
    matchedMessageCount: { type: 'integer', minimum: 0 },
    returnedMessageCount: { type: 'integer', minimum: 0 },
    timeFilteredCount: { type: 'integer', minimum: 0 },
    matcherFilteredCount: { type: 'integer', minimum: 0 },
    page: { type: 'integer', minimum: 1 },
    pollCount: { type: 'integer', minimum: 1 },
    newestMessageAt: { type: 'number', minimum: 0 },
    oldestMessageAt: { type: 'number', minimum: 0 },
    emptyInbox: { type: 'boolean' },
    deliveryStatus: { type: 'string', enum: ['unverified'] }
  },
  additionalProperties: false
} as const;

export const replySchema = {
  type: 'object',
  required: ['requested', 'result', 'results'],
  properties: {
    requested: requestedSchema,
    result: { ...resultSchema, nullable: true },
    results: { type: 'array', items: resultSchema, description: 'All matched messages, including a single match' },
    diagnostics: diagnosticsSchema,
    pagination: {
      type: 'object',
      properties: { page: { type: 'integer' }, limit: { type: 'integer' }, count: { type: 'integer' } },
      additionalProperties: false
    }
  },
  additionalProperties: false
} as const;

export type Reply = FromSchema<typeof replySchema>;

export const replyError = {
  type: 'object',
  required: ['error'],
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
    requested: requestedSchema,
    diagnostics: diagnosticsSchema
  },
  additionalProperties: false
} as const;

export type ReplyError = FromSchema<typeof replyError>;

export const getOtpCodeSchema: FastifySchema = {
  tags: ['Messages'],
  summary: 'Read public SMS messages and extract OTP codes',
  description: 'Shared public inboxes are unsuitable for sensitive accounts or confidential messages. The time filter uses Unix milliseconds. Pagination follows the selected provider.',
  querystring: querystringSchema,
  params: paramsSchema,
  response: { 200: replySchema, default: replyError }
};
