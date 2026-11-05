export interface Country {
  url: string;
  country: string;
  source: string;
  count: number;
}

export interface Source {
  name: string;
  url: string;
  count: number;
}

export interface CountryRecord {
  name: string;
  sources: Source[];
}

export interface PhonesResponse {
  phones: PhoneRecord[];
  errors?: { source: string; error: string }[];
  pagination?: { page: number; limit: number; total: number; hasMore: boolean };
}

export interface PhoneRecord {
  url: string;
  value: string;
  source: string;
}

export interface PhoneRecordCard {
  value: string;
  sources: {
    name: string;
    url: string;
  }[];
}

export interface Message {
  ago: number;
  agoText: string;
  message: string;
  otp?: string;
  url: string;
}

export interface InboxDiagnostics {
  providerUrl: string;
  readAt: string;
  readDurationMs: number;
  rawRowCount: number;
  parseDrops: number;
  droppedTimestampCount: number;
  droppedMessageCount: number;
  observedMessageCount: number;
  matchedMessageCount: number;
  returnedMessageCount: number;
  timeFilteredCount: number;
  matcherFilteredCount: number;
  page: number;
  pollCount: number;
  newestMessageAt?: number;
  oldestMessageAt?: number;
  emptyInbox: boolean;
  deliveryStatus?: 'unverified';
}

export interface PhoneMessagesResponse {
  diagnostics?: InboxDiagnostics;
  requested?: { ago: number; agoText?: string; timeFilter?: string; match: string; source?: string };
  results?: Message[];
  result?: Message | null;
}
