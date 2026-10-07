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
                @for (c of a.citations; track $index) {
                  <p class="meta">
                    Cells <span class="num">{{ c.cells.join(', ') }}</span>
                    @if (c.source; as src) {
                      in <a [href]="src.url" target="_blank" rel="noopener">{{ src.title }}</a>
                    }
                  </p>
                }
                @if (!a.citations.length && a.source; as src) {
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
      font: var(--fx-type-body-medium);
    }
    h2 {
      margin: 0 0 var(--fx-space-2);
      font: var(--fx-type-title-medium);
    }
    h3 {
      margin: var(--fx-space-4) 0 var(--fx-space-2);
      font: var(--fx-type-title-small);
    }
    ol,
    ul {
      margin: 0;
      padding-left: var(--fx-list-indent);
    }
    li + li {
      margin-top: var(--fx-space-2);
    }
    p {
      margin: var(--fx-space-1) 0 0;
    }
    .year {
      font-weight: var(--fx-weight-semibold);
    }
    .meta {
      font: var(--fx-type-body-small);
      color: var(--fx-color-on-surface-variant);
      overflow-wrap: anywhere;
    }
    a {
      color: var(--fx-color-primary);
    }
  `,
})
export class ViewNotesComponent {
  private readonly store = inject(ExplorerStore);
  readonly annotations = this.store.annotationNotes;
  readonly pointNotes = computed(() => groupPointNotes(this.store.points(), this.annotations()));
}
