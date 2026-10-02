export const BPO_CAMPAIGNS = [
  'Entel Empresas RUC 10',
  'Entel Empresas RUC 20',
  'Equifax',
  'GPON',
  'Culqi',
  'Tigre Academy',
  'Ruta del tigre',
] as const;

export const LEGACY_CAMPAIGN_ALIASES: Record<string, string> = {
  'Entel Empresas': 'Entel Empresas RUC 10',
  'Entel RUC 10': 'Entel Empresas RUC 10',
  'Entel RUC 20': 'Entel Empresas RUC 20',
  Fija: 'Equifax',
  Prosegur: 'Prosegur',
  Equifax: 'Equifax',
};

export const CAMPAIGN_PREFIXES: Record<string, string> = {
  'Entel Empresas': 'EN',
  'Entel Empresas RUC 10': 'EN',
  'Entel Empresas RUC 20': 'EN20',
  Fija: 'FI',
  GPON: 'GP',
  Culqi: 'CU',
  'Tigre Academy': 'TA',
  'Ruta del tigre': 'RT',
  Prosegur: 'PR',
  Equifax: 'EQ',
};

export const normalizeCampaignName = (campaign: string) =>
  LEGACY_CAMPAIGN_ALIASES[campaign] || campaign;

export const getCampaignPrefix = (campaign: string) =>
  CAMPAIGN_PREFIXES[campaign] ||
  campaign
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase() ||
  'BPO';
