import React from 'react';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Message } from '../../types';

const columns: ColumnsType<Message> = [
  {
    title: 'Received',
    dataIndex: 'agoText',
    width: '25%',
    render: (value: string, message: Message) => <span title={new Date(message.ago).toISOString()}>{value}<br /><small>{new Date(message.ago).toLocaleString()}</small></span>,
    sorter: (a, b) => a.ago - b.ago,
    defaultSortOrder: 'descend'
  },
  {
    title: 'Message',
    dataIndex: 'message',
    width: '75%'
  }
];

interface Props {
  messages?: Message[];
  loading?: boolean;
}

const MessagesTable: React.FC<Props> = ({ messages, loading }) => (
  <Table rowKey={(message) => `${message.url}:${message.ago}:${message.message}`} loading={loading} columns={columns} dataSource={messages} pagination={{ pageSize: 100 }} />
);

export default MessagesTable;
