import { useEffect } from 'react';
import { buildSeoDefaults, applySeoMeta } from '@/config/seo';
import { useJurisdiction } from '@/hooks/useJurisdiction';

export function useDocumentMeta() {
  const { jurisdiction } = useJurisdiction();

  useEffect(() => {
    applySeoMeta(buildSeoDefaults(jurisdiction ? {
      name: jurisdiction.name,
      countryCode: jurisdiction.countryCode,
      regulatoryBody: jurisdiction.regulatoryBody,
    } : undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jurisdiction?.code]);
}