# Working on this repository

Read `README.md` first: it documents the product, the configuration format, the deployment
contributions and the Nuxeo indexing rules. This file only covers what the README deliberately
leaves out, plus why the design is what it is.

## Commands

```bash
mvn clean install                 # builds everything and runs the Angular tests
mvn clean install -DskipTests     # skips them
```

Node is not a prerequisite: `frontend-maven-plugin` downloads a pinned version into
`nuxeo-labs-repository-dashboard-web/node/`. To run npm directly, put it on the path first,
otherwise you get the system node, which is too old for Angular 22:

```bash
cd nuxeo-labs-repository-dashboard-web
export PATH="$PWD/node:$PATH"
npm test          # vitest + jsdom
npm run build
npm run format    # prettier, run it before committing
npm start         # dev server on :4200, proxying /nuxeo to the server in .env
```

## Testing conventions

Everything lives in `src/testing/`.

- **`installFetchStub(routes)`** replaces `globalThis.fetch`. Routes match on a URL substring and,
  when needed, on the parsed request body: a dashboard issues its aggregation batch and its facet
  values query against the very same `_search` URL. Use the `isAggregationsRequest`,
  `isFacetValuesRequest` and `isHitsRequest` predicates rather than inventing new ones.
- **`ChartWidgetStubComponent`** replaces the real chart in component tests, through
  `TestBed.overrideComponent(WidgetOutletComponent, …)`. ECharts paints on a canvas that jsdom does
  not provide. Chart rendering is covered where it belongs: `buildChartOption` is a pure function
  and is unit tested directly. The stub renders the label and the hint, so hint interpolation stays
  observable.
- **`settle(fixture)`** drains the asynchronous work a page starts. The application is zoneless and
  talks to the server through plain `fetch`, so `whenStable()` alone does not know about those
  promises.
- **`setup.ts`** polyfills `ResizeObserver` and the modal behaviour of `<dialog>`, neither of which
  jsdom implements.

Name tests as statements of behaviour, not of implementation. A test that cannot observe what it
claims to verify is worse than no test: the range reminder passed silently until the chart stub
was made to render the hint.

## Traps

- **Never add `<require>org.nuxeo.web.ui</require>` to `dashboard-webresources-contrib.xml`.**
  Inside a component, `require` names a component, and no component is named `org.nuxeo.web.ui` —
  that is only the bundle symbolic name. The component stays pending and, since
  `nuxeo.start.strict` defaults to true, the server refuses to start. The file carries a comment
  saying so; leave it there.
- **Never append `.keyword` to a field.** Nuxeo maps strings straight to `keyword` through a
  dynamic template, so the suffix matches nothing, silently. `agg-compiler.ts` rejects it.
- **`_source` returns complex properties as objects** (`"file:content": { "length": … }`) while
  aggregations address them with a dotted name (`file:content.length`). `readSource` handles both.
  Verified against a live index.
- **`dc:title` is `text` with `fielddata: true`.** Never aggregate on it; read it from `_source`.
- **A `terms` aggregation is a top N, and an approximate one.** Each shard ranks locally and hands
  over `shard_size` candidates, `size * 1.5 + 10` by default, which is thin on the five shard audit
  index. `compileAgg` widens it to `max(size * 5, 100)` so the merged ranking is exact. The count of
  omitted values comes from a `cardinality` sibling, never from `sum_other_doc_count`, which counts
  documents rather than values.
- **`extended_bounds` must be epoch milliseconds, never a date string.** OpenSearch parses a string
  bound with the *aggregation's own* `format`, and every chart here declares `yyyy-MM-dd` to get
  readable bucket keys. An ISO instant therefore comes back as a 400, `unparsed text found at
  index 10`. This took the Users page down, and Content with it on any bounded period.
  `shipped-dashboards.spec.ts` guards it for every configuration that ships.
- **A proxy carries its target's blob.** Only `collectionMember` is proxy-local
  (`CoreExtensions.xml:91-93`); `file` is read through. Summing `file:content.length` over `all`
  therefore counts every proxy twice. `ecm:isProxy: false` is the only remedy.
- **A blob of unknown length is indexed as `-1`**, not as null nor as an absent key:
  `SimpleManagedBlob.getLength()` returns `-1` and the writer always emits the field
  (`JSONPropertyWriter.java:328`). A plain `sum` is reduced by one byte per such blob.
- **`thumb:thumbnail.*` and `picture:views.*` are mapped `index: false`**
  (`opensearch1-doc-mapping.json:3-18`). They sit in `_source`, so a table can read them, but no
  filter clause can reach them.

### The audit index

- **`comment` is `text` with no keyword sub-field** (`opensearch1-audit-mapping.json:29-37`): any
  aggregation on it fails outright. Every other field is a `keyword` posted by a single dynamic
  template (`:2-12`), so `eventId`, `principalName`, `category` and `docType` all aggregate.
  `extended.params` is `enabled: false` and is reachable by nothing.
- **Read `eventDate`, never `logDate`.** `logDate` is stamped when the journal is written, after
  commit (`AuditComponent.java:314`), so a long transaction bunches its entries onto one instant
  and the chart grows spikes that never happened.
- **`documentCreated` is also fired by a check-in and by a proxy creation**
  (`AbstractSession.java:1988,2150`), and nothing in the audit entry tells them apart. Counting it
  per user therefore includes versions and published proxies; the widget hint says so.
- **`principalName` is `getActingUser()`** (`UserPrincipal.java:209-211`): under impersonation it
  names the original user, not the borrowed identity. Correct for an audit, surprising otherwise.
- **A failed login carries the login that was typed.** `NuxeoAuthenticationFilter.java:182` builds
  the principal from the submitted name before knowing whether it is valid. Token authentication
  is the exception: `principalName` may be empty, the token landing in `comment` (`:197-199`), so
  an unnamed bucket can appear in the failed logins list. It is left visible on purpose — a list of
  authentication failures must not drop attempts in silence.
- **The `perf` server template disables `loginSuccess` and `logout`**, but not `loginFailed`
  (`templates/perf/.../audit-config.xml:3-8`). On such a server the Users page is half empty for a
  reason no message can explain.

## Invariants the tests protect

- **One request per dashboard.** Adding a widget must not add a round trip. Table widgets are the
  exception, because they need `hits`.
- **`AggConfig` stays a closed union.** No raw DSL reaches the server.
- **The composition scopes stay a partition**: `liveNotTrashed + trashed + versions + proxies` must
  equal `all`. A test evaluates the clauses against four synthetic documents rather than trusting a
  reading of the JSON.
- **The expiry tiles stay a partition too**: a document is counted by `expired`, `expiringWeek` or
  `expiring60`, never by two. The sixty day window starts at `gt: now+7d`, so J+7 belongs to the
  week alone. A reader adds these three figures up, so an overlap is a wrong answer, not a detail.
- **Grid rows fill whole lines**: the spans of a row sum to a multiple of twelve, for every date
  range.

## Verifying against a real server

A local Nuxeo is usually running. Ask the user for the URL and credentials, use them in the session
only, and **never write them to disk** — not in `.env`, not in a config file, not in a comment.
Read-only calls are enough: `POST /nuxeo/site/es/nuxeo/_search`, and `GET` on `/api/v1/me`,
`/capabilities`, `/user/{id}`, `/config/types/{name}`, `/ui/i18n/messages.json`.

This matters because the unit tests run against fixtures written from reading the Nuxeo sources,
which is circular. Confronting them with a real index is what found that `_source` nests blobs, that
`time_zone` was missing, and that `extended_bounds` cannot be a date string.

**Any newly emitted request shape must be run once against the real index before it is called
done.** A test asserting the shape of a payload proves only that we build what we meant to build,
never that OpenSearch accepts it — and it happily enshrines a mistake, as the `extended_bounds`
assertions did. The cheapest way is a throwaway spec that plans the request with the real planner
and `fetch`es it at `POST /nuxeo/site/es/{index}/_search`, credentials read from the environment,
deleted once it has answered.

Two paths the current test dataset cannot exercise, so do not read a passing run as proof:

- **`time_zone`** — the documents were all created between 07:00 and 12:00 UTC, so no bucket moves.
  To prove the parameter is honoured, use a control zone at UTC−10.
- **"N targeting trashed"** on proxies — it needs a proxy on a *live* document that is then
  trashed. Proxies on versions inherit the version's flag, which stays false.

**The audit index of the sandbox is partly fabricated, so it proves nothing about the platform.**
It was rewritten to make the Users dashboard worth looking at: on `documentCreated` and
`documentModified`, `principalName` and `eventDate` were taken from the target document rather than
from the action that really happened, and the login events were generated outright. A distribution
or a daily curve observed there reflects what we wrote, not how Nuxeo behaves — inferring the
second from the first is the same circularity this section warns against. The state before that
rewrite is kept in the `nuxeo-audit-backup-20260918` index.

## Design decisions, and why

Do not undo these without knowing what they were for.

| Decision | Reason |
| --- | --- |
| One request per dashboard, via `filter` aggregations | The passthrough exposes no `_msearch`. Web UI's dataviz elements issue one request per element; the cookbook's overview widget makes seven for one card |
| Aggregations named after the widget, not Web UI's `by` key | With `by`, two widgets in one request would write to the same place. The naming is what makes batching possible |
| `AggConfig` as a closed union rather than raw DSL | A JSON file an administrator can edit is not the same trust boundary as a Polymer template written by a developer. The passthrough forwards an administrator payload verbatim, `script` included |
| OR between document types and facets, AND between groups | They are two alternative classifications of the same dimension. `File AND Picture facet` is empty in stock Nuxeo, since `File` does not declare that facet |
| "All selected" compiles to *no clause*, never to every value | Otherwise a fully selected member swallows its siblings, and a facet filter does nothing while all types stay checked |
| Scopes taken out of `baseFilter` | A widget can only narrow the shared query. With the live-document filter shared, the total could never count versions and proxies |
| No "trashed" line under the Total tile | Proxies inherit `ecm:isTrashed` from their target, so a repository-wide count differs from the Trashed tile, with no visible explanation |
| IANA zone name rather than a fixed offset for `time_zone` | Correct on both sides of a daylight saving change, which `+02:00` is not. Web UI's element uses the offset |
| No Nuxeo JS client | CommonJS, not tree-shakable; it would pull batch upload, directories and OAuth2 for three call shapes. A `fetch` wrapper is enough |
| No implicit exclusion of technical documents | Explicit user decision: a customer creating five `Domain` objects has reasons to see them counted. The type filter is the tool, and it is persisted |
| Configuration stored in `src/app/config/dashboards/`, copied to assets | The tests import the file that actually ships, so it cannot drift from what is tested |
| Records and legal holds moved from Content to Governance | User decision. They answer a compliance question, not a volumetry one, and Governance is where retention lives |
| Governance reachable even without `nuxeo-retention` | A greyed out entry cannot tell the reader which package to install. The page names it and links to its documentation. Workflows follows the same rule since phase 4 |
| A period is two inclusive calendar days, not date math | Only concrete days can be shown in, and edited through, the two date fields. `gte` at the start of the first day, `lt` at the start of the day after the last: the final evening is covered without a `23:59:59.999` fudge |
| `extended_bounds` derived from the filter, never configured | A histogram only spans the days holding a document, so a quiet start of period silently shortens the chart. Deriving it keeps `AggConfig` closed, and it is applied only to the field the date filter constrains — for any other field the selected days say nothing |
| The failed logins list resolves no name | The value is evidence: whether `admin` or `Admin` was typed matters, and a prettified name would hide it. It also spares ten doomed `/api/v1/user` lookups per run |
| A truncated bucket list says so, with a count | Ten bars out of forty-seven users read as the whole team. The line is derived, so it is silent on a small repository and speaks on a large one. Content already hides eight document types out of eighteen |
| `shard_size` widened rather than left to OpenSearch | The default candidate list makes a top ten merely plausible across five shards. Derived like `extended_bounds`, so no configuration can weaken it |
| Facet values compiled by `agg-compiler` too | Its header claims to be the only place aggregation JSON is produced. `facet-values.service.ts` quietly made its own, and so escaped every guarantee the compiler gives |
| `LabelService` caches the promise, not the answer | Widgets resolve their buckets in parallel, so three charts naming the same author start before any has replied. Caching the answer deduplicates nothing at that moment |

## Blob volumetry, set aside

Asked for: a "Total Size" and a "Live Docs Size" tile, deduplicated, over *every* blob field rather
than `file:content` alone. Investigated, then set aside. Do not walk this road again from scratch.

**Why a plain sum does not answer the question.** A version holds its own copy of the blob
(`DBSSession.java:577-625`) while the store keeps one object per digest. A document versioned ten
times without changing its file is counted eleven times. That is not an imprecision, it is an order
of magnitude.

**Why the cookbook's method does not scale.** Its `repository-overview` widget
(`nuxeo-studio-community-cookbook`, `repository-overview-analytics-behavior.html:209-228`) groups by
`file:content.digest` with `"size": 1000000000`, then adds the buckets with `sum_bucket`. OpenSearch
caps bucket counts at `search.max_buckets`, 65,536 by default, and Nuxeo sets it nowhere in the LTS
2025 tree. Past roughly 65,000 distinct blobs the request fails with `too_many_buckets_exception`.

**Why `composite` does not rescue it.** It pages correctly through `after_key`, and the passthrough
forwards it verbatim for an administrator (`RequestValidator.java:94-105`). But several `sources`
produce the cartesian product of their values, not their union, so one pagination per blob field is
needed; without an index sorted on the digest, every page rescans the whole filtered set, so the
cost is *pages × scan*; deduplicating across fields would mean holding every digest in browser
memory; and the renditions, which weigh the most on a media repository, are `index: false`. On top
of that the passthrough has a 20 s socket timeout with no retry at all
(`OpenSearchRestClientFactory.java:56`, `OpenSearchRestClient.java:298-305`).

**The road to take if the subject comes back.**
`DELETE /api/v1/management/blobs/orphaned?dryRun=true` starts a bulk action; polling
`GET /api/v1/management/bulk/{commandId}` then yields `result.totalSize`, the real size of the blob
store, and `result.deletedSize`, its orphaned share. `GarbageCollectOrphanBlobsAction.java:114-119`
accumulates every blob it walks, not just the orphans. Deduplicated by construction, exhaustive
without knowing a single schema, and `dryRun` deletes nothing (`TestBlobsObject.java:171`). The
management API is reachable by default: the port check falls back to the standard HTTP port
(`ManagementObject.java:84-89`) and an administrator always passes (`:92-95`).
Constraints: it needs the `queryBlobKeys` capability, hence MongoDB — VCS/SQL answers 501 — which
`GET /api/v1/capabilities` reports without any side effect; providers in `recordMode` are skipped
unless `records=true`; it is a full scan of the storage, so it must be triggered explicitly; and it
is asynchronous. Above all, **the figure ignores the date range and the type filter**: it is a
storage truth, not a documentary one. It needs a card of its own, outside the filtered grid, never
a tile among the others.

**Two more facts worth keeping.** `GET /api/v1/config/schemas` returns, in one call, every schema
with its fields typed, a blob being literally `"blob"` or `"blob[]"`
(`SchemaJsonWriter.java:120,140`): discovering blob fields is trivial, summing them is not. And
`ecm:blobKeys` is **not** indexed — NXQL and DBS storage only — so there is no shortcut there. If
`nuxeo-quota` is installed, `dss:innerSize`, `dss:sizeVersions` and `dss:sizeTrash` are indexed
`long` fields that a plain `sum` can aggregate while honouring the dashboard filters; not
deduplicated, but the only route to a volume without a heavy operation.

## Phase 4: the Workflows dashboard

Built and shipped. The page is `workflows.json`, reachable at `/workflows`; the name "Process" is
gone everywhere. These are the facts that cost the most to establish — most were settled before a
line was written, a few only once the code met the real index.

**The passthrough hides five of the thirteen audited workflow events.**
`RoutingAuditRequestFilter` injects `term: { category: "Routing" }` for *every* caller,
administrators included (`RoutingAuditRequestFilter.java:90-93`). Five events are fired with no
explicit category and therefore default to `eventDocumentCategory` (`AuditComponent.java:430-431`):
`workflowTaskAssigned`, `workflowTaskReassigned`, `workflowTaskCompleted`, `workflowTaskDelegated`
and `auditLogRoute`. They are audited, they sit in the index, and `audit_wf` will never return them.
Only these eight are reachable: `afterWorkflowStarted`, `afterWorkflowFinish`,
`beforeWorkflowCanceled`, `workflowCanceled`, `afterWorkflowTaskCreated`, `afterWorkflowTaskEnded`,
`afterWorkflowTaskReassigned`, `afterWorkflowTaskDelegated`. Corollary: `extended.directive` and
`extended.dueDate` are declared only on the excluded events, so no task directive and no due date
can ever be read through this view. `workflows-dashboard.spec.ts` holds that list and asserts every
scope is built out of it.

**There is no workflow state field.** State is derived from event ids, which is what the `scopes`
of `workflows.json` encode: started is `afterWorkflowStarted`, completed is `afterWorkflowFinish`,
cancelled is `beforeWorkflowCanceled`. Prefer that last one to `workflowCanceled`, which is fired
once per attached document and therefore multiplies. Unlike `content.json`, these scopes are **not
a partition** — three reachable events are counted by none of them — so the test asserts mutual
exclusivity only, never exhaustiveness. A trustworthy "currently running" figure cannot come from
the audit at all: it needs `DocumentRoute` with `ecm:currentLifeCycleState = 'running'` on the
`nuxeo` index, hence a second request on another index, which the planner does not support today —
one index per dashboard. That is why the Started tile says "not instances running now".
`docLifeCycle` looks like a substitute and is not: it is a snapshot at event time, and on task
events it describes the `RoutingTask`, not the route.

**Aggregatable `extended.*`**, all `keyword` unless noted: `modelName` (the primary dimension),
`modelId`, `workflowInitiator`, `taskActor`, `taskName`, `action`, and `comment` — note that
`extended.comment` aggregates while the top level `comment` does not. Plus `timeSinceWfStarted` and
`timeSinceTaskStarted`, both **`long`, in milliseconds** (`RoutingAuditHelper.java:79,92`), and
absent rather than negative when the helper cannot find the start event. `workflowVariables.*`,
`nodeVariables.*` and `data.*` are nested objects typed leaf by leaf, so what they offer depends on
the Studio model.

**Which event carries which field**, verified in the sources rather than guessed.
`afterWorkflowFinish` carries `timeSinceWfStarted`, `workflowInitiator`, `modelName`, `modelId` and
`workflowVariables`, and **no** `taskName` or `action` (`DocumentRouteImpl.java:55-75`) — which is
what makes the Average Duration tile legitimate on the completed scope. `afterWorkflowTaskEnded`
carries both durations plus `taskName`, `action`, `taskActor` and the variables
(`GraphRunner.java:130-155`).

**`extended.taskName` is an i18n key, `extended.action` is not.** A task name really is
`wf.parallelDocumentReview.chooseParticipants.title`, which the Web UI bundle renders as "Choose
Participants" — hence the `message` label strategy. But `action` is `status`, the button's `name`
(`GraphRunner.java:136`): `approve`, `reject`, `validate`, `NA`, `start_review`, `submit`. The i18n
key lives in the button's `label` (`ParallelDocumentReview/Task328d/document.xml:27-30`) and never
leaves the model definition. `taskOutcomes` therefore declares no strategy at all, and a test says
so, because a strategy there would promise a translation that can never happen.

**The `workflowModel` key is not composed by the platform, it is written by Studio.** Nothing in
`nuxeo-platform-document-routing` builds `wf.<lcfirst(name)>.<name>`; Studio writes it into the
model's `dc:title` at generation time, and the bundle carrying it belongs to the Studio project,
not to Web UI. Nuxeo's own test fixtures — `MainWF`, `ChildWF`, `myRoute` — carry a literal title
instead, and the dataviz demo's `TravelExpenseValidation` names a task `wf.travelExpenses.create`,
whose prefix does not even match its model. The convention is therefore observed on the two shipped
models and guaranteed nowhere. That is why `translateWorkflowModel` falls back to
`splitIdentifier`: an untranslated `ClaimReview` reads "Claim Review" rather than sitting next to
"Parallel Document Review" as a bare identifier. Web UI has the same problem and does not solve it
— `nuxeo-tasks-list.js:141` calls `i18n(task.workflowModelName)` on a value that is not a key.

**`docType` and `docUUID` name the route or the task, never the business document.** On the real
index `docType` only ever holds `DocumentRoute` or `RoutingTask`, so a "documents entering a
workflow" widget is impossible from this view; it was designed, then dropped for that reason. The
same fact kills the idea of a table linking back to Web UI: the planner forces `ecm:uuid` into
`_source` (`query-planner.ts:320`), which the audit does not have, and `docUUID` would point at the
route anyway.

**Three traps in the field list.** `extended.actors` is a `keyword[]` on
`afterWorkflowTaskReassigned` but a single string `"[bob, alice]"` on `afterWorkflowTaskCreated`,
because a `LinkedHashSet` falls through to `toString()` (`LogEntryJsonWriter.java:187-203`) — never
aggregate it across both events. `extended.taskActor` mixes `getActingUser()` and
`getOriginatingUser()` depending on the event (`GraphRunner.java:139` against `:408`), so it is
simply absent when nobody impersonates; `topTaskPerformers` reads `principalName` instead. And the
dynamic template's `ignore_above: 256` drops a long `taskName` or variable from every aggregation,
silently.

**Neither duration field is in the mapping**, and the only dynamic template matches strings
(`match_mapping_type: "string"` → `keyword`). The first document written therefore fixes the type
for good: a JSON number gives `long`, a quoted number gives `keyword` and every `avg` fails until
the index is rebuilt. This matters to anyone fabricating entries — see below.

**Non-administrators see only the models they hold `DataVisualization` on**
(`RoutingAuditRequestFilter.java:95-108`, permission declared in
`document-routing-security-contrib.xml:9-11`). An empty permission set compiles to
`terms: { "extended.modelName": [] }`, so zero hits rather than an error. The dashboard requires an
administrator anyway, but a screenshot taken as somebody else will look broken for this reason.

**The workflow data on the demo server is fabricated, and proves nothing about the platform.**
`audit_wf` held twenty genuine entries: ten `afterWorkflowStarted` and ten
`afterWorkflowTaskCreated`, all signed `Administrator`, all within 514 milliseconds of one another
on 2026-09-18. Nothing had ever completed or been cancelled, so every duration widget rendered
empty. 2173 entries covering 450 instances over 88 days were generated and bulk loaded straight
into OpenSearch — the passthrough is read only and rejects any index it does not declare, so it
cannot serve for this; OpenSearch is not published on a host port either, and is reached through
`docker exec` on the `opensearch` container. The state before that load is kept in
`nuxeo-audit-backup-20260919`, and fabricated entries all carry an `id` at or above 900000, which
is how they can be removed again. The generated actors are `Josh`, `Julie`, `alan`, `johni` and
`kate`: `test-ai` is the agent's own account, and `Administrator` was left out so that his ten
genuine workflows do not put him at the top of a list he has no business leading. **A distribution
or a daily curve read there reflects what was written, not how Nuxeo behaves.**

**Three of the five models on that server exist in no repository.** Only
`ParallelDocumentReview` and `SerialDocumentReview` are deployed; `RequestDownload`, `AdHoc` and
`ClaimReview` live in the audit index and nowhere else. This works because the dashboard reads
`audit_wf` and only `audit_wf` — it never checks that a model exists, and the filter builds its own
list by aggregating `extended.modelName`. Two consequences worth knowing before a demo: filtering
on "Claim Review" leads to no document anybody can open in Web UI, and the Started tile counts
events rather than instances that exist. The three invented models name their tasks in plain words
(`Assess Claim`, `Approve Download Request`) rather than with an i18n key, because a key nobody
translates would render as `wf.claimReview.assessClaim.title` on screen. Their durations are
deliberately spread apart — `RequestDownload` settles in hours, `ClaimReview` drags on for weeks —
so that the duration histogram has more than one populated bucket.

## Style

Comments explain *why*, never *what*. Prefer no comment to one that restates the code, and fix a
comment whose justification is wrong — one claimed OpenSearch flattens blobs, which it does not.

No emoji. Four-space indentation does not apply here; Prettier owns formatting.

Answer the user in French, using *vous*.

## Where things stand

Phase 4 is complete: build green, 283 tests, package produced. Content, Users, Workflows and
Diagnostics are live; Governance is the last placeholder, and it names its missing prerequisite.
The work is pushed to `github.com/ThibArg/nuxeo-labs-repository-dashboard`, a public backup until
the plugin is ready to be forked into `nuxeo-sandbox`; the README carries a warning saying so.

Three things landed outside `workflows.json` and are worth knowing about, because they are not
workflow specific:

- **`LabelStrategy` gained `message` and `workflowModel`.** Both read Web UI's bundle, like
  `doctype` and `lifecycle`. `message` falls back to the raw key; `workflowModel` falls back to the
  words of the identifier, for the reason given in the phase 4 section.
- **An average over an empty set now renders a dash, not a zero.** `metricUndefinedWhenEmpty`
  (`agg-compiler.ts`) marks `avg`, `min` and `max`; the plan carries the flag and `result-mapper`
  turns their `null` into `NaN`, which every formatter already renders as `—`. A count, a
  cardinality and a sum still answer zero, because zero is their correct value.
- **`ChartWidgetStubComponent` now renders resolved bucket labels.** It swallowed them before, so a
  broken `LabelStrategy` passed in silence — the same blind spot the hint had. A chart test can now
  observe what it claims to verify.

**Phase 5, the Governance dashboard, is what comes next.** It must start by taking the record and
legal hold tiles out of Content. Then phase 2 (cross filtering on bucket click, active filter chips,
path scope, CSV and PNG export) and phase 3 (configuration editor with a field picker fed by
`/api/v1/config/schemas`).

The `DataTableComponent` is still unused by any shipped configuration — the expired documents table
was removed on request, and Workflows deliberately carries no table, since `docUUID` names the route
rather than the business document. It is kept, and tested, for phase 5.

Blob size tiles were asked for, investigated and set aside; the findings are recorded above, under
"Blob volumetry, set aside". Read that section before answering any question about blob volume.
