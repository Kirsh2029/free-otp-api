import type { Page } from 'puppeteer';
import type { Country } from './index.js';

export enum Source {
  ReceiveSmsFree = 'receive-sms-free.cc',
  AnonymSms = 'anonymsms.com',
  QuackrIo = 'quackr.io',
  SmsToMeCom = 'smstome.com',
  ReceiveSmsOnlineCom = 'receivesmsonline.com',
  ReceiveSmsCo = 'receivesms.co',
  ReceiveSmssOnlineCom = 'receive-smss-online.com'
}

export interface VerificationCheck {
  status: 'verified' | 'unverified' | 'blocked' | 'failed' | 'not_applicable';
  checkedAt?: string;
  countries?: string[];
  detail: string;
}

export interface ProviderVerification {
  listing: VerificationCheck;
  inboxRead: VerificationCheck;
  freshSmsDelivery: VerificationCheck;
}

export interface MessageReadDiagnostics {
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
}

export interface Provider {
  enabled: boolean;
  status: 'verified' | 'unverified' | 'disabled';
  statusReason: string;
  verifiedAt?: string;
  verification?: ProviderVerification;
  unavailableCountries?: Record<string, string>;
  baseUrl: string;
  allowedOrigins?: string[];
  name: string;
  getPhonesList: (page: Page, country: Country, url?: string) => Promise<PhoneNumberListReply>;
  handleOtp: (page: Page, options: OtpRouteHandlerOptions) => Promise<Message | Message[] | undefined>;
  countries: Country[];
  getCountryUrl?: (country: Country) => string;
  refreshCacheExpression?: string;
}

export interface OtpRouteHandlerOptions {
  country: Country;
  phoneNumber: string;
  askedOtpAt?: number;
  matcher: string | string[];
  interval?: number;
  timeoutMs?: number;
  page?: number;
  limit?: number;
  /** Node-side read telemetry; never contains public inbox message content. */
  onRead?: (diagnostics: MessageReadDiagnostics) => void;
}

export interface PhoneNumber {
  phone: string;
  url: string;
}

export interface PhoneNumberListReply {
  phones: PhoneNumber[];
  nextPageUrl?: string;
}

export interface Message {
  ago: number;
  agoText: string;
  message: string;
  otp?: string;
  url: string;
  error?: string;
}
