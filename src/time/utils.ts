export const delay = (seconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds * 1000)));

export const waitFor = async (condition: () => boolean, timeoutMs = 30_000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition');
    await delay(0.1);
  }
  return true;
};

const units: Record<string, number> = {
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
  d: 86_400_000, day: 86_400_000, days: 86_400_000,
  w: 604_800_000, week: 604_800_000, weeks: 604_800_000,
  month: 2_592_000_000, months: 2_592_000_000,
  y: 31_536_000_000, year: 31_536_000_000, years: 31_536_000_000
};

/** Unknown timestamps return 0; they must never appear to be fresh messages. */
export const parseTimeAgo = (input?: string, now = Date.now()): number => {
  if (!input?.trim()) return 0;
  const value = input.trim().toLowerCase();
  if (/^(just now|now|a moment ago|moments ago|a few seconds ago|less than (a|one) minute ago)$/.test(value)) return now;
  if (value === 'yesterday') return now - units.d;
  let duration = 0;
  let matched = false;
  const relative = value.replace(/\b(an?|one)\s+(second|minute|hour|day|week|month|year)\b/g, '1 $2');
  const matches = relative.matchAll(/(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|[smhdwy])\b/g);
  let rest = relative;
  for (const match of matches) {
    matched = true;
    duration += Number(match[1]) * units[match[2]];
    rest = rest.replace(match[0], '');
  }
  if (matched && /^(?:\s|,|and|ago|before)*$/.test(rest)) return Math.max(0, now - duration);
  if (/\d{4}[-/]\d{2}[-/]\d{2}|\d{1,2}\s+[a-z]{3,9}\s+\d{4}/i.test(value)) {
    const timestamp = Date.parse(input);
    return Number.isFinite(timestamp) && timestamp <= now ? timestamp : 0;
  }
  return 0;
};

export const stringifyTriggerOtpTimeDiff = (timestamp: number): string => {
  let remaining = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  const parts: string[] = [];
  for (const [label, size] of [['y', 31_536_000], ['w', 604_800], ['d', 86_400], ['h', 3600], ['m', 60], ['s', 1]] as const) {
    const amount = Math.floor(remaining / size);
    remaining %= size;
    if (amount) parts.push(String(amount) + label);
  }
  return parts.join(' ') || '0s';
};
