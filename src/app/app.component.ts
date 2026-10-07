import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  template: `
    <header class="site-header">
      <a class="site-title" routerLink="/">{{ title }}</a>
    </header>
    <main class="site-main">
      <router-outlet />
    </main>
  `,
  styleUrl: './app.component.scss',
})
export class AppComponent {
  readonly title = 'Florida County Finance Explorer';
}
