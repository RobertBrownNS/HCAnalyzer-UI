import { Component, inject } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { formatUsd } from '../core/format';
import { DrawerContent, sortRows } from './source-drawer';

/**
 * Source drawer: one plotted value traced to its sources (FY, value, accounts, cells, caveats,
 * cross-check). Opened as a side dialog on desktop and a bottom sheet on phone; both trap focus,
 * close on Escape and restore focus to the point or cell that opened them.
 */
@Component({
  selector: 'app-source-drawer',
  template: `
    <article class="drawer" aria-labelledby="drawer-title">
      <header class="head">
        <div>
          <h2 id="drawer-title" class="title">{{ c.fiscalYearLabel }}</h2>
          <p class="series">{{ c.seriesLabel }}</p>
          <p class="series">{{ c.context }}</p>
        </div>
        <button type="button" class="fx-button close" (click)="close()" aria-label="Close source details">Close</button>
      </header>

      <dl class="values">
        <dt>Value</dt>
        <dd class="num">{{ c.valueText }}</dd>
        <dt>Nominal total of the amounts below</dt>
        <dd class="num">{{ c.nominalText }}</dd>
        @if (c.crossCheck) {
          <dt>Cross-check</dt>
          <dd>{{ c.crossCheck }}</dd>
        }
      </dl>

      @if (c.annotations.length) {
        <section aria-labelledby="drawer-annotations">
          <h3 id="drawer-annotations">Notes for this year</h3>
          <ul class="notes">
            @for (a of c.annotations; track $index) {
              <li>
                {{ a.label }}
                @if (a.detail) {
                  <p class="detail">{{ a.detail }}</p>
                }
              </li>
            }
          </ul>
        </section>
      }

      @if (c.notes.length) {
        <section aria-labelledby="drawer-notes">
          <h3 id="drawer-notes">Notes</h3>
          <ul class="notes">
            @for (n of c.notes; track $index) {
              <li>{{ n }}</li>
            }
          </ul>
        </section>
      }

      <section aria-labelledby="drawer-accounts">
        <h3 id="drawer-accounts">Accounts in this value ({{ rows.length }})</h3>
        <div class="scroll" tabindex="0" role="region" aria-labelledby="drawer-accounts">
          <table>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Name</th>
                <th scope="col">Fund</th>
                <th scope="col" class="right">Amount</th>
                <th scope="col">Cell</th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows; track r.ref) {
                <tr>
                  <td class="num">{{ r.account }}</td>
                  <td>{{ r.name }}</td>
                  <td>{{ r.fund }}</td>
                  <td class="num right">{{ usd(r.amount) }}</td>
                  <td class="num">{{ r.ref }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="drawer-sources">
        <h3 id="drawer-sources">Sources</h3>
        <ul class="sources">
          @for (s of c.sources; track s.id) {
            <li>
              <div>{{ s.publisher }}</div>
              <a [href]="s.url" target="_blank" rel="noopener">{{ s.title }}</a>
              <div class="meta">Retrieved {{ s.retrieved }}</div>
              @if (s.caveats.length) {
                <details>
                  <summary>Caveats ({{ s.caveats.length }})</summary>
                  <ul>
                    @for (cv of s.caveats; track $index) {
                      <li>{{ cv }}</li>
                    }
                  </ul>
                </details>
              }
            </li>
          }
        </ul>
      </section>
    </article>
  `,
  styles: `
    :host {
      display: block;
      color: var(--fx-color-text);
      font: var(--fx-type-body-medium);
    }
    .drawer {
      display: flex;
      flex-direction: column;
      gap: var(--fx-space-3);
      padding: var(--fx-space-4);
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--fx-space-3);
    }
    .title {
      margin: 0;
      font: var(--fx-type-title-medium);
    }
    .series {
      margin: var(--fx-space-0) 0 0;
      font: var(--fx-type-body-small);
      color: var(--fx-color-text-muted);
    }
    .close {
      min-height: var(--fx-touch-target);
    }
    h3 {
      margin: 0 0 var(--fx-space-2);
      font: var(--fx-type-title-small);
    }
    /* Label above value: fits the phone sheet and the side drawer alike. */
    .values {
      margin: 0;
    }
    .values dt {
      font: var(--fx-type-body-small);
      color: var(--fx-color-text-muted);
    }
    .values dd {
      margin: 0 0 var(--fx-space-2);
    }
    .scroll {
      overflow: auto;
      border: var(--fx-border-width) solid var(--fx-color-border);
      border-radius: var(--fx-radius-sm);
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font: var(--fx-type-body-small);
    }
    th,
    td {
      padding: var(--fx-space-1) var(--fx-space-2);
      border-top: var(--fx-border-width) solid var(--fx-color-gridline);
      text-align: left;
      vertical-align: top;
    }
    thead th {
      background: var(--fx-color-surface-container);
      font: var(--fx-type-label-medium);
    }
    .right {
      text-align: right;
      white-space: nowrap;
    }
    .notes,
    .sources {
      margin: 0;
      padding-left: var(--fx-list-indent);
    }
    .detail {
      margin: var(--fx-space-1) 0 0;
      color: var(--fx-color-text-muted);
    }
    .meta,
    details {
      font: var(--fx-type-body-small);
      color: var(--fx-color-text-muted);
    }
    a {
      overflow-wrap: anywhere;
    }
  `,
})
export class SourceDrawerComponent {
  private readonly dialogData = inject<DrawerContent | null>(MAT_DIALOG_DATA, { optional: true });
  private readonly sheetData = inject<DrawerContent | null>(MAT_BOTTOM_SHEET_DATA, { optional: true });
  private readonly dialogRef = inject(MatDialogRef, { optional: true });
  private readonly sheetRef = inject(MatBottomSheetRef, { optional: true });

  readonly c: DrawerContent = (this.dialogData ?? this.sheetData)!;
  readonly rows = sortRows(this.c.rows);
  readonly usd = formatUsd;

  close(): void {
    this.dialogRef?.close();
    this.sheetRef?.dismiss();
  }
}
