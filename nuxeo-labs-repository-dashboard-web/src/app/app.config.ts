import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { provideDashboardCharts } from './widgets/echarts.setup';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    /*
     * Path based routing is used on purpose: deep links such as /nuxeo/dashboard/governance are
     * forwarded to index.jsp by the rewrite rule contributed in deployment-fragment.xml, so they
     * survive a hard refresh without a hash.
     */
    provideRouter(routes, withComponentInputBinding()),
    provideDashboardCharts(),
  ],
};
