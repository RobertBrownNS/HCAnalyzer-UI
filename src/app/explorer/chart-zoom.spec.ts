import { zoomWindowToRange } from './chart-zoom';

describe('zoomWindowToRange (QA-11: zoom becomes the fiscal-year range)', () => {
  const years = [2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016];

  it('snaps a zoom window to whole fiscal years', () => {
    expect(zoomWindowToRange(years, 20, 60)).toEqual([2008, 2012]);
    expect(zoomWindowToRange(years, 23, 57)).toEqual([2008, 2012]);
  });

  it('returns null for the full window (nothing to change)', () => {
    expect(zoomWindowToRange(years, 0, 100)).toBeNull();
    expect(zoomWindowToRange(years, 2, 98)).toBeNull();
  });

  it('keeps at least two years', () => {
    expect(zoomWindowToRange(years, 50, 52)).toEqual([2011, 2012]);
    expect(zoomWindowToRange(years, 99, 100)).toEqual([2015, 2016]);
  });

  it('handles reversed or invalid input', () => {
    expect(zoomWindowToRange(years, 60, 20)).toEqual([2008, 2012]);
    expect(zoomWindowToRange([], 10, 20)).toBeNull();
    expect(zoomWindowToRange(years, Number.NaN, 20)).toBeNull();
  });
});
