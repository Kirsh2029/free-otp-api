import { client, runRedisCommand } from '../repository/redis.js';
import { config } from '../config.js';
import { Sources, allowedCountries, type Source, type MessageReadDiagnostics } from '../providers/index.js';
import { assertProviderUrl } from '../providers/runtime.js';
import { normalizePhoneNumber } from '../providers/helpers.js';
import { DeliveryTestError, type DeliveryProbe, type ProbeStore } from './types.js';

const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const invalidRecord = (): never => { throw new Error('Invalid delivery record'); };

const parseRead = (value: unknown, origins: string[]): MessageReadDiagnostics | undefined => {
  if (value === undefined) return;
  if (!value || typeof value !== 'object') return invalidRecord();
  const read = value as MessageReadDiagnostics;
  const counts = [
    'readDurationMs', 'rawRowCount', 'parseDrops', 'droppedTimestampCount', 'droppedMessageCount',
    'observedMessageCount', 'matchedMessageCount', 'returnedMessageCount', 'timeFilteredCount', 'matcherFilteredCount'
  ] as const;
  if (!counts.every((name) => typeof read[name] === 'number' && Number.isSafeInteger(read[name]) && read[name] >= 0) ||
      !Number.isInteger(read.page) || read.page < 1 || !Number.isInteger(read.pollCount) || read.pollCount < 1 ||
      typeof read.emptyInbox !== 'boolean' || typeof read.readAt !== 'string' || !Number.isFinite(Date.parse(read.readAt)) ||
      typeof read.providerUrl !== 'string' || (read.newestMessageAt !== undefined && !timestamp(read.newestMessageAt)) ||
      (read.oldestMessageAt !== undefined && !timestamp(read.oldestMessageAt))) return invalidRecord();
  return {
    providerUrl: assertProviderUrl(read.providerUrl, origins), readAt: read.readAt,
    readDurationMs: read.readDurationMs, rawRowCount: read.rawRowCount, parseDrops: read.parseDrops,
    droppedTimestampCount: read.droppedTimestampCount, droppedMessageCount: read.droppedMessageCount,
    observedMessageCount: read.observedMessageCount, matchedMessageCount: read.matchedMessageCount,
    returnedMessageCount: read.returnedMessageCount, timeFilteredCount: read.timeFilteredCount,
    matcherFilteredCount: read.matcherFilteredCount, page: read.page, pollCount: read.pollCount, emptyInbox: read.emptyInbox,
    ...(read.newestMessageAt !== undefined ? { newestMessageAt: read.newestMessageAt } : {}),
    ...(read.oldestMessageAt !== undefined ? { oldestMessageAt: read.oldestMessageAt } : {})
  };
};

const parse = (value: string, id?: string, trustedOriginsBySource: Partial<Record<Source, string[]>> = {}): DeliveryProbe => {
  const record: unknown = JSON.parse(value);
  if (!record || typeof record !== 'object') return invalidRecord();
  const p = record as DeliveryProbe;
  const provider = Sources[p.source as Source];
  if (typeof p.id !== 'string' || !uuidPattern.test(p.id) || (id !== undefined && p.id !== id) ||
      typeof p.phoneNumber !== 'string' || !/^[1-9]\d{6,14}$/.test(p.phoneNumber) ||
      typeof p.source !== 'string' || !provider || typeof p.country !== 'string' || !allowedCountries.some((country) => country === p.country) || !provider.countries.includes(p.country) ||
      typeof p.marker !== 'string' || !/^NUMBERTEST-[A-Z]{24}$/.test(p.marker) ||
      typeof p.expectedOtp !== 'string' || !/^[1-9]\d{5}$/.test(p.expectedOtp) || p.messageText !== `${p.marker} code ${p.expectedOtp}` ||
      !timestamp(p.createdAt) || !timestamp(p.expiresAt) || p.expiresAt <= p.createdAt || p.expiresAt - p.createdAt > 1_800_000 ||
      (p.checkedAt !== undefined && (!timestamp(p.checkedAt) || p.checkedAt < p.createdAt)) ||
      !['pending', 'received', 'expired'].includes(p.status)) return invalidRecord();
  if (normalizePhoneNumber(p.phoneNumber, p.country) !== p.phoneNumber) return invalidRecord();
  const origins = trustedOriginsBySource[p.source as Source] ?? provider.allowedOrigins ?? [new URL(provider.baseUrl).origin];
  const baselineRead = parseRead(p.baselineRead, origins);
  const currentRead = parseRead(p.currentRead, origins);
  let evidence: DeliveryProbe['evidence'];
  if (p.status === 'received') {
    const e = p.evidence;
    if (!timestamp(p.receivedAt) || p.receivedAt < p.createdAt || p.receivedAt >= p.expiresAt ||
        !timestamp(p.checkedAt) || p.checkedAt < p.receivedAt || !e || typeof e !== 'object' ||
        typeof e.providerUrl !== 'string' || !timestamp(e.messageTimestamp) || e.messageTimestamp < p.createdAt - 120_000 ||
        e.messageTimestamp > p.receivedAt + 60_000 || typeof e.otpMatched !== 'boolean' ||
        !Number.isSafeInteger(e.messageLength) || e.messageLength < p.marker.length + p.expectedOtp.length) return invalidRecord();
    evidence = {
      providerUrl: assertProviderUrl(e.providerUrl, origins), messageTimestamp: e.messageTimestamp,
      otpMatched: e.otpMatched, messageLength: e.messageLength
    };
  } else if (p.receivedAt !== undefined || p.evidence !== undefined) return invalidRecord();
  if (p.status === 'expired' && (!timestamp(p.checkedAt) || p.checkedAt < p.expiresAt)) return invalidRecord();
  if (p.lastError !== undefined && (!p.lastError || typeof p.lastError !== 'object' || !timestamp(p.lastError.at) ||
      !Number.isInteger(p.lastError.statusCode) || p.lastError.statusCode < 400 || p.lastError.statusCode > 599 ||
      typeof p.lastError.message !== 'string' || p.lastError.message.length > 500)) return invalidRecord();
  // Return only protocol fields: unexpected Redis properties and raw SMS text
  // accidentally attached to diagnostics must never be exposed by this endpoint.
  return {
    id: p.id, status: p.status, country: p.country, phoneNumber: p.phoneNumber, source: p.source,
    marker: p.marker, messageText: p.messageText, expectedOtp: p.expectedOtp, createdAt: p.createdAt, expiresAt: p.expiresAt,
    ...(p.checkedAt !== undefined ? { checkedAt: p.checkedAt } : {}),
    ...(p.receivedAt !== undefined ? { receivedAt: p.receivedAt } : {}),
    ...(baselineRead ? { baselineRead } : {}), ...(currentRead ? { currentRead } : {}),
    ...(evidence ? { evidence } : {}),
    ...(p.lastError ? { lastError: { at: p.lastError.at, statusCode: p.lastError.statusCode, message: p.lastError.message } } : {})
  };
};

export const createProbeStore = (
  redis = client,
  command = runRedisCommand,
  retentionSeconds = config.deliveryTestRetentionSeconds,
  trustedOriginsBySource: Partial<Record<Source, string[]>> = {}
): ProbeStore => {
  const key = (id: string): string => `number-api:delivery:${id}`;
  const lockKey = (id: string): string => `number-api:delivery-lock:${id}`;
  const validateRecord = (probe: DeliveryProbe): DeliveryProbe => {
    try { return parse(JSON.stringify(probe), probe.id, trustedOriginsBySource); }
    catch { throw new DeliveryTestError('Stored delivery test is invalid', 503); }
  };
  const storage = async <T>(operation: Promise<T>): Promise<T> => {
    try { return await command(operation); }
    catch { throw new DeliveryTestError('Delivery test storage is temporarily unavailable', 503); }
  };
  return {
    reserveCreation: async (now, maximum) => {
      const count = await storage(redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],65) end; return n",
        { keys: [`number-api:delivery-rate:${Math.floor(now / 60000)}`], arguments: [] }
      ));
      return Number(count) <= maximum;
    },
    create: async (probe) => {
      const record = validateRecord(probe);
      const saved = await storage(redis.set(key(record.id), JSON.stringify(record), { EX: retentionSeconds, NX: true }));
      if (saved !== 'OK') throw new DeliveryTestError('Delivery test identifier collision; retry creating the test', 503);
    },
    get: async (id) => {
      const value = await storage(redis.get(key(id)));
      if (value === null) return undefined;
      try { return parse(value, id, trustedOriginsBySource); }
      catch { throw new DeliveryTestError('Stored delivery test is invalid', 503); }
    },
    update: async (probe) => {
      const record = validateRecord(probe);
      // Concurrent polling must never overwrite an already observed receipt or
      // revive an expired test. Keep the original retention TTL unchanged.
      const saved = await storage(redis.eval(`
        local old=redis.call('GET',KEYS[1]); if not old then return nil end
        local previous=cjson.decode(old); local next=cjson.decode(ARGV[1])
        local fields={'id','country','phoneNumber','source','marker','messageText','expectedOtp','createdAt','expiresAt'}
        for _,field in ipairs(fields) do
          if previous[field]~=next[field] then return redis.error_reply('Immutable delivery fields changed') end
        end
        if previous.status=='received' or previous.status=='expired' then return old end
        if next.status~='received' and previous.checkedAt and next.checkedAt and previous.checkedAt>next.checkedAt then return old end
        redis.call('SET',KEYS[1],ARGV[1],'KEEPTTL'); return ARGV[1]
      `, { keys: [key(record.id)], arguments: [JSON.stringify(record)] }));
      if (typeof saved !== 'string') throw new DeliveryTestError('Delivery test no longer exists', 404);
      try { return parse(saved, record.id, trustedOriginsBySource); }
      catch { throw new DeliveryTestError('Stored delivery test is invalid', 503); }
    },
    beginCheck: async (id, token, now, leaseMs) => {
      if (!uuidPattern.test(id) || !uuidPattern.test(token) || !timestamp(now) || !Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 600_000) {
        throw new DeliveryTestError('Invalid delivery check lease', 400);
      }
      const result = await storage(redis.eval(`
        local value=redis.call('GET',KEYS[1]); if not value then return 0 end
        local previous=cjson.decode(value)
        if previous.status~='pending' then return 0 end
        local now=tonumber(ARGV[2])
        if tonumber(previous.expiresAt)<=now then return 0 end
        if now-tonumber(previous.checkedAt or previous.createdAt)<3000 then return 0 end
        local saved=redis.call('SET',KEYS[2],ARGV[1],'PX',ARGV[3],'NX')
        if saved then return 1 else return 0 end
      `, { keys: [key(id), lockKey(id)], arguments: [token, String(now), String(leaseMs)] }));
      return Number(result) === 1;
    },
    endCheck: async (id, token) => {
      await storage(redis.eval(
        "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
        { keys: [lockKey(id)], arguments: [token] }
      ));
    }
  };
};
