import { Injectable, computed, inject, signal } from '@angular/core';
import { formatDay, toLocalDay } from '../config/dashboard-config.model';
import { compileMetric } from '../engine/agg-compiler';
import { NuxeoHttpError, NuxeoHttpService, SEARCH_CANCEL_AFTER } from './nuxeo-http.service';
import { NxCapabilities, NxCurrentUser } from './nuxeo.types';

export type CheckStatus = 'pending' | 'ok' | 'warning' | 'failed';

export interface PreflightCheck {
  id: string;
  label: string;
  status: CheckStatus;
  /** Shown when the check is not `ok`. */
  detail?: string;
  /** Concrete remediation, typically a nuxeo.conf property or a package to install. */
  remedy?: string;
  /** A failing blocking check prevents the dashboard from rendering at all. */
  blocking: boolean;
}

export interface PreflightResult {
  checks: PreflightCheck[];
  user?: NxCurrentUser;
  capabilities?: NxCapabilities;
  /** Feature flags derived from the checks, consumed by the navigation. */
  features: {
    repository: boolean;
    audit: boolean;
    workflow: boolean;
    retention: boolean;
  };
  /**
   * Earliest instant the audit holds, in epoch milliseconds, or null when it holds nothing or was
   * not reached. Where every figure read from the audit starts, whatever the period says.
   */
  auditHorizon: number | null;
}

/** Name of the aggregation reading where the audit starts. */
const HORIZON_AGG = 'horizon';

/**
 * Verifies, before rendering anything, that the server actually offers what the dashboard needs,
 * and turns each missing prerequisite into an actionable message.
 *
 * This matters because the OpenSearch passthrough is optional in LTS 2025: it is only enabled by
 * the `opensearch1-search-client` template, the `audit` index is administrator-only, and the
 * Retention addon is a separate marketplace package.
 */
@Injectable({ providedIn: 'root' })
export class PreflightService {
  private readonly http = inject(NuxeoHttpService);

  private readonly state = signal<PreflightResult | null>(null);
  private readonly running = signal(false);

  readonly result = this.state.asReadonly();
  readonly isRunning = this.running.asReadonly();

  readonly isReady = computed(() => {
    const result = this.state();
    return !!result && !result.checks.some((c) => c.blocking && c.status === 'failed');
  });

  async run(): Promise<PreflightResult> {
    this.running.set(true);
    try {
      const checks: PreflightCheck[] = [];

      const user = await this.checkAuthentication(checks);
      const capabilities = await this.checkCapabilities(checks, !!user);
      const repository = await this.checkRepositoryIndex(checks, !!user);
      const audit = await this.checkAuditIndex(checks, capabilities, !!user);
      const workflow = await this.checkWorkflowIndex(checks, !!user);
      const retention = await this.checkRetentionAddon(checks, !!user);

      const result: PreflightResult = {
        checks,
        user: user ?? undefined,
        capabilities: capabilities ?? undefined,
        features: { repository, audit: audit.reachable, workflow, retention },
        auditHorizon: audit.horizon,
      };
      this.state.set(result);
      return result;
    } finally {
      this.running.set(false);
    }
  }

  private async checkAuthentication(checks: PreflightCheck[]): Promise<NxCurrentUser | null> {
    try {
      const user = await this.http.get<NxCurrentUser>('me');

      if (user.isAnonymous) {
        checks.push({
          id: 'auth',
          label: 'Authenticated session',
          status: 'failed',
          blocking: true,
          detail: 'The current session is anonymous.',
          remedy: `Sign in at ${this.http.serverRoot}/login.jsp and reload this page.`,
        });
        return null;
      }

      checks.push({
        id: 'auth',
        label: 'Authenticated session',
        status: 'ok',
        blocking: true,
        detail: user.id,
      });

      checks.push(
        user.isAdministrator
          ? { id: 'admin', label: 'Administrator privileges', status: 'ok', blocking: true }
          : {
              id: 'admin',
              label: 'Administrator privileges',
              status: 'failed',
              blocking: true,
              detail: `${user.id} is not an administrator.`,
              remedy:
                'The dashboard reads unfiltered repository and audit aggregations, which the ' +
                'passthrough only exposes to administrators. Add the user to the administrators group.',
            },
      );

      return user;
    } catch (error) {
      checks.push({
        id: 'auth',
        label: 'Authenticated session',
        status: 'failed',
        blocking: true,
        detail: describeError(error),
        remedy: `Sign in at ${this.http.serverRoot}/login.jsp and reload this page.`,
      });
      return null;
    }
  }

  private async checkCapabilities(
    checks: PreflightCheck[],
    canCall: boolean,
  ): Promise<NxCapabilities | null> {
    if (!canCall) {
      checks.push(skipped('capabilities', 'OpenSearch passthrough enabled', true));
      return null;
    }

    try {
      const capabilities = await this.http.get<NxCapabilities>('capabilities');
      const enabled = capabilities.passthrough?.['elasticsearch'] === true;

      checks.push(
        enabled
          ? {
              id: 'capabilities',
              label: 'OpenSearch passthrough enabled',
              status: 'ok',
              blocking: true,
              detail: capabilities.server?.distributionVersion,
            }
          : {
              id: 'capabilities',
              label: 'OpenSearch passthrough enabled',
              status: 'failed',
              blocking: true,
              detail:
                capabilities.passthrough === undefined
                  ? 'The server does not report any passthrough capability.'
                  : 'Reported as disabled.',
              remedy:
                'Set nuxeo.passthrough.elasticsearch.enabled=true in nuxeo.conf. It is enabled by ' +
                'default by the opensearch1-search-client template, which must be active.',
            },
      );

      return capabilities;
    } catch (error) {
      checks.push({
        id: 'capabilities',
        label: 'OpenSearch passthrough enabled',
        status: 'failed',
        blocking: true,
        detail: describeError(error),
      });
      return null;
    }
  }

  private async checkRepositoryIndex(checks: PreflightCheck[], canCall: boolean): Promise<boolean> {
    if (!canCall) {
      checks.push(skipped('index-nuxeo', 'Repository index reachable', true));
      return false;
    }

    try {
      const response = await this.searchRepositoryOnce();
      checks.push({
        id: 'index-nuxeo',
        label: 'Repository index reachable',
        status: 'ok',
        blocking: true,
        detail: this.http.cancelsSearches
          ? `responded in ${response.took} ms; OpenSearch stops any search after ${SEARCH_CANCEL_AFTER}`
          : `responded in ${response.took} ms`,
      });
      if (!this.http.cancelsSearches) {
        checks.push({
          id: 'search-cancellation',
          label: 'Long searches stopped by OpenSearch',
          status: 'warning',
          blocking: false,
          detail:
            'The cluster refuses cancel_after_time_interval, which OpenSearch 1.1 introduced, so ' +
            'every search is sent without it.',
          remedy:
            'A search the dashboard has given up on runs to its end and holds its threads until ' +
            'then. Upgrading the cluster to OpenSearch 1.1 or later lets the dashboard stop it.',
        });
      }
      return true;
    } catch (error) {
      checks.push({
        id: 'index-nuxeo',
        label: 'Repository index reachable',
        status: 'failed',
        blocking: true,
        detail: describeError(error),
        remedy:
          'The nuxeo index is only exposed when the default search client is OpenSearch. Check ' +
          'that nuxeo.search.client.default.name=opensearch and that the index name matches ' +
          'nuxeo.search.client.default.opensearch1.index.name.',
      });
      return false;
    }
  }

  /**
   * The first search of the session, which is also where the cluster says whether it knows
   * `cancel_after_time_interval`.
   *
   * One older than OpenSearch 1.1 answers 400 to a parameter it does not know, relayed as a Nuxeo
   * 500 whose message quotes it: "contains unrecognized parameter: [cancel_after_time_interval]".
   * It would answer every search the same way, so the parameter is dropped for the session and
   * the search sent again. Any other failure is the index's, and is reported as such.
   */
  private async searchRepositoryOnce() {
    const probe = { size: 0, track_total_hits: true };
    try {
      return await this.http.search('nuxeo', probe);
    } catch (error) {
      const refused =
        error instanceof NuxeoHttpError &&
        error.body.includes('unrecognized parameter') &&
        error.body.includes('cancel_after_time_interval');
      if (!refused) {
        throw error;
      }
      this.http.stopCancellingSearches();
      return this.http.search('nuxeo', probe);
    }
  }

  private async checkAuditIndex(
    checks: PreflightCheck[],
    capabilities: NxCapabilities | null,
    canCall: boolean,
  ): Promise<{ reachable: boolean; horizon: number | null }> {
    const unreachable = { reachable: false, horizon: null };

    if (!canCall) {
      checks.push(skipped('index-audit', 'Audit index reachable', false));
      return unreachable;
    }

    if (capabilities && capabilities.passthrough?.['elasticsearch-audit'] !== true) {
      checks.push({
        id: 'index-audit',
        label: 'Audit index reachable',
        status: 'warning',
        blocking: false,
        detail: 'The audit passthrough is disabled.',
        remedy:
          'Activate the opensearch1-audit template and set ' +
          'nuxeo.passthrough.elasticsearch.audit.enabled=true. Audit based widgets stay hidden.',
      });
      return unreachable;
    }

    /*
     * The reachability probe also reads where the audit starts, which costs next to nothing only
     * as long as the request carries no query: OpenSearch then takes each segment's minimum from
     * its point index instead of visiting its entries (`AggregatorBase.pointReaderIfAvailable`
     * requires a `MatchAllDocsQuery` and no parent aggregation). A segment still holding entries a
     * `delete_by_query` removed may need a walk, until a merge rewrites it.
     */
    try {
      const response = await this.http.search('audit', {
        size: 0,
        aggs: { [HORIZON_AGG]: compileMetric({ min: 'eventDate' })! },
      });
      const earliest = response.aggregations?.[HORIZON_AGG]?.value ?? null;
      checks.push({
        id: 'index-audit',
        label: 'Audit index reachable',
        status: 'ok',
        blocking: false,
        detail:
          earliest === null
            ? `holds no event yet, responded in ${response.took} ms`
            : `holds events since ${formatDay(toLocalDay(new Date(earliest)))}, ` +
              `responded in ${response.took} ms`,
      });
      return { reachable: true, horizon: earliest };
    } catch (error) {
      checks.push({
        id: 'index-audit',
        label: 'Audit index reachable',
        status: 'warning',
        blocking: false,
        detail: describeError(error),
        remedy: 'Audit based widgets stay hidden.',
      });
      return unreachable;
    }
  }

  private async checkWorkflowIndex(checks: PreflightCheck[], canCall: boolean): Promise<boolean> {
    if (!canCall) {
      checks.push(skipped('index-audit-wf', 'Workflow audit view reachable', false));
      return false;
    }

    try {
      await this.http.search('audit_wf', { size: 0 });
      checks.push({
        id: 'index-audit-wf',
        label: 'Workflow audit view reachable',
        status: 'ok',
        blocking: false,
      });
      return true;
    } catch (error) {
      checks.push({
        id: 'index-audit-wf',
        label: 'Workflow audit view reachable',
        status: 'warning',
        blocking: false,
        detail: describeError(error),
        remedy: 'The Workflows dashboard is reduced to a notice naming the prerequisite.',
      });
      return false;
    }
  }

  private async checkRetentionAddon(checks: PreflightCheck[], canCall: boolean): Promise<boolean> {
    if (!canCall) {
      checks.push(skipped('retention', 'Retention addon installed', false));
      return false;
    }

    try {
      await this.http.get('config/types/RetentionRule');
      checks.push({
        id: 'retention',
        label: 'Retention addon installed',
        status: 'ok',
        blocking: false,
      });
      return true;
    } catch {
      checks.push({
        id: 'retention',
        label: 'Retention addon installed',
        status: 'warning',
        blocking: false,
        detail: 'The RetentionRule document type is not registered.',
        remedy:
          'Install the nuxeo-retention marketplace package to enable the Governance dashboard. ' +
          'Core record primitives remain available without it.',
      });
      return false;
    }
  }
}

function skipped(id: string, label: string, blocking: boolean): PreflightCheck {
  return { id, label, status: 'pending', blocking, detail: 'Skipped, a previous check failed.' };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
