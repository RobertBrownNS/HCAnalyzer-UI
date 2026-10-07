import { Component, DOCUMENT, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

import { ColorSchemeService } from './core/color-scheme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  template: `
    <header class="bar">
      <a class="brand" routerLink="/" queryParamsHandling="preserve">
        <svg class="logo" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 20V12M10 20V6M15 20V10M20 20V4" />
        </svg>
        <span class="title">{{ title }}</span>
      </a>
      <span class="jurisdiction">Hillsborough County</span>
      <div class="actions">
        <span class="export">
          <button type="button" class="bar-button" disabled aria-describedby="export-hint">Export</button>
          <span id="export-hint" class="bar-hint">Not available yet</span>
        </span>
        <button
          type="button"
          class="bar-button"
          [attr.aria-label]="'Color theme: ' + themeLabel() + '. Change'"
          (click)="colorScheme.cycle()"
        >
          {{ themeLabel() }}
        </button>
        <button type="button" class="bar-button" (click)="share()">{{ shareLabel() }}</button>
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
  readonly title = 'Florida County Finance Explorer';

  private readonly doc = inject(DOCUMENT);
  readonly colorScheme = inject(ColorSchemeService);
  readonly themeLabel = computed(() => ({ system: 'Auto', light: 'Light', dark: 'Dark' })[this.colorScheme.mode()]);
  readonly shareStatus = signal('');
  readonly shareLabel = signal('Share view');
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
