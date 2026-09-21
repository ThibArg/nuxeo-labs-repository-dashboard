import { Route, Routes } from '@angular/router';
import { DashboardPageComponent } from './pages/dashboard-page.component';
import { DiagnosticsPageComponent } from './pages/diagnostics-page.component';
import { PreflightFeature } from './layout/requirement-notice.component';

/**
 * What a route hands a dashboard page, declared so that it is type checked.
 *
 * `Route['data']` is `{ [key: string]: any }`, so `withComponentInputBinding()` binds whatever it
 * finds: a misspelt key silently becomes nothing, and a prerequisite that no longer exists becomes
 * `undefined`, which the notice reads as "missing" and announces over a perfectly healthy server.
 * Naming the shape here is what turns dropping a feature from `PreflightResult` — or dropping a
 * whole screen — into a compilation error at the line that names it.
 */
interface DashboardRouteData {
  dashboardId: string;
  requires?: PreflightFeature;
  /** What an administrator would go looking for, e.g. `the nuxeo-retention package`. */
  requirementLabel?: string;
  requirementDocUrl?: string;
}

function dashboard(path: string, title: string, data: DashboardRouteData): Route {
  return { path, component: DashboardPageComponent, title, data };
}

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'content' },
  dashboard('content', 'Content Dashboard', { dashboardId: 'content' }),
  dashboard('workflows', 'Workflows Dashboard', {
    dashboardId: 'workflows',
    requires: 'workflow',
    // As for Users, no documentation URL: Diagnostics carries the exact remedy.
    requirementLabel: 'the workflow audit passthrough',
  }),
  dashboard('tasks', 'Tasks Dashboard', { dashboardId: 'tasks', requires: 'repository' }),
  dashboard('users', 'Users Dashboard', {
    dashboardId: 'users',
    requires: 'audit',
    // No documentation URL: the Diagnostics page carries the exact remedy, and inventing one
    // would be worse than sending the reader there.
    requirementLabel: 'the OpenSearch audit passthrough',
  }),
  dashboard('governance', 'Governance Dashboard', {
    dashboardId: 'governance',
    /*
     * The page renders without the addon: ecm:isRecord, ecm:retainUntil and ecm:hasLegalHold are
     * core fields. Only the rule breakdown needs nuxeo-retention, so the notice explains what is
     * missing rather than hiding figures that are perfectly readable.
     */
    requires: 'retention',
    requirementLabel: 'the nuxeo-retention package',
    requirementDocUrl: 'https://doc.nuxeo.com/nxdoc/nuxeo-retention-management/',
  }),
  { path: 'diagnostics', component: DiagnosticsPageComponent, title: 'Diagnostics' },
  { path: '**', redirectTo: 'content' },
];
