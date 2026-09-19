import { Routes } from '@angular/router';
import { DashboardPageComponent } from './pages/dashboard-page.component';
import { DiagnosticsPageComponent } from './pages/diagnostics-page.component';
import { UpcomingPageComponent } from './pages/upcoming-page.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'content' },
  {
    path: 'content',
    component: DashboardPageComponent,
    title: 'Content Dashboard',
    data: { dashboardId: 'content' },
  },
  {
    path: 'process',
    component: UpcomingPageComponent,
    title: 'Process Dashboard',
    data: {
      heading: 'Process Dashboard',
      phase: 'phase 4',
      description:
        'Workflow volume, running and completed instances, overdue tasks, SLA compliance and ' +
        'average durations, aggregated from the audit_wf passthrough view ' +
        '(extended.timeSinceWfStarted, extended.timeSinceTaskStarted, extended.taskActor).',
    },
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
    component: UpcomingPageComponent,
    title: 'Governance Dashboard',
    data: {
      heading: 'Governance Dashboard',
      phase: 'phase 5',
      description:
        'Records and legal holds, moved here from the Content dashboard, alongside retention ' +
        'policies: ecm:isRecord, ecm:hasLegalHold, a date_range aggregation over ecm:retainUntil ' +
        'and record:ruleIds resolved against the RetentionRule documents.',
      requires: 'retention',
      requirementLabel: 'the nuxeo-retention package',
      requirementDocUrl: 'https://doc.nuxeo.com/nxdoc/nuxeo-retention-management/',
    },
  },
  { path: 'diagnostics', component: DiagnosticsPageComponent, title: 'Diagnostics' },
  { path: '**', redirectTo: 'content' },
];
