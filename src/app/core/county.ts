import { Injectable, computed, inject, signal } from '@angular/core';

import { DataService } from './data.service';

/** Display names by county id, from manifest.jurisdictionNames ("pinellas" -> "Pinellas County"). */
export type CountyNames = Readonly<Record<string, string>>;

/**
 * Full display name: the data's own name when it has one, else the title-cased id plus
 * " County" (fallback only; the pipeline supplies names).
 */
export function countyLabel(id: string, names: CountyNames = {}): string {
  const named = names[id];
  if (named) return named;
  const title = id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('-');
  return `${title} County`;
}

/** Short name for compact labels ("County: Pinellas", the county select): drops " County". */
export function countyShortName(id: string, names: CountyNames = {}): string {
  return countyLabel(id, names).replace(/ County$/, '');
}

/** The county the explorer is showing, for parts of the page outside it (the header). */
@Injectable({ providedIn: 'root' })
export class CountyContext {
  private readonly names = inject(DataService).countyNames;
  readonly id = signal<string | null>(null);
  /** "Pinellas County", or null before a county is settled. */
  readonly label = computed(() => {
    const id = this.id();
    return id ? countyLabel(id, this.names()) : null;
  });
}
