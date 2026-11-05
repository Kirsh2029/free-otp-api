import type { Country, MessageReadDiagnostics } from '../providers/index.js';

export interface DeliveryProbe {
  id: string;
  status: 'pending' | 'received' | 'expired';
  country: Country;
  phoneNumber: string;
  source: string;
  marker: string;
  messageText: string;
  expectedOtp: string;
  createdAt: number;
  expiresAt: number;
  checkedAt?: number;
  receivedAt?: number;
  checkDeferred?: boolean;
  nextCheckAt?: number;
  lastError?: { at: number; statusCode: number; message: string };
  baselineRead?: MessageReadDiagnostics;
  currentRead?: MessageReadDiagnostics;
  evidence?: {
    providerUrl: string;
    messageTimestamp: number;
    otpMatched: boolean;
    messageLength: number;
  };
}

export interface ProbeStore {
  reserveCreation: (now: number, maximum: number) => Promise<boolean>;
  create: (probe: DeliveryProbe) => Promise<void>;
  get: (id: string) => Promise<DeliveryProbe | undefined>;
  update: (probe: DeliveryProbe) => Promise<DeliveryProbe>;
  beginCheck: (id: string, token: string, now: number, leaseMs: number) => Promise<boolean>;
  endCheck: (id: string, token: string) => Promise<void>;
}

export class DeliveryTestError extends Error {
  constructor(message: string, public statusCode: number, public probe?: DeliveryProbe) {
    super(message);
    this.name = 'DeliveryTestError';
  }
}
