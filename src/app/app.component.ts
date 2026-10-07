import { Component, DOCUMENT, inject, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

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
        <button type="button" class="bar-button export" disabled title="Export (CSV, PNG) is not available yet">
          Export
        </button>
        <button type="button" class="bar-button" (click)="share()">{{ shareLabel() }}</button>
        <span class="sr-only" aria-live="polite">{{ shareStatus() }}</span>
      </div>
    </header>
    <main class="site-main">
      <router-outlet />
    </main>
  `,
  styleUrl: './app.component.scss',
})
export class AppComponent {
  readonly title = 'Florida County Finance Explorer';

  private readonly doc = inject(DOCUMENT);
  readonly shareStatus = signal('');
  readonly shareLabel = signal('Share view');
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
    this.shareStatus.set(ok ? 'Link to this view copied to the clipboard.' : `Copy this link: ${url}`);
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => this.shareLabel.set('Share view'), 2500);
  }
}
