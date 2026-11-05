import { useMemo } from 'react';
import { Alert, Empty, Flex, Typography } from 'antd';
import { endpoints } from '../../api';
import { useJson } from '../../api/useJson';
import { Country, CountryRecord } from '../../types';
import CountryCard from './components/CountryCard';
import { transformCountryToCountryRecord } from './helpers';

const firstAccess = ['USA', 'UK', 'Ukraine', 'France', 'Netherlands'];
const reorder = (countries: CountryRecord[]) => [
  ...countries.filter((country) => firstAccess.includes(country.name)),
  ...countries.filter((country) => !firstAccess.includes(country.name)).sort((a, b) => a.name.localeCompare(b.name))
];

const Countries: React.FC = () => {
  const { data, error, loading } = useJson<Country[]>(endpoints.countriesList);
  const countries = useMemo(() => reorder(transformCountryToCountryRecord(data ?? [])), [data]);
  return (
    <>
      <Typography.Paragraph type="secondary">Counts reflect cached listings. Select a country to load its public numbers.</Typography.Paragraph>
      {error && <Alert type="error" showIcon message="Country listing failed" description={error} />}
      {!loading && !error && !countries.length && <Empty description="No enabled public sources currently list countries" />}
      <Flex justify="center" wrap="wrap" gap="middle">
        {loading
          ? Array.from({ length: 12 }, (_, index) => <CountryCard key={index} loading />)
          : countries.map((country) => <CountryCard key={country.name} country={country} />)}
      </Flex>
    </>
  );
};

export default Countries;
