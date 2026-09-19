import { Injectable, inject } from '@angular/core';
import {
  DashboardConfig,
  FilterState,
  TermsGroupConfig,
  selectionOf,
} from '../config/dashboard-config.model';
import { NuxeoHttpService } from '../core/nuxeo-http.service';
import { EsAggregation, EsBucket } from '../core/nuxeo.types';
import { canonicalPrincipal } from '../core/principal';
import { compileAgg } from './agg-compiler';
import { boolFilter } from './es-query';
import { globalFilters } from './query-planner';

export interface FacetValue {
  value: string;
  count: number;
}

export interface MemberValues {
  memberId: string;
  values: FacetValue[];
  /** True when the aggregation was truncated, meaning some values are missing from the list. */
  truncated: boolean;
  /**
   * Distinct values the field holds, so a truncated list can say how many it leaves out rather
   * than merely warning that it does. Counted on raw values, hence before any merge.
   */
  total?: number;
}

export type GroupValues = Map<string, MemberValues>;

/** Distinct values fetched per member. The OpenSearch default of 10 would be useless here. */
const DEFAULT_SIZE = 200;

/**
 * Fetches the candidate values of a filter group, with their document counts.
 *
 * Two things matter here.
 *
 * First, every member of a group is aggregated in one request: a group of two lists still costs
 * a single round trip.
 *
 * Second, the query deliberately excludes the constraints of the group being described. Were it
 * to include them, unchecking a type would remove it from its own list, and checking a facet
 * would make the type counts jump around while the dialog is open. Excluding the whole group,
 * rather than only the member being rendered, is what keeps both lists stable.
 */
@Injectable({ providedIn: 'root' })
export class FacetValuesService {
  private readonly http = inject(NuxeoHttpService);
  private readonly cache = new Map<string, Promise<GroupValues>>();

  /**
   * @param signature identifies the filters the values depend on. Changing the date range must
   *                  change it; changing the selection inside the group must not.
   */
  load(
    config: DashboardConfig,
    group: TermsGroupConfig,
    filters: FilterState,
    signature: string,
  ): Promise<GroupValues> {
    const key = `${config.id}:${group.id}:${signature}`;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.fetch(config, group, filters).catch((error) => {
        // Never cache a failure: the next refresh must retry.
        this.cache.delete(key);
        throw error;
      });
      this.cache.set(key, pending);
    }
    return pending;
  }

  invalidate(): void {
    this.cache.clear();
  }

  /** Signature of everything a group's values depend on, i.e. the filters minus the group itself. */
  static signatureOf(
    config: DashboardConfig,
    group: TermsGroupConfig,
    filters: FilterState,
  ): string {
    return JSON.stringify(globalFilters(config, filters, group.id));
  }

  private async fetch(
    config: DashboardConfig,
    group: TermsGroupConfig,
    filters: FilterState,
  ): Promise<GroupValues> {
    // Compiled rather than hand written, so these lists inherit every guarantee the compiler
    // makes: no `.keyword` suffix, and a shard size wide enough for an exact merge.
    const aggs = Object.fromEntries(
      group.members.flatMap((member) => [
        [
          member.id,
          compileAgg({ terms: { field: member.field, size: member.size ?? DEFAULT_SIZE } }),
        ],
        // Counts what the top N had to choose from, as the widget planner has always done.
        [distinctKey(member.id), { cardinality: { field: member.field } }],
      ]),
    );

    const response = await this.http.search(config.index, {
      size: 0,
      query: boolFilter(globalFilters(config, filters, group.id)),
      aggs,
    });

    const result: GroupValues = new Map();

    for (const member of group.members) {
      const aggregation = response.aggregations?.[member.id] as EsAggregation | undefined;
      const buckets = Array.isArray(aggregation?.buckets)
        ? (aggregation.buckets as EsBucket[])
        : [];

      const returned: FacetValue[] = buckets.map((bucket) => ({
        value: String(bucket.key_as_string ?? bucket.key),
        count: bucket.doc_count ?? 0,
      }));

      /*
       * A principal reaches the index under two forms, so the list would otherwise offer the same
       * person twice, each with part of their tasks. See `core/principal.ts`.
       */
      const values = member.labels === 'user' ? mergePrincipalValues(returned) : returned;

      /*
       * A value the user selected may be absent from the index right now, typically after a
       * cleanup or when a persisted selection is restored. Keeping it in the list with a zero
       * count means a stored selection is never silently dropped.
       */
      const selection = selectionOf(filters, group.id, member.id);
      if (selection.mode === 'subset') {
        const present = new Set(values.map((entry) => entry.value));
        for (const missing of selection.values.filter((value) => !present.has(value))) {
          values.push({ value: missing, count: 0 });
        }
      }

      const distinct = (
        response.aggregations?.[distinctKey(member.id)] as EsAggregation | undefined
      )?.value;

      result.set(member.id, {
        memberId: member.id,
        values,
        truncated: (aggregation?.['sum_other_doc_count'] as number | undefined) ? true : false,
        ...(typeof distinct === 'number' ? { total: distinct } : {}),
      });
    }

    return result;
  }
}

/**
 * Collapses the two forms of a principal onto one entry, adding their counts.
 *
 * Ordered by count so the busiest come first, which is also what the merged list is asked for.
 */
function mergePrincipalValues(values: FacetValue[]): FacetValue[] {
  const merged = new Map<string, FacetValue>();

  for (const entry of values) {
    const value = canonicalPrincipal(entry.value);
    const current = merged.get(value);
    if (current) {
      current.count += entry.count;
    } else {
      merged.set(value, { value, count: entry.count });
    }
  }

  return [...merged.values()].sort((a, b) => b.count - a.count);
}

/** Name of the sibling counting distinct values, kept out of the member id namespace. */
function distinctKey(memberId: string): string {
  return `${memberId}__distinct`;
}
