/**
 * Where the audit starts, and what that does to the figures read from it.
 *
 * The repository keeps its documents; the audit does not. Many installations archive it and start
 * again from an empty index, or purge its older entries, and LTS 2025 has neither retention nor
 * rollover to do it for them, so it is done by hand and nothing records that it was. What survives
 * is the earliest entry the index still holds, and that is the only horizon the dashboard can know.
 *
 * Left unsaid, it misleads three ways. "All time" means since the repository was created on
 * Content and since the last purge on Users; a period straddling the purge draws the days before it
 * as days nothing happened; and a workflow started before the purge and finished after it carries
 * no duration, so for months the durations describe only the workflows short enough to fit.
 */
import {
  DashboardConfig,
  DateRangeOption,
  dashboardIndices,
  dateRangeOption,
  formatDay,
  formatDayRange,
  toLocalDay,
} from '../config/dashboard-config.model';
import { EsIndex } from '../core/nuxeo.types';
import { dateFieldFor } from './query-planner';

/** First local day each index still holds, for the indices that do not keep everything. */
export type IndexHorizons = Partial<Record<EsIndex, string>>;

/**
 * The two names the passthrough gives the audit.
 *
 * `audit_wf` is the same index narrowed to workflow events, so it starts where `audit` does.
 */
const AUDIT_INDICES: EsIndex[] = ['audit', 'audit_wf'];

/**
 * Horizons of the audit indices, from the earliest instant the audit holds.
 *
 * Read as a local day, as the period is: an entry written at 23:30 UTC belongs to the next day in
 * Paris, and the period that should include it is written in Paris days.
 */
export function auditHorizons(earliest: number | null | undefined): IndexHorizons {
  if (earliest === null || earliest === undefined) {
    return {};
  }
  const day = toLocalDay(new Date(earliest));
  return { audit: day, audit_wf: day };
}

/**
 * How a period meets the first day an index holds.
 *
 * `after` loses nothing. `across` asks for days the index no longer has, which is what "All time"
 * always does. `before` asks only for such days, so every figure it gives is a zero.
 */
export type HorizonReach = 'after' | 'across' | 'before';

export function horizonReach(range: DateRangeOption, horizon: string): HorizonReach {
  if (range.to && range.to < horizon) {
    return 'before';
  }
  return !range.from || range.from < horizon ? 'across' : 'after';
}

/**
 * The period an index's figures actually cover: the one chosen, begun no earlier than the index.
 *
 * "Last 12 months" over an audit purged in March covers March onwards, and a tile saying otherwise
 * misstates its own figures. A period lying wholly before the horizon is left as chosen: it covers
 * nothing, and a label naming days nobody asked for would be harder to read than the notice saying
 * so.
 */
export function coveredRange(range: DateRangeOption, horizon: string | undefined): DateRangeOption {
  if (!horizon || horizonReach(range, horizon) !== 'across') {
    return range;
  }
  return { ...range, from: horizon, label: formatDayRange(horizon, range.to) };
}

export interface HorizonNotice {
  text: string;
  /** True when the period asks for days the audit no longer holds. */
  warn: boolean;
}

/**
 * What a page reading the audit tells its reader about where the audit starts, or null when it
 * reads none or that start is unknown.
 *
 * Said on every such page, not only when the period reaches before it: a reader choosing "Last 12
 * months" needs to know beforehand that the audit may not hold twelve. A page the period does not
 * constrain on the audit reads all of it, which is the same as "All time".
 */
export function horizonNotice(
  config: DashboardConfig,
  range: DateRangeOption,
  horizons: IndexHorizons,
): HorizonNotice | null {
  const indices = dashboardIndices(config);
  const audit = indices.find((index) => AUDIT_INDICES.includes(index) && horizons[index]);
  if (!audit) {
    return null;
  }

  const horizon = horizons[audit]!;
  const since = formatDay(horizon);
  const period = dateFieldFor(config, audit) ? range : dateRangeOption('all');
  const reach = horizonReach(period, horizon);

  const sentences: string[] = [];
  if (reach === 'before') {
    sentences.push(
      `This period ends before the audit starts, on ${since}: nothing in it was kept, so the ` +
        'audit figures read zero.',
    );
  } else if (reach === 'across' && !period.from) {
    sentences.push(
      `"${period.label}" here starts on ${since}, the earliest event the audit holds. Anything ` +
        'earlier was purged, archived or never recorded, and is not counted.',
    );
  } else if (reach === 'across') {
    sentences.push(
      `This period starts before the audit does: nothing earlier than ${since} is kept, so the ` +
        'figures begin there. Anything before was purged, archived or never recorded.',
    );
  } else {
    sentences.push(`The audit holds events from ${since} onwards.`);
  }

  /*
   * Content has no horizon, the repository keeping its documents, so on a page reading both the
   * two halves do not go back to the same day, and a reader comparing them has to be told.
   */
  if (indices.includes('nuxeo')) {
    sentences.push('The repository figures are not bounded by it.');
  }
  /*
   * A workflow's duration is computed by Nuxeo when it ends, by reading its start back from the
   * audit, and left out when the start is gone. Such a workflow still counts as completed, so the
   * bias is invisible in the counts and lasts as long as the longest workflow does. "May": one that
   * ended before the purge ran had its start read while it was still there.
   */
  if (indices.includes('audit_wf')) {
    sentences.push(
      `A workflow started before ${since} may carry no duration, which leans the durations ` +
        'towards the shorter ones.',
    );
  }

  return { text: sentences.join(' '), warn: reach !== 'after' };
}
