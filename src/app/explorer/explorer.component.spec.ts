import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { DataService, DataStatus } from '../core/data.service';
import { TransformData } from '../core/transform';
import { ExplorerComponent } from './explorer.component';

class LoadingDataService {
  readonly status = signal<DataStatus>('loading');
  readonly error = signal<string | null>(null);
  readonly data = signal<TransformData | null>(null);
  load = () => Promise.resolve();
}

describe('ExplorerComponent', () => {
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '', component: ExplorerComponent }]),
        { provide: DataService, useClass: LoadingDataService },
      ],
    });
    harness = await RouterTestingHarness.create();
  });

  it('shows a loading state while data loads', async () => {
    await harness.navigateByUrl('/', ExplorerComponent);
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('mat-progress-bar')).not.toBeNull();
  });

  it('shows one chip per active setting, custodial excluded by default', async () => {
    await harness.navigateByUrl('/', ExplorerComponent);
    await harness.fixture.whenStable();
    const chips = [...(harness.routeNativeElement as HTMLElement).querySelectorAll('.chip')].map((c) =>
      c.textContent?.trim(),
    );
    expect(chips).toContain('Revenues');
    expect(chips).toContain('Nominal dollars');
    expect(chips).toContain('Custodial excluded');
    expect(chips).toContain('Transfers: as reported (gross)');
    expect(chips.some((c) => c?.startsWith('CPI'))).toBe(false);
  });

  it('adds base-year and inflation chips for inflation-adjusted measures', async () => {
    const page = await harness.navigateByUrl('/?measure=real&base=2020&cpi=cpi-u-tampa&cpiper=calendar', ExplorerComponent);
    await harness.fixture.whenStable();
    const labels = page.chips().map((c) => c.label);
    expect(labels).toContain('FY 2019-20 dollars');
    expect(labels).toContain('CPI-U Tampa, calendar-year');
    expect(page.valueLabel()).toBe('Revenues, inflation-adjusted, FY 2019-20 dollars');
  });

  it('states the fund scope and transfer mode under the title', async () => {
    const page = await harness.navigateByUrl('/?cust=1&xfer=net', ExplorerComponent);
    await harness.fixture.whenStable();
    expect(page.scopeLine()).toBe(
      'All funds as reported by EDR, including custodial. Transfers between funds: excluded (net).',
    );
    const scope = (harness.routeNativeElement as HTMLElement).querySelector('.scope')?.textContent;
    expect(scope).toContain('All funds as reported by EDR, including custodial');
  });
});
