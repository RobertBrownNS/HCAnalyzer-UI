// Display labels for settings. Descriptive only.
import { Flow } from './models';
import { CpiIndex, CpiPeriod, Measure, TransferMode, TransformSettings } from './transform';

export const FLOW_LABELS: Record<Flow, string> = {
  revenue: 'Revenues',
  expenditure: 'Expenditures',
};

export const MEASURE_LABELS: Record<Measure, string> = {
  nominal: 'Nominal dollars',
  per_capita: 'Per resident',
  real: 'Inflation-adjusted',
  real_per_capita: 'Per resident, inflation-adjusted',
};

export const CPI_LABELS: Record<CpiIndex, string> = {
  'cpi-u-us': 'CPI-U, U.S. city average',
  'cpi-u-tampa': 'CPI-U, Tampa–St. Petersburg–Clearwater',
};

export const CPI_SHORT_LABELS: Record<CpiIndex, string> = {
  'cpi-u-us': 'CPI-U U.S.',
  'cpi-u-tampa': 'CPI-U Tampa',
};

export const CPI_PERIOD_LABELS: Record<CpiPeriod, string> = {
  fiscal: 'Fiscal-year average (Oct–Sep)',
  calendar: 'Calendar-year average',
};

export function isReal(m: Measure): boolean {
  return m === 'real' || m === 'real_per_capita';
}

export function isPerCapita(m: Measure): boolean {
  return m === 'per_capita' || m === 'real_per_capita';
}

export const TRANSFER_LABELS: Record<TransferMode, string> = {
  gross: 'As reported (gross)',
  net: 'Excluded (net)',
};

/** "All funds as reported by EDR, excluding custodial" */
export function fundScopeLabel(
  s: Pick<TransformSettings, 'includeCustodial'>,
  funds = 'All funds as reported by EDR',
): string {
  return `${funds}, ${s.includeCustodial ? 'including' : 'excluding'} custodial`;
}

/** "Transfers between funds: as reported (gross)" */
export function transferLabel(s: Pick<TransformSettings, 'transfers'>): string {
  return `Transfers between funds: ${TRANSFER_LABELS[s.transfers ?? 'gross'].toLowerCase()}`;
}
