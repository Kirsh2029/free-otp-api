import { Empty, Flex, Input, Pagination } from 'antd';
import { useMemo, useState } from 'react';
import { PhoneRecord } from '../../../types';
import PhoneCard from './PhoneCard';
import { transformPhoneRecords } from './helpers';
import { SearchOutlined } from '@ant-design/icons';

interface Props {
  tabName?: string;
  phones: PhoneRecord[];
  country: string;
  loading: boolean;
  headerHeight: number;
}
const PAGE_SIZE_OPTIONS = [20, 40, 80, 120];
const PhonesTab: React.FC<Props> = ({ phones, country, loading, headerHeight }) => {
  const [current, setCurrent] = useState(1);
  const [pageSize, setPageSize] = useState(40);
  const [query, setQuery] = useState('');
  const records = useMemo(() => transformPhoneRecords(phones).filter((record) => record.value.replace(/\D/g, '').includes(query.replace(/\D/g, ''))), [phones, query]);
  const page = Math.min(current, Math.max(1, Math.ceil(records.length / pageSize)));
  const visible = records.slice((page - 1) * pageSize, page * pageSize);

  return (
    <>
      {!!phones.length && <Flex justify="center" gap={10} style={{ padding: 3, position: 'sticky', top: headerHeight + 46, zIndex: 1, background: '#fff' }}>
        <Input style={{ width: '20%', minWidth: 130 }} placeholder="Search number" allowClear prefix={<SearchOutlined />} value={query} onChange={(event) => { setQuery(event.target.value); setCurrent(1); }} />
        <Pagination current={page} pageSize={pageSize} total={records.length} pageSizeOptions={PAGE_SIZE_OPTIONS} showTotal={(total) => `${total} phones`} onChange={(next, size) => { setCurrent(next); setPageSize(size); }} responsive />
      </Flex>}
      {!loading && !!phones.length && !records.length && <Empty description="No numbers match your search" />}
      <Flex justify="center" wrap="wrap" gap="large">
        {loading
          ? Array.from({ length: 12 }, (_, index) => <PhoneCard key={index} loading countryName={country} />)
          : visible.map((phone) => <PhoneCard key={phone.value} phone={phone} countryName={country} />)}
      </Flex>
    </>
  );
};
export default PhonesTab;
