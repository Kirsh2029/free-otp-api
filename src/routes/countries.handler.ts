import type { RouteHandler } from 'fastify';
import type { CountriesQuery, ReplyCountries, ReplyCountriesError } from './countries.schema.js';

export const listCountriesHandler: RouteHandler<{
  Querystring: CountriesQuery;
  Reply: ReplyCountries | ReplyCountriesError;
}> = async function (req, reply) {
  const services = this.numberApiServices;
  const selected = services.providers.filter((provider) => !req.query.source || provider.name === req.query.source);
  if (!selected.length) return reply.code(503).send({ error: 'No available providers match this request' });
  try {
    const countries = await Promise.all(selected.flatMap((provider) => provider.countries.map(async (country) => {
      const phones = await services.getPhones(provider.name, country);
      return {
        country,
        source: provider.name,
        url: provider.getCountryUrl?.(country) || provider.baseUrl,
        count: phones.length
      };
    })));
    reply.header('X-Number-Counts', 'redis-cache');
    return reply.send(countries);
  } catch (error) {
    req.log.error({ err: error }, 'Country cache lookup failed');
    return reply.code(503).send({ error: 'Country cache is temporarily unavailable' });
  }
};
