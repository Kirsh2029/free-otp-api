import type { RouteHandler } from 'fastify';
import type { Params, Querystring, Reply, ReplyError } from './phone.schema.js';
import { parseTimeAgo } from '../time/utils.js';
import type { MessageReadDiagnostics } from '../providers/types.js';
import { errorMessage, errorStatus, isProviderAvailable, normalizeInboxRead } from './services.js';

export const getOtpCodeHandler: RouteHandler<{
  Querystring: Querystring;
  Params: Params;
  Reply: Reply | ReplyError;
}> = async function (req, reply) {
  const services = this.numberApiServices;
  const { params, query } = req;
  const eligible = services.providers.filter((candidate) =>
    isProviderAvailable(candidate) && candidate.countries.includes(params.country) && (!query.source || candidate.name === query.source)
  ).sort((a, b) => Number(b.status === 'verified') - Number(a.status === 'verified'));
  let provider = eligible[0];
  if (!provider) {
    return reply.code(503).send({ error: query.source ? `Provider ${query.source} is unavailable for ${params.country}` : `No available providers for ${params.country}` });
  }

  let phoneNumber: string;
  try {
    phoneNumber = services.normalizePhone(params.phoneNumber, params.country);
  } catch {
    return reply.code(400).send({ error: 'Invalid phone number for the selected country' });
  }
  if (!query.source) {
    try {
      // Reuse the provider that owns a number previously returned by /list.
      // Some services use inbox IDs unrelated to the telephone number.
      const ownership = await Promise.all(eligible.map(async (candidate) => {
        const cached = await services.getPhones(candidate.name, params.country);
        return cached.some((entry) => {
          try { return services.normalizePhone(entry.phone, params.country) === phoneNumber; }
          catch { return false; }
        });
      }));
      provider = eligible[ownership.findIndex(Boolean)] || provider;
    } catch {
      return reply.code(503).send({ error: 'Provider selection cache is temporarily unavailable' });
    }
  }
  const askedAt = query.since ?? parseTimeAgo(query.ago || '30s');
  if (!Number.isFinite(askedAt) || askedAt < 0) return reply.code(400).send({ error: 'Invalid message time filter' });
  const requested = {
    country: params.country,
    phoneNumber,
    ago: askedAt,
    agoText: query.since === undefined ? query.ago : undefined,
    timeFilter: query.since === undefined ? 'ago' as const : 'since' as const,
    // Fastify decodes query parameters once; decoding again corrupts literal percent signs.
    match: query.match || '',
    source: provider.name
  };
  const page = query.page ?? 1;
  const limit = query.limit ?? 1000;
  let lastRead: MessageReadDiagnostics | undefined;
  const readDiagnostics = () => lastRead ? { ...lastRead, deliveryStatus: 'unverified' as const } : undefined;
  try {
    const found = await services.getMessages(provider, {
      country: params.country,
      phoneNumber: `+${phoneNumber}`,
      askedOtpAt: askedAt,
      matcher: requested.match,
      page,
      limit,
      timeoutMs: query.timeout ?? 0,
      onRead: (diagnostics) => { lastRead = { ...diagnostics }; }
    });
    const messages = normalizeInboxRead(found)
      .filter((message) => Number.isFinite(message.ago) && message.ago >= askedAt && message.message.includes(requested.match))
      .slice(0, limit);
    return reply.send({
      requested,
      result: messages[0] || null,
      results: messages,
      ...(lastRead ? { diagnostics: readDiagnostics() } : {}),
      pagination: { page, limit, count: messages.length }
    });
  } catch (error) {
    req.log.warn({ err: error, provider: provider.name, country: params.country }, 'Public inbox lookup failed');
    return reply.code(errorStatus(error)).send({
      requested,
      error: errorMessage(error, 'Provider inbox is temporarily unavailable'),
      ...(lastRead ? { diagnostics: readDiagnostics() } : {})
    });
  }
};
