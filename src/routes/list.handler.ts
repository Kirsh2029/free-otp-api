import type { RouteHandler } from 'fastify';
import type { ListParams, ListQuery, ReplyList, ReplyListError } from './list.schema.js';
import type { Source } from '../providers/index.js';
import { errorMessage, errorStatus } from './services.js';

export const listPhonesHandler: RouteHandler<{
  Params: ListParams;
  Querystring: ListQuery;
  Reply: ReplyList | ReplyListError;
}> = async function (req, reply) {
  const services = this.numberApiServices;
  const { country } = req.params;
  const { source, page = 1, limit = 1000 } = req.query;
  const selected = services.providers.filter((provider) =>
    provider.countries.includes(country) && (!source || provider.name === source)
  );
  if (!selected.length) {
    return reply.code(503).send({ error: source ? `Provider ${source} is unavailable for ${country}` : `No available providers for ${country}` });
  }

  const records = await Promise.all(selected.map(async (provider) => {
    try {
      let phones = await services.getPhones(provider.name, country);
      if (!phones.length) {
        phones = await services.getPhonesList(country, provider);
        // A successful empty listing may be cached; errors never replace valid data.
        await services.savePhones(provider.name, country, phones);
      }
      const seen = new Set<string>();
      const normalized = phones.flatMap((phone) => {
        try {
          const value = services.normalizePhone(phone.phone, country);
          if (seen.has(value)) return [];
          seen.add(value);
          return [{ value, url: phone.url, source: provider.name as Source }];
        } catch {
          req.log.warn({ provider: provider.name, country }, 'Provider returned an invalid phone number');
          return [];
        }
      });
      if (phones.length && !normalized.length) throw new Error('Provider returned no valid phone numbers');
      return { phones: normalized };
    } catch (error) {
      req.log.warn({ err: error, provider: provider.name, country }, 'Phone number lookup failed');
      return { error: { source: provider.name, error: errorMessage(error, 'Provider lookup failed') }, status: errorStatus(error) };
    }
  }));
  const errors = records.flatMap((record) => record.error ? [record.error] : []);
  if (errors.length === selected.length) {
    const status = records.every((record) => record.status === 503) ? 503 : 502;
    return reply.code(status).send({ error: 'All selected providers failed to return phone numbers', errors });
  }
  const phones = records.flatMap((record) => record.phones || []);
  const offset = (page - 1) * limit;
  return reply.send({
    phones: phones.slice(offset, offset + limit),
    ...(errors.length ? { errors } : {}),
    pagination: { page, limit, total: phones.length, hasMore: offset + limit < phones.length }
  });
};
