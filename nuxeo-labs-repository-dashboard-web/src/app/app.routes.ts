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
    path: 'governance',
    component: UpcomingPageComponent,
    title: 'Governance Dashboard',
    data: {
      heading: 'Governance Dashboard',
      phase: 'phase 5',
      description:
        'Records, retention policies and legal holds, built on ecm:isRecord, a date_range ' +
        'aggregation over ecm:retainUntil, ecm:hasLegalHold and record:ruleIds resolved against ' +
        'the RetentionRule documents.',
    },
  },
  { path: 'diagnostics', component: DiagnosticsPageComponent, title: 'Diagnostics' },
  { path: '**', redirectTo: 'content' },
];
