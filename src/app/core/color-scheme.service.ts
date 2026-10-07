import { DOCUMENT, DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

export type ColorScheme = 'light' | 'dark';
/** 'system' follows prefers-color-scheme; the others override it. */
export type ColorSchemeMode = 'system' | ColorScheme;

const STORAGE_KEY = 'fx-color-scheme';
const MODES: readonly ColorSchemeMode[] = ['system', 'light', 'dark'];

/**
 * Active color scheme. Follows prefers-color-scheme unless the viewer picks light or dark;
 * the choice sets html[data-theme] (see styles.scss) and is remembered in this browser only.
 * Canvas charts read `scheme` to re-theme.
 */
@Injectable({ providedIn: 'root' })
export class ColorSchemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly systemScheme = signal<ColorScheme>('light');
  private readonly _mode = signal<ColorSchemeMode>('system');

  readonly mode = this._mode.asReadonly();
  readonly scheme = computed<ColorScheme>(() => {
    const mode = this._mode();
    return mode === 'system' ? this.systemScheme() : mode;
  });

  constructor() {
    this.applyMode(this.readStored());
    const mql = this.doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mql) return;
    const sync = () => this.systemScheme.set(mql.matches ? 'dark' : 'light');
    sync();
    mql.addEventListener('change', sync);
    inject(DestroyRef).onDestroy(() => mql.removeEventListener('change', sync));
  }

  setMode(mode: ColorSchemeMode): void {
    this.applyMode(mode);
    try {
      this.doc.defaultView?.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Storage unavailable (private mode, blocked): the choice lasts for this page only.
    }
  }

  /** system -> light -> dark -> system */
  cycle(): void {
    this.setMode(MODES[(MODES.indexOf(this._mode()) + 1) % MODES.length]);
  }

  private applyMode(mode: ColorSchemeMode): void {
    this._mode.set(mode);
    const root = this.doc.documentElement;
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
  }

  private readStored(): ColorSchemeMode {
    try {
      const v = this.doc.defaultView?.localStorage.getItem(STORAGE_KEY);
      return MODES.includes(v as ColorSchemeMode) ? (v as ColorSchemeMode) : 'system';
    } catch {
      return 'system';
    }
  }
}
