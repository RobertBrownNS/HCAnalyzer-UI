import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { ANALYTICS_TOKEN, loadAnalytics } from './app/core/analytics';

bootstrapApplication(AppComponent, appConfig)
  // After the first render, so analytics never delays it (no-op without a build-time token).
  .then((app) => loadAnalytics(document, navigator, app.injector.get(ANALYTICS_TOKEN)))
  .catch((err) => console.error(err));
