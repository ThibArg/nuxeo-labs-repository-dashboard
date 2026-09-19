import { Routes } from '@angular/router';
import { DashboardPageComponent } from './pages/dashboard-page.component';
import { DiagnosticsPageComponent } from './pages/diagnostics-page.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'content' },
  {
    path: 'content',
    component: DashboardPageComponent,
    title: 'Content Dashboard',
    data: { dashboardId: 'content' },
  },
  {
    path: 'workflows',
    component: DashboardPageComponent,
    title: 'Workflows Dashboard',
    data: {
      dashboardId: 'workflows',
      requires: 'workflow',
      // As for Users, no documentation URL: Diagnostics carries the exact remedy.
      requirementLabel: 'the workflow audit passthrough',
    },
  },
  {
    path: 'tasks',
    component: DashboardPageComponent,
    title: 'Tasks Dashboard',
    data: { dashboardId: 'tasks', requires: 'repository' },
  },
  {
    path: 'users',
    component: DashboardPageComponent,
    title: 'Users Dashboard',
    data: {
      dashboardId: 'users',
      requires: 'audit',
      // No documentation URL: the Diagnostics page carries the exact remedy, and inventing one
      // would be worse than sending the reader there.
      requirementLabel: 'the OpenSearch audit passthrough',
    },
  },
  {
    path: 'governance',
    component: DashboardPageComponent,
    title: 'Governance Dashboard',
    data: {
      dashboardId: 'governance',
      /*
       * The page renders without the addon: ecm:isRecord, ecm:retainUntil and ecm:hasLegalHold are
       * core fields. Only the rule breakdown needs nuxeo-retention, so the notice explains what is
       * missing rather than hiding figures that are perfectly readable.
       */
      requires: 'retention',
      requirementLabel: 'the nuxeo-retention package',
      requirementDocUrl: 'https://doc.nuxeo.com/nxdoc/nuxeo-retention-management/',
    },
  },
  { path: 'diagnostics', component: DiagnosticsPageComponent, title: 'Diagnostics' },
  { path: '**', redirectTo: 'content' },
];
