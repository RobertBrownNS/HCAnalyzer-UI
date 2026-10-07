import { countyLabel, countyShortName } from './county';
import { AnnotationRecord } from './models';
import { DEFAULT_SETTINGS, TransformData, annotationsInRange } from './transform';

describe('county names', () => {
  const names = { hillsborough: 'Hillsborough County', pinellas: 'Pinellas County' };

  it('uses the names the data provides', () => {
    expect(countyLabel('pinellas', names)).toBe('Pinellas County');
    expect(countyShortName('pinellas', names)).toBe('Pinellas');
  });

  it('falls back to the title-cased id only when the data has no name', () => {
    expect(countyLabel('miami-dade')).toBe('Miami-Dade County');
    expect(countyShortName('miami-dade')).toBe('Miami-Dade');
  });
});

describe('annotations per county (shared GASB 84 row + county rows)', () => {
  const gasb: AnnotationRecord = {
    fiscalYear: 2021, kind: 'methodology', label: 'Custodial fund reporting begins (GASB 84).', sourceId: 'page', topic: 'gasb84',
  };
  const county = (jurisdiction: string, fiscalYear: number, topic: AnnotationRecord['topic']): AnnotationRecord => ({
    fiscalYear, kind: 'methodology', label: `${jurisdiction} ${topic}`, sourceId: 's', jurisdiction, topic,
  });
  const data = {
    observations: [],
    population: {},
    cpi: {},
    annotations: [
      gasb,
      county('hillsborough', 2021, 'custodial-zero'),
      county('pinellas', 2021, 'custodial-zero'),
      county('pinellas', 2023, 'custodial-start'),
    ],
    sources: [],
  } as unknown as TransformData;

  for (const jurisdiction of ['hillsborough', 'pinellas']) {
    it(`${jurisdiction}: GASB 84 appears exactly once, plus only that county's rows`, () => {
      const rows = annotationsInRange(data, { ...DEFAULT_SETTINGS, range: [2005, 2025], includeCustodial: true, jurisdiction });
      expect(rows.filter((a) => a.topic === 'gasb84')).toHaveLength(1);
      expect(rows.every((a) => a.jurisdiction === undefined || a.jurisdiction === jurisdiction)).toBe(true);
    });
  }

  it('Pinellas carries the custodial-start row; Hillsborough does not', () => {
    const s = { ...DEFAULT_SETTINGS, range: [2005, 2025] as [number, number], includeCustodial: true };
    expect(annotationsInRange(data, { ...s, jurisdiction: 'pinellas' }).map((a) => a.topic)).toContain('custodial-start');
    expect(annotationsInRange(data, { ...s, jurisdiction: 'hillsborough' }).map((a) => a.topic)).not.toContain('custodial-start');
  });
});
