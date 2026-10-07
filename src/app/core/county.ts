import { Injectable, computed, signal } from '@angular/core';

/** Display names for county ids whose name isn't the title-cased id. */
const NAMES: Record<string, string> = {
  'miami-dade': 'Miami-Dade',
  'st-johns': 'St. Johns',
  'st-lucie': 'St. Lucie',
  desoto: 'DeSoto',
};

/** "pinellas" -> "Pinellas". Neutral label; the county list comes from the data manifest. */
export function countyName(id: string): string {
  return NAMES[id] ?? id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** The county the explorer is showing, for parts of the page outside it (the header). */
@Injectable({ providedIn: 'root' })
export class CountyContext {
  readonly id = signal<string | null>(null);
  /** "Pinellas County", or null before a county is settled. */
  readonly label = computed(() => {
    const id = this.id();
    return id ? `${countyName(id)} County` : null;
  });
}
