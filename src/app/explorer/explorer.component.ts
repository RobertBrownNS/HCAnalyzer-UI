import { Component } from '@angular/core';

// Placeholder route; the MVP chart and controls land here in phase 2.
@Component({
  selector: 'app-explorer',
  template: `<section class="explorer" aria-label="Explorer"></section>`,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
    }
    .explorer {
      flex: 1;
      padding: var(--gutter);
    }
  `,
})
export class ExplorerComponent {}
