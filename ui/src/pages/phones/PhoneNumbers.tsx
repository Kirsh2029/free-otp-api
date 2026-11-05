import { Alert, Empty, Menu } from 'antd';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { endpoints } from '../../api';
import { useJson } from '../../api/useJson';
import { PhonesResponse } from '../../types';
import PhonesTab from './components/PhonesTab';
import { ALL_SOURCES_TAB, HEADER_HEIGHT } from './constants';

const PhoneNumbers: React.FC = () => {
  const country = useParams().country ?? '';
  const [selectedSource, setSelectedSource] = useState(ALL_SOURCES_TAB);
  const { data, error, loading } = useJson<PhonesResponse>(endpoints.countryPhones(country), 0, true);
  const phones = data?.phones ?? [];
  const sources = useMemo(() => [ALL_SOURCES_TAB, ...new Set(phones.map((phone) => phone.source))], [phones]);
  const activeSource = sources.includes(selectedSource) ? selectedSource : ALL_SOURCES_TAB;
  const filtered = activeSource === ALL_SOURCES_TAB ? phones : phones.filter((phone) => phone.source === activeSource);

  return (
    <>
      {error && <Alert type="error" showIcon message="Phone listing failed" description={error} />}
      {!!data?.errors?.length && (
        <Alert type="warning" showIcon message="Some sources failed" description={data.errors.map((failure) => `${failure.source}: ${failure.error}`).join('; ')} />
      )}
      {!loading && !error && !phones.length && <Empty style={{ marginTop: 100 }} description="No public numbers currently listed for this country" />}
      <Menu
        onSelect={(event) => setSelectedSource(event.key)}
        mode="horizontal"
        selectedKeys={[activeSource]}
        items={sources.map((source) => ({ key: source, label: source }))}
        style={{ display: 'flex', justifyContent: 'center', position: 'sticky', top: HEADER_HEIGHT, zIndex: 1 }}
      />
      <PhonesTab key={`${country}:${activeSource}`} phones={filtered} country={country} loading={loading} headerHeight={HEADER_HEIGHT} tabName={activeSource} />
    </>
  );
};

export default PhoneNumbers;
