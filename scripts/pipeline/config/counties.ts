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
}

export const COUNTIES: CountyConfig[] = [
  {
    slug: 'hillsborough',
    name: 'Hillsborough County',
    edrFileStem: 'hillsboroughcounty',
    populationName: 'Hillsborough',
  },
];
