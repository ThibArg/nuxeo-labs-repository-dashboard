/**
 * Populations of the audit index.
 *
 * The audit has no scopes and no base filter: an entry is an event, and which event it is decides
 * everything. So each population is a single `eventId`, stated by the widget that describes it
 * rather than named at the page level.
 *
 * Two of these count more than their name suggests, and the widgets using them say so on screen:
 * `documentCreated` is fired by a check-in and by a publication as well as by a creation, and
 * every figure here is credited to `principalName`, which the audit fills with the acting user —
 * so server-side work counts for whoever triggered it rather than for `system`.
 */
import { Predicate, equals } from '../predicates';

export const LOGIN_SUCCEEDED: Predicate[] = [equals('eventId', 'loginSuccess')];
export const LOGIN_FAILED: Predicate[] = [equals('eventId', 'loginFailed')];
export const DOCUMENT_CREATED: Predicate[] = [equals('eventId', 'documentCreated')];
export const DOCUMENT_MODIFIED: Predicate[] = [equals('eventId', 'documentModified')];
