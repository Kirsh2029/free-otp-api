import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Flex, Input, Select, Tag, Typography } from 'antd';
import { StepForwardOutlined, StepBackwardOutlined, RedoOutlined } from '@ant-design/icons';
import { endpoints } from '../../api';
import type { MessageQuery } from '../../api/endpoints';
import { useJson } from '../../api/useJson';
import { PhoneMessagesResponse } from '../../types';
import MessagesTable from './MessagesTable';
import DeliveryTestCard from './DeliveryTestCard';
import { extractMessages, inboxStatus, newestMessageTimestamp } from './status';

function publicLink(value: string | null | undefined) {
  try {
    const url = new URL(value ?? '');
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
const paginatedSources = new Set(['anonymsms.com', 'receivesms.co', 'smstome.com', 'receive-sms-free.cc']);
type TimeRange = 'history' | '5m' | '30m';
const displayTime = (timestamp: number) => new Date(timestamp).toLocaleString();

const PhoneMessages: React.FC = () => {
  const navigate = useNavigate();
  const { country = '', phone = '', source = '' } = useParams();
  const location = useLocation();
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  const [draftRange, setDraftRange] = useState<TimeRange>('history');
  const [draftMatch, setDraftMatch] = useState('');
  const [filters, setFilters] = useState<MessageQuery>({ since: 1 });
  const { data, error, loading } = useJson<PhoneMessagesResponse>(endpoints.phoneMessages(country, phone, source, page, filters), revision);
  const messages = extractMessages(data);
  const status = data ? inboxStatus(data) : undefined;
  const newestAt = newestMessageTimestamp(data);
  const sourceUrl = publicLink(messages[0]?.url ?? data?.diagnostics?.providerUrl ?? new URLSearchParams(location.search).get('url'));
  const applyFilters = () => {
    setPage(1);
    setFilters({
      ...(draftRange === 'history' ? { since: 1 } : { ago: draftRange }),
      ...(draftMatch ? { match: draftMatch } : {})
    });
    setRevision((value) => value + 1);
  };

  return (
    <>
      <Alert type="info" showIcon message="This inbox is public and shared. Never use it for sensitive accounts or confidential messages." />
      <DeliveryTestCard key={`${country}:${source}:${phone}`} country={country} phoneNumber={phone} source={source} />
      {error && <Alert type="error" showIcon message="Message retrieval failed" description={error} style={{ marginTop: 12 }} />}
      <Flex justify="center" align="center" wrap="wrap" gap="large" style={{ margin: '16px 0' }}>
        <Button icon={<StepBackwardOutlined />} onClick={() => navigate(`/phones/${encodeURIComponent(country)}`)}>To Phone Numbers</Button>
        <Typography.Text strong copyable>{phone}</Typography.Text>
        <Button icon={<RedoOutlined />} loading={loading} onClick={() => setRevision((value) => value + 1)}>Refresh</Button>
        {sourceUrl && <Button icon={<StepForwardOutlined />} href={sourceUrl} target="_blank" rel="noopener noreferrer">To {source}</Button>}
      </Flex>
      <Flex justify="center" align="center" wrap="wrap" gap="small" style={{ marginBottom: 12 }}>
        <Select<TimeRange> aria-label="Message time range" value={draftRange} onChange={setDraftRange} style={{ minWidth: 220 }} options={[
          { value: 'history', label: 'Existing inbox history' },
          { value: '5m', label: 'Last 5 minutes' },
          { value: '30m', label: 'Last 30 minutes' }
        ]} />
        <Input aria-label="Message text filter" value={draftMatch} onChange={(event) => setDraftMatch(event.target.value)} onPressEnter={applyFilters} placeholder="Exact text or unique test marker" allowClear maxLength={1024} style={{ width: 300 }} />
        <Button onClick={applyFilters} disabled={loading}>Apply filters</Button>
      </Flex>
      <Typography.Paragraph type="secondary">
        {filters.since === 1 ? 'Viewing existing inbox history.' : `Viewing messages from the last ${filters.ago === '5m' ? '5' : '30'} minutes.`}
        {filters.match ? ' A case-sensitive text filter is active.' : ''}
      </Typography.Paragraph>
      {status && !loading && <Alert type={status.kind === 'matched' ? 'info' : 'warning'} showIcon message={status.title} description={status.description} style={{ marginBottom: 12 }} />}
      {data?.diagnostics && !loading && <Flex wrap="wrap" gap="small" style={{ marginBottom: 12 }}>
        <Tag>{data.diagnostics.observedMessageCount} observed on this page</Tag>
        <Tag>{data.diagnostics.matchedMessageCount} matched</Tag>
        {newestAt !== undefined && <Tag>Newest seen: {displayTime(newestAt)}</Tag>}
        <Tag>Checked: {new Date(data.diagnostics.readAt).toLocaleString()}</Tag>
      </Flex>}
      {!!data?.diagnostics?.parseDrops && <Alert type="warning" showIcon message="Some provider rows were unreadable" description={`${data.diagnostics.parseDrops} rows were skipped because their message or timestamp could not be parsed.`} style={{ marginBottom: 12 }} />}
      {paginatedSources.has(source) && <Flex justify="center" gap="middle" align="center" style={{ marginBottom: 16 }}>
        <Button disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>Previous provider page</Button>
        <Typography.Text>Inbox page {page}</Typography.Text>
        <Button disabled={loading || !(data?.diagnostics?.observedMessageCount ?? messages.length) || page >= 100} onClick={() => setPage((value) => value + 1)}>Next provider page</Button>
      </Flex>}
      <MessagesTable loading={loading} messages={messages} />
    </>
  );
};

export default PhoneMessages;
