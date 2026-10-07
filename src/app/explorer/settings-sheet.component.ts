import { Component, inject } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';

import { ControlGroup, ExplorerControlsComponent } from './explorer-controls.component';

export interface SettingsSheetData {
  group: ControlGroup;
}

/** Phone bottom sheet holding one control group. Changes apply immediately. */
@Component({
  selector: 'app-settings-sheet',
  imports: [ExplorerControlsComponent],
  template: `
    <app-explorer-controls [only]="data.group" />
    <div class="actions">
      <button type="button" class="fx-button fx-button-primary" (click)="close()">Done</button>
    </div>
  `,
  styles: `
    :host {
      display: block;
      padding: var(--fx-space-2) 0 var(--fx-space-4);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--fx-space-4);
    }
    .actions button {
      min-width: var(--fx-button-min-width);
    }
  `,
})
export class SettingsSheetComponent {
  readonly data = inject<SettingsSheetData>(MAT_BOTTOM_SHEET_DATA);
  private readonly ref = inject(MatBottomSheetRef<SettingsSheetComponent>);

  close(): void {
    this.ref.dismiss();
  }
}
