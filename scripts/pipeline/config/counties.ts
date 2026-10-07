/**
 * Counties the pipeline processes. Add an entry to process another county;
 * every value must be checked against the EDR site (file names are not fully regular).
 */
export interface CountyConfig {
  /** Slug used in output file names and Observation.jurisdiction. */
  slug: string;
  name: string;
  /** File-name stem on EDR's cntyfiscal page, e.g. "hillsboroughcounty" -> hillsboroughcountyrevenues.xlsx */
  edrFileStem: string;
  /** County name exactly as it appears (before any footnote marker) in EDR's FLcopops.xlsx. */
  populationName: string;
  /**
   * Optional: the county's own Annual Financial Report (the DFS form it filed with the Florida CFO),
   * as published by the county. Used only to cross-check EDR's transcription; never as a data source.
   */
  /** Extra caveats copied into this county's two EDR AFR Source records. */
  afrCaveats?: string[];
  /** DFS LOGERX entity code of the county government (counties are 100xxx). */
  logerxEntityCode?: string;
  countyAfr?: {
    publisher: string;
    /** Page that lists the files. */
    indexUrl: string;
    /** `caveats`: facts about a specific filing, copied into its Source record. */
    files: Array<{ fiscalYear: number; url: string; caveats?: string[] }>;
  };
}

export const COUNTIES: CountyConfig[] = [
  {
    slug: 'hillsborough',
    name: 'Hillsborough County',
    edrFileStem: 'hillsboroughcounty',
    populationName: 'Hillsborough',
    logerxEntityCode: '100029',
    countyAfr: {
      publisher: 'Hillsborough County Clerk of Court & Comptroller (Annual Financial Report filed with the Florida Department of Financial Services)',
      indexUrl: 'https://hillsclerk.com/records-and-reports/financial-reports-county',
      files: [
        { fiscalYear: 2022, url: 'https://hillsclerk.com/documents/d/guest/annual-local-govt-financial-report-2022?download=true' },
        { fiscalYear: 2023, url: 'https://hillsclerk.com/documents/d/guest/afr-hillsborough-2023?download=true' },
        { fiscalYear: 2024, url: 'https://hillsclerk.com/documents/d/guest/afr-pdf?download=true' },
        {
          fiscalYear: 2025,
          url: 'https://hillsclerk.com/documents/d/guest/afr-hillsborough-2025-state-report-final-submitted-to-fl-cfo-pdf?download=true',
          caveats: [
            'The header of this filing shows no audit-received date: on page 1 the audit-received date field shows an unfilled placeholder instead of a date (AFR received date 6/30/2026). The FY 2021-22, FY 2022-23 and FY 2023-24 filings show audit-received dates of 6/15/2023, 6/28/2024 and 6/30/2025.',
          ],
        },
      ],
    },
  },
  {
    slug: 'pinellas',
    name: 'Pinellas County',
    edrFileStem: 'pinellascounty',
    populationName: 'Pinellas',
    logerxEntityCode: '100052',
  },
];
