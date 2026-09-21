/**
 * Who is using the repository, read from the audit index.
 *
 * Every figure counts `principalName`, which the audit fills with the *acting* user rather than
 * with the session's own: an asynchronous Work, an unrestricted session or a bulk action counts
 * for the person who triggered it instead of piling onto `system`. It is not a protection against
 * impersonation, and the widgets that need to say so do.
 */
import { CalendarInterval, ChartWidgetType } from '../../config/dashboard-config.model';
import { topNChart, trendChart } from '../builders';
import { ParamSpecs, defineWidget } from '../definition';
import { DOCUMENT_CREATED, DOCUMENT_MODIFIED, LOGIN_FAILED, LOGIN_SUCCEEDED } from './populations';

const BUCKET_CHARTS = ['donut', 'pie', 'bar', 'hbar', 'ranked-list'] as const;
const TREND_CHARTS = ['area', 'line', 'bar'] as const;
const INTERVALS = ['hour', 'day', 'week', 'month', 'quarter', 'year'] as const;

interface PeopleParams {
  chart: ChartWidgetType;
  size: number;
}

interface ActivityParams {
  chart: ChartWidgetType;
  interval: CalendarInterval;
}

function peopleParams(chart: (typeof BUCKET_CHARTS)[number]): ParamSpecs {
  return {
    chart: { type: 'enum', values: BUCKET_CHARTS, default: chart, describe: 'How it is drawn.' },
    size: {
      type: 'number',
      default: 10,
      min: 1,
      max: 100,
      describe: 'How many people are listed. The chart says so when it leaves some out.',
    },
  };
}

const ACTIVITY_PARAMS: ParamSpecs = {
  chart: { type: 'enum', values: TREND_CHARTS, default: 'line', describe: 'How it is drawn.' },
  interval: {
    type: 'enum',
    values: INTERVALS,
    default: 'day',
    describe: 'Width of one bucket. Buckets are cut in the reader\u2019s own time zone.',
  },
};

/**
 * How many different people signed in, rather than how many times.
 *
 * A count of logins says as much about one person reconnecting all morning as about a team
 * arriving; a cardinality per bucket separates the two.
 */
export const distinctUsersPerDay = defineWidget<ActivityParams>({
  id: 'distinct-users-per-day',
  index: 'audit',
  title: 'Active Users',
  summary: 'How many different people signed in successfully, over time.',
  params: ACTIVITY_PARAMS,
  build: (params) =>
    trendChart({
      of: LOGIN_SUCCEEDED,
      field: 'eventDate',
      interval: params.interval,
      chart: params.chart,
      metric: { cardinality: 'principalName' },
      hint: 'Distinct users with a successful login ({range})',
    }),
});

export const topUsersByLogins = defineWidget<PeopleParams>({
  id: 'top-users-by-logins',
  index: 'audit',
  title: 'Most Active Users',
  summary: 'Who signed in the most often.',
  params: peopleParams('ranked-list'),
  build: (params) =>
    topNChart({
      of: LOGIN_SUCCEEDED,
      field: 'principalName',
      size: params.size,
      chart: params.chart,
      labels: 'user',
      hint: 'By number of successful logins',
    }),
});

/**
 * Failed logins, deliberately unresolved.
 *
 * The value is evidence rather than a name: whether `admin` or `Admin` was typed is the whole
 * point, and a prettified label would hide it. It also spares a lookup per value, most of which
 * would match no account at all.
 */
export const failedLogins = defineWidget<PeopleParams>({
  id: 'failed-logins',
  index: 'audit',
  title: 'Failed Logins',
  summary: 'Which logins were attempted and refused, exactly as they were typed.',
  params: peopleParams('ranked-list'),
  build: (params) =>
    topNChart({
      of: LOGIN_FAILED,
      field: 'principalName',
      size: params.size,
      chart: params.chart,
      hint: 'The login exactly as it was typed, which may match no account',
    }),
});

export const documentsCreatedByUser = defineWidget<PeopleParams>({
  id: 'documents-created-by-user',
  index: 'audit',
  title: 'Documents Created',
  summary: 'Who created the most documents, versions and publications included.',
  params: peopleParams('hbar'),
  build: (params) =>
    topNChart({
      of: DOCUMENT_CREATED,
      field: 'principalName',
      size: params.size,
      chart: params.chart,
      labels: 'user',
      hint: 'Versions and published proxies are counted too',
    }),
});

export const documentsModifiedByUser = defineWidget<PeopleParams>({
  id: 'documents-modified-by-user',
  index: 'audit',
  title: 'Documents Modified',
  summary: 'Who modified the most documents.',
  params: peopleParams('hbar'),
  build: (params) =>
    topNChart({
      of: DOCUMENT_MODIFIED,
      field: 'principalName',
      size: params.size,
      chart: params.chart,
      labels: 'user',
      hint: 'Server-side work counts for the user who triggered it',
    }),
});
