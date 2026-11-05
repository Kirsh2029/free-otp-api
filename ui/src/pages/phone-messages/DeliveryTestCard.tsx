import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Flex, Tag, Typography } from 'antd';
import { baseUrl } from '../../api';
import { ApiResponseError, readApiResponse } from '../../api/response';
import type { InboxDiagnostics } from '../../types';

export interface DeliveryProbe {
  id: string;
  status: 'pending' | 'received' | 'expired';
  country: string;
  phoneNumber: string;
  source: string;
  marker: string;
  messageText: string;
  expectedOtp: string;
  createdAt: number;
  expiresAt: number;
  baselineRead?: InboxDiagnostics;
  currentRead?: InboxDiagnostics;
  checkedAt?: number;
  receivedAt?: number;
  lastError?: { at: number; statusCode: number; message: string };
  checkDeferred?: boolean;
  nextCheckAt?: number;
  evidence?: { providerUrl: string; messageTimestamp: number; otpMatched: boolean; messageLength: number };
}
interface Props { country: string; phoneNumber: string; source: string }

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const showTime = (timestamp: number) => new Date(timestamp).toLocaleString();

export default function DeliveryTestCard({ country, phoneNumber, source }: Props) {
  const [probe, setProbe] = useState<DeliveryProbe>();
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const createRequest = useRef<AbortController>();
  const checkImmediately = useRef(false);

  useEffect(() => () => {
    const request = createRequest.current;
    createRequest.current = undefined;
    request?.abort();
  }, []);

  const start = async () => {
    setAutomatic(false);
    setChecking(false);
    setCreating(true);
    setError(undefined);
    setProbe(undefined);
    const controller = new AbortController();
    createRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 75000);
    try {
      const response = await fetch(`${baseUrl}/delivery-tests`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country, phoneNumber, source }), signal: controller.signal
      });
      const body = await readApiResponse<DeliveryProbe>(response);
      if (!controller.signal.aborted) {
        setProbe(body as DeliveryProbe);
        setAutomatic(body.status === 'pending');
      }
    } catch (caught) {
      if (!controller.signal.aborted) setError(errorText(caught));
      else if (createRequest.current === controller) setError('Preparing the delivery check timed out. No SMS was sent.');
    } finally {
      window.clearTimeout(timeout);
      if (createRequest.current === controller) {
        createRequest.current = undefined;
        setCreating(false);
      }
    }
  };

  useEffect(() => {
    if (!automatic || !probe || probe.status !== 'pending') return;
    let stopped = false;
    const controller = new AbortController();
    let timeout: number | undefined;
    const delay = checkImmediately.current ? 0 : Math.min(Math.max(5000, (probe.nextCheckAt || 0) - Date.now()), Math.max(0, probe.expiresAt - Date.now()));
    checkImmediately.current = false;
    const timer = window.setTimeout(async () => {
      setChecking(true);
      timeout = window.setTimeout(() => controller.abort(), 75000);
      try {
        const response = await fetch(`${baseUrl}/delivery-tests/${encodeURIComponent(probe.id)}`, { signal: controller.signal });
        const body = await readApiResponse<DeliveryProbe>(response);
        if (!stopped) {
          setProbe(body as DeliveryProbe);
          setError(undefined);
          if (body.status !== 'pending' || Date.now() >= probe.expiresAt) setAutomatic(false);
        }
      } catch (caught) {
        if (!stopped) {
          if (caught instanceof ApiResponseError) {
            const saved = (caught.data as { probe?: DeliveryProbe } | undefined)?.probe;
            if (saved?.id === probe.id) setProbe(saved);
          }
          setError(controller.signal.aborted ? 'The inbox check timed out. Automatic checking has stopped.' : errorText(caught));
          setAutomatic(false);
        }
      } finally {
        if (timeout !== undefined) window.clearTimeout(timeout);
        if (!stopped) setChecking(false);
      }
    }, delay);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      if (timeout !== undefined) window.clearTimeout(timeout);
      controller.abort();
    };
  }, [automatic, probe, revision]);

  const checkNow = () => {
    checkImmediately.current = true;
    setAutomatic(true);
    setRevision((value) => value + 1);
  };

  return <Card title="Test SMS delivery" style={{ marginTop: 12, marginBottom: 16 }}>
    <Alert type={probe?.status === 'received' ? 'success' : 'warning'} showIcon
      message={probe?.status === 'received' ? 'Fresh test message observed' : 'Fresh SMS delivery is unverified'}
      description={probe?.status === 'received'
        ? 'The unique test marker and expected code text were newly observed after the baseline inbox read. This result applies to this check, not every number or future SMS.'
        : 'A listed number or readable message history does not prove that it receives new SMS. This check does not send an SMS.'} />
    <Typography.Paragraph style={{ marginTop: 12 }}>Start a check, copy its dummy test message into an external sender you control, send it to this number, then wait for the inbox check. Use the exact generated text.</Typography.Paragraph>
    <Flex gap="small" wrap="wrap" style={{ marginBottom: 12 }}>
      <Button onClick={start} loading={creating} disabled={!source || checking}>{probe ? 'Start another delivery check' : 'Start delivery check'}</Button>
      {probe?.status === 'pending' && <>
        <Button onClick={checkNow} loading={checking} disabled={creating}>Check now</Button>
        {automatic && <Button onClick={() => { setAutomatic(false); setChecking(false); }}>Stop checking</Button>}
      </>}
    </Flex>
    {error && <Alert type="error" showIcon message="Delivery check failed" description={`${error} Automatic checking has stopped; this is not evidence of delivery.`} style={{ marginBottom: 12 }} />}
    {probe && <>
      <Flex gap="small" wrap="wrap" style={{ marginBottom: 12 }}>
        <Tag color={probe.status === 'received' ? 'green' : probe.status === 'expired' ? 'default' : 'gold'}>{probe.status}</Tag>
        <Tag>Started: {showTime(probe.createdAt)}</Tag>
        <Tag>Expires: {showTime(probe.expiresAt)}</Tag>
        {probe.checkedAt !== undefined && <Tag>Last checked: {showTime(probe.checkedAt)}</Tag>}
      </Flex>
      {probe.status === 'pending' && <>
        <Typography.Text strong>Send this dummy test message to +{probe.phoneNumber.replace(/^\+/, '')}:</Typography.Text>
        <Typography.Paragraph copyable={{ text: probe.messageText }} code style={{ marginTop: 8 }}>{probe.messageText}</Typography.Paragraph>
        <Typography.Paragraph type="secondary">{automatic ? probe.checkDeferred ? 'Another inbox check is in progress; waiting before the next check.' : 'Checking the public inbox about every 5 seconds until receipt, expiry, or an error.' : 'Automatic checking is stopped. Check now to try again.'} No matching new test SMS has been observed yet.</Typography.Paragraph>
      </>}
      {probe.status === 'expired' && <Alert type="warning" showIcon message="No matching fresh SMS was observed before this check expired" description="Delivery remains unverified. The provider number or sender may not support delivery; readable old messages do not resolve this." />}
      {probe.status === 'received' && <Alert type={probe.evidence?.otpMatched ? 'success' : 'warning'} showIcon message={probe.evidence?.otpMatched ? 'OTP extraction verified for this check' : 'OTP extraction is not verified'} description={probe.evidence?.otpMatched ? 'The extracted OTP matches the generated test code.' : 'The test message was observed, but its extracted OTP did not match the expected code or extraction evidence is absent.'} style={{ marginBottom: 12 }} />}
      {probe.status === 'received' && probe.evidence && <Typography.Paragraph>Provider-reported message time: {showTime(probe.evidence.messageTimestamp)}.</Typography.Paragraph>}
      {probe.lastError && <Typography.Paragraph type="danger">Last provider failure: {probe.lastError.message} ({probe.lastError.statusCode}), {showTime(probe.lastError.at)}.</Typography.Paragraph>}
      {probe.currentRead && <Typography.Paragraph type="secondary">Latest inbox check observed {probe.currentRead.observedMessageCount} messages on the provider page{probe.currentRead.newestMessageAt ? `; newest timestamp ${showTime(probe.currentRead.newestMessageAt)}` : ''}.</Typography.Paragraph>}
    </>}
  </Card>;
}
