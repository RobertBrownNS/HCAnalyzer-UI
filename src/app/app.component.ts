import { Component, DOCUMENT, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

import { ColorSchemeService } from './core/color-scheme.service';
import { CountyContext } from './core/county';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  template: `
    <header class="bar">
      <a class="brand" routerLink="/" queryParamsHandling="preserve" [attr.aria-label]="title">
        <svg class="logo" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 20V12M10 20V6M15 20V10M20 20V4" />
        </svg>
        <span class="title" aria-hidden="true">
          <span class="title-full">{{ title }}</span><span class="title-short">{{ shortTitle }}</span>
        </span>
      </a>
      @if (county.label(); as label) {
        <span class="jurisdiction">{{ label }}</span>
      }
      <div class="actions">
        <button
          type="button"
          class="bar-button theme"
          [attr.aria-label]="'Color theme: ' + themeLabel() + '. Change'"
          (click)="colorScheme.cycle()"
        >
          <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8" />
            <path d="M12 4a8 8 0 0 1 0 16z" />
          </svg>
          <span class="theme-text">{{ themeLabel() }}</span>
        </button>
        <button type="button" class="bar-button share" (click)="share()">
          <span class="label-full">{{ shareLabel() }}</span><span class="label-short" aria-hidden="true">{{
            shareShortLabel()
          }}</span>
        </button>
        <span class="sr-only" aria-live="polite">{{ shareStatus() }}</span>
      </div>
    </header>
    @if (fallbackUrl(); as url) {
      <div class="share-fallback" role="region" aria-label="Link to this view">
        <label class="fx-field">
          The link could not be copied automatically. Select and copy it:
          <input #linkField class="fx-select" readonly [value]="url" (focus)="linkField.select()" />
        </label>
        <button type="button" class="fx-button" (click)="fallbackUrl.set(null)">Close</button>
      </div>
    }
    <main class="site-main">
      <router-outlet />
    </main>
  `,
  styleUrl: './app.component.scss',
})
export class AppComponent {
  readonly title = 'FL Finance Transparency';
  /** Phones only, so the bar fits at 360px. */
  readonly shortTitle = 'FL Finance Transparency';

  private readonly doc = inject(DOCUMENT);
  readonly colorScheme = inject(ColorSchemeService);
  readonly county = inject(CountyContext);
  readonly themeLabel = computed(() => ({ system: 'Auto', light: 'Light', dark: 'Dark' })[this.colorScheme.mode()]);
  readonly shareStatus = signal('');
  readonly shareLabel = signal('Share view');
  readonly shareShortLabel = computed(() => (this.shareLabel() === 'Share view' ? 'Share' : this.shareLabel()));
  /** Shown in a visible, selectable field when the clipboard is unavailable. */
  readonly fallbackUrl = signal<string | null>(null);
  private resetTimer?: ReturnType<typeof setTimeout>;

  /** Copies the current URL; every setting is in its query string. */
  async share(): Promise<void> {
    const url = this.doc.location.href;
    let ok = false;
    try {
      await this.doc.defaultView?.navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      ok = false;
    }
    this.shareLabel.set(ok ? 'Link copied' : 'Copy failed');
    this.shareStatus.set(ok ? 'Link to this view copied to the clipboard.' : 'Copy failed. The link is shown below.');
    this.fallbackUrl.set(ok ? null : url);
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => this.shareLabel.set('Share view'), 2500);
  }
}
