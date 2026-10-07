import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';

import { ControlGroup, ExplorerControlsComponent } from './explorer-controls.component';

export interface SettingsSheetData {
  group: ControlGroup;
}

/** Phone bottom sheet holding one control group. Changes apply immediately. */
@Component({
  selector: 'app-settings-sheet',
  imports: [ExplorerControlsComponent, MatButtonModule],
  template: `
    <app-explorer-controls [only]="data.group" />
    <div class="actions">
      <button matButton="filled" type="button" (click)="close()">Done</button>
    </div>
  `,
  styles: `
    :host {
      display: block;
      padding: 8px 0 16px;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 16px;
    }
    .actions button {
      min-height: var(--touch-target);
      min-width: 96px;
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
