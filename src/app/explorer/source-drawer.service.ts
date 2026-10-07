import { DOCUMENT, Injectable, inject } from '@angular/core';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatDialog } from '@angular/material/dialog';

import { DrawerContent } from './source-drawer';
import { SourceDrawerComponent } from './source-drawer.component';

/**
 * Opens the source drawer: a side dialog from the tablet breakpoint up, a bottom sheet on phones.
 * Both are modal, trap focus, close on Escape and return focus to the element that opened them.
 */
@Injectable({ providedIn: 'root' })
export class SourceDrawerService {
  private readonly dialog = inject(MatDialog);
  private readonly sheet = inject(MatBottomSheet);
  private readonly doc = inject(DOCUMENT);

  open(content: DrawerContent): void {
    if (this.isPhone()) {
      this.sheet.open(SourceDrawerComponent, { data: content, ariaLabel: `Sources for ${content.fiscalYearLabel}` });
    } else {
      this.dialog.open(SourceDrawerComponent, {
        data: content,
        panelClass: 'fx-drawer-panel',
        position: { right: '0', top: '0' },
        ariaLabelledBy: 'drawer-title',
        autoFocus: 'dialog',
        restoreFocus: true,
      });
    }
  }

  private isPhone(): boolean {
    const win = this.doc.defaultView;
    const bp = win ? getComputedStyle(this.doc.documentElement).getPropertyValue('--fx-breakpoint-tablet').trim() : '';
    return !!bp && !!win?.matchMedia && !win.matchMedia(`(min-width: ${bp})`).matches;
  }
}
