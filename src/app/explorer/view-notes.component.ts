import { Component, computed, inject } from '@angular/core';

import { ExplorerStore } from './explorer-store';
import { groupPointNotes } from './view-notes';

/** "Notes for this view": numbered chart annotations, then per-year notes from the transform. */
@Component({
  selector: 'app-view-notes',
  template: `
    @if (annotations().length || pointNotes().length) {
      <section aria-labelledby="view-notes-heading">
        <h2 id="view-notes-heading">Notes for this view</h2>

        @if (annotations().length) {
          <ol class="annotations">
            @for (a of annotations(); track a.n) {
              <li [value]="a.n">
                <div class="label"><span class="year">{{ a.yearLabel }}:</span> {{ a.label }}</div>
                @for (t of a.text; track $index) {
                  <p>{{ t }}</p>
                }
                @if (a.refs.length) {
                  <p class="meta">Workbook cells: {{ a.refs.join(', ') }}</p>
                }
                @if (a.source; as src) {
                  <p class="meta">
                    Source: <a [href]="src.url" target="_blank" rel="noopener">{{ src.title }}</a>
                  </p>
                }
              </li>
            }
          </ol>
        }

        @if (pointNotes().length) {
          <h3>By year</h3>
          <ul class="points">
            @for (n of pointNotes(); track n.note) {
              <li><span class="year">{{ n.years }}:</span> {{ n.note }}</li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
      font: var(--mat-sys-body-medium);
    }
    h2 {
      margin: 0 0 8px;
      font: var(--mat-sys-title-medium);
    }
    h3 {
      margin: 16px 0 8px;
      font: var(--mat-sys-title-small);
    }
    ol,
    ul {
      margin: 0;
      padding-left: 1.5rem;
    }
    li + li {
      margin-top: 10px;
    }
    p {
      margin: 4px 0 0;
    }
    .year {
      font-weight: 600;
    }
    .meta {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
      overflow-wrap: anywhere;
    }
    a {
      color: var(--mat-sys-primary);
    }
  `,
})
export class ViewNotesComponent {
  private readonly store = inject(ExplorerStore);
  readonly annotations = this.store.annotationNotes;
  readonly pointNotes = computed(() => groupPointNotes(this.store.points()));
}
