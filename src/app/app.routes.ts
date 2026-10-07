import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./explorer/explorer.component').then((m) => m.ExplorerComponent),
  },
  { path: '**', redirectTo: '' },
];
