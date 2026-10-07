import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TransformSettings } from '../core/transform';
import { DEFAULT_SETTINGS } from '../core/transform';
import { ExplorerStore } from './explorer-store';
import { RangeControlComponent } from './range-control.component';

class FakeStore {
  readonly years = signal([2006, 2007, 2008, 2009, 2010]);
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
