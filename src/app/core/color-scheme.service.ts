import { DOCUMENT, DestroyRef, Injectable, inject, signal } from '@angular/core';

export type ColorScheme = 'light' | 'dark';

/** Tracks the active color scheme (prefers-color-scheme) so canvas charts can re-theme. */
@Injectable({ providedIn: 'root' })
export class ColorSchemeService {
  private readonly _scheme = signal<ColorScheme>('light');
  readonly scheme = this._scheme.asReadonly();

  constructor() {
    const mql = inject(DOCUMENT).defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mql) return;
    const sync = () => this._scheme.set(mql.matches ? 'dark' : 'light');
    sync();
    mql.addEventListener('change', sync);
    inject(DestroyRef).onDestroy(() => mql.removeEventListener('change', sync));
  }
}
