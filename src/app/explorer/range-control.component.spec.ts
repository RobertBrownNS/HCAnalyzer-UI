import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TransformSettings } from '../core/transform';
import { DEFAULT_SETTINGS } from '../core/transform';
import { ExplorerStore } from './explorer-store';
import { RangeControlComponent } from './range-control.component';

class FakeStore {
  readonly years = signal([2006, 2007, 2008, 2009, 2010]);
  readonly loading = signal(false);
  readonly revealSkeleton = signal(true);
  readonly settings = signal<TransformSettings>({ ...DEFAULT_SETTINGS, range: [2006, 2010] });
  update = vi.fn((patch: Partial<TransformSettings>) => this.settings.update((s) => ({ ...s, ...patch })));
}

describe('RangeControlComponent history (QA-23)', () => {
  let store: FakeStore;
  let c: RangeControlComponent;

  beforeEach(() => {
    store = new FakeStore();
    TestBed.configureTestingModule({
      imports: [RangeControlComponent],
      providers: [{ provide: ExplorerStore, useValue: store }],
    });
    c = TestBed.createComponent(RangeControlComponent).componentInstance;
  });

  it('a mouse drag (press moves the thumb, then more moves, then release) commits once', () => {
    c.onDragStart();
    c.onThumbChange('start', 2007); // the press itself snaps the thumb one step
    c.onThumbChange('start', 2008);
    c.onDragEnd('start', 2009);
    expect(store.update).toHaveBeenCalledTimes(1);
    expect(store.update).toHaveBeenCalledWith({ range: [2009, 2010] });
  });

  it('a change event arriving after release is a no-op repeat of the same range', () => {
    c.onDragStart();
    c.onDragEnd('end', 2008);
    c.onThumbChange('end', 2008); // native change after pointerup
    expect(store.update).toHaveBeenNthCalledWith(1, { range: [2006, 2008] });
    expect(store.settings().range).toEqual([2006, 2008]);
  });

  it('keyboard changes (no drag) commit each step', () => {
    c.onThumbChange('end', 2009);
    c.onThumbChange('end', 2008);
    expect(store.update).toHaveBeenCalledTimes(2);
    expect(store.settings().range).toEqual([2006, 2008]);
  });
});

describe('RangeControlComponent placeholder (QA-27)', () => {
  let store: FakeStore;

  async function render(loading: boolean): Promise<HTMLElement> {
    store = new FakeStore();
    store.years.set([]);
    store.loading.set(loading);
    TestBed.configureTestingModule({
      imports: [RangeControlComponent],
      providers: [{ provide: ExplorerStore, useValue: store }],
    });
    const fixture = TestBed.createComponent(RangeControlComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the placeholder while the data loads', async () => {
    const el = await render(true);
    expect(el.querySelector('.pending')).not.toBeNull();
    expect(el.querySelector('.fx-skel')).not.toBeNull();
  });

  it('shows no placeholder after a failed load (no shimmer under Retry)', async () => {
    const el = await render(false);
    expect(el.querySelector('.pending')).toBeNull();
    expect(el.querySelector('.fx-skel')).toBeNull();
  });
});
