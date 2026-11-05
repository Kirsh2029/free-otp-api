import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Flex, Typography } from 'antd';
import { StepForwardOutlined, StepBackwardOutlined, RedoOutlined } from '@ant-design/icons';
import { endpoints } from '../../api';
import { useJson } from '../../api/useJson';
import { PhoneMessagesResponse } from '../../types';
import MessagesTable from './MessagesTable';

function publicLink(value: string | null | undefined) {
  try {
    const url = new URL(value ?? '');
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

const paginatedSources = new Set(['anonymsms.com', 'receivesms.co', 'smstome.com', 'receive-sms-free.cc']);

const PhoneMessages: React.FC = () => {
  const navigate = useNavigate();
  const { country = '', phone = '', source = '' } = useParams();
  const location = useLocation();
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  const { data, error, loading } = useJson<PhoneMessagesResponse>(endpoints.phoneMessages(country, phone, source, page), revision);
  const messages = data?.results ?? (data?.result ? [data.result] : []);
  const sourceUrl = publicLink(messages[0]?.url ?? new URLSearchParams(location.search).get('url'));

  return (
    <>
      <Alert type="info" showIcon message="This inbox is public and shared. Never use it for sensitive accounts or confidential messages." />
      {error && <Alert type="error" showIcon message="Message retrieval failed" description={error} />}
      <Flex justify="center" align="center" wrap="wrap" gap="large" style={{ margin: '16px 0' }}>
        <Button icon={<StepBackwardOutlined />} onClick={() => navigate(`/phones/${encodeURIComponent(country)}`)}>To Phone Numbers</Button>
        <Typography.Text strong copyable>{phone}</Typography.Text>
        <Button icon={<RedoOutlined />} loading={loading} onClick={() => setRevision((value) => value + 1)}>Refresh</Button>
        {sourceUrl && <Button icon={<StepForwardOutlined />} href={sourceUrl} target="_blank" rel="noopener noreferrer">To {source}</Button>}
      </Flex>
      {paginatedSources.has(source) && <Flex justify="center" gap="middle" align="center" style={{ marginBottom: 16 }}>
        <Button disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>Previous provider page</Button>
        <Typography.Text>Inbox page {page}</Typography.Text>
        <Button disabled={loading || !messages.length || page >= 100} onClick={() => setPage((value) => value + 1)}>Next provider page</Button>
      </Flex>}
      <MessagesTable loading={loading} messages={messages} />
    </>
  );
};

export default PhoneMessages;
