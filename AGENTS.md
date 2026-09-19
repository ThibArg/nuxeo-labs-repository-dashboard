# Working on this repository

Read `README.md` first. It documents the product, the configuration schema, the deployment
contributions, the label strategies and — under "Indexing rules worth knowing" and "Who an action
is credited to" — every field-level trap the queries depend on. This file carries only what the
README does not: how to drive the build, how the tests are wired, what must not be undone, and
which roads were already walked and abandoned.

## Commands

```bash
mvn clean install                 # builds both modules and runs the Angular tests
mvn clean install -DskipTests     # skips them
```

Node is not a prerequisite: `frontend-maven-plugin` downloads a pinned version — parent `pom.xml`,
`frontend-plugin.node.version` — into `nuxeo-labs-repository-dashboard-web/node/`. To run npm
directly, put it on the path first, otherwise you get the system node, which is too old for
Angular 22:

```bash
cd nuxeo-labs-repository-dashboard-web
export PATH="$PWD/node:$PATH"
npm test                                      # 27 files, vitest + jsdom
npm test -- --watch=false --include src/app/engine/agg-compiler.spec.ts   # one file
npm test -- --watch=false --filter 'never emits a .keyword'               # one behaviour
npm run build                                 # this is the typecheck
npm run format                                # prettier; run it before committing
npm start                                     # :4200, proxying /nuxeo to the server in .env
```

- **`ng test` defaults `--watch` to true in a TTY**, so an interactive `npm test` never returns.
  Pass `--watch=false` whenever the run must end. `--include` and `--filter` are Angular builder
  options, not vitest flags.
- **There is no linter and no `typecheck` script.** `npm run build` compiles with `strict`,
  `noUnusedLocals` and `strictTemplates`, and is the only thing that type-checks the application.
- **Nothing in the Maven build runs `format:check`**, so a badly formatted commit still goes green.
- `npm start` needs `.env` (`cp .env.example .env`). It is gitignored; never commit credentials.
- `src/proxy.conf.mjs` is outside the Prettier glob, which only covers `src/**/*.{ts,html,css,json}`.

Commits are single-line imperative subjects of about sixty characters with no prefix, stating the
behaviour that changed, followed by a body arguing the reasoning and citing the evidence. Match it.

## How it is wired

- **No Java at all.** Four resources under `nuxeo-labs-repository-dashboard-web/nuxeo/` deploy the
  SPA; the jar carries the Angular output under `nuxeo.war/dashboard/`. The README's "Deployment"
  table says which resource does what.
- **One `index` per dashboard config**, so a page cannot read the repository and the audit in the
  same breath (`query-planner.ts`). That is a real limit, not an oversight: it is why a
  trustworthy "workflows running now" figure is impossible on the Workflows page.
- **Dashboards are JSON** in `src/app/config/dashboards/`, copied to `assets/dashboards/` by
  `angular.json` and fetched at runtime. The specs `import` those very files, so a shipped
  configuration cannot drift from what is tested.

## Testing conventions

Helpers live in `src/testing/`. Use them rather than inventing equivalents.

- **`installFetchStub(routes)`** replaces `globalThis.fetch`. Routes match on a URL substring and,
  when needed, on the parsed body: a dashboard issues its aggregation batch, its facet values query
  and its table query against the very same `_search` URL. Use the `isAggregationsRequest`,
  `isFacetValuesRequest` and `isHitsRequest` predicates.
- **`settle(fixture)`** drains the asynchronous work a page starts. The application is zoneless and
  talks to the server through plain `fetch`, so `whenStable()` alone knows nothing of those
  promises.
- **`ChartWidgetStubComponent`**, installed through
  `TestBed.overrideComponent(WidgetOutletComponent, …)`, replaces the real chart: ECharts paints on
  a canvas jsdom does not provide. It renders the label, the hint **and** the resolved bucket
  labels, so all three stay observable. Option building is tested directly, `buildChartOption`
  being pure.
- **`setup.ts`** polyfills `ResizeObserver` and the modal behaviour of `<dialog>`.

Name a test as a statement of behaviour, not of implementation. A test that cannot observe what it
claims to verify is worse than no test: the range reminder passed silently until the chart stub was
made to render hints, and a broken `LabelStrategy` passed until it rendered bucket labels.

## Invariants the tests protect

- **One request per dashboard.** Adding a widget must not add a round trip. Table widgets are the
  only exception, because they need `hits`.
- **`AggConfig` stays a closed union, and `agg-compiler.ts` stays its only compiler.** No raw DSL
  reaches the passthrough, which would forward `script` verbatim for an administrator.
  `facet-values.service.ts` once built its own JSON and so escaped every guarantee; it no longer
  does.
- **Content's composition scopes are a partition**: `liveNotTrashed + trashed + versions + proxies`
  equals `all`. The test evaluates the clauses against synthetic documents rather than trusting a
  reading of the JSON.
- **The expiry tiles are a partition too** — `expired`, `expiringWeek`, `expiring60`, never two.
  The sixty day window starts at `gt: now+7d`, so J+7 belongs to the week alone. A reader adds the
  three figures up, so an overlap is a wrong answer, not a detail.
- **Workflows scopes are mutually exclusive but *not* exhaustive**: three reachable events fall
  outside them, so that spec asserts exclusivity only.
- **Grid rows fill whole lines**: the spans of a row sum to a multiple of twelve, for every range.
- **`shipped-dashboards.spec.ts`** re-checks every shipped file: no `.keyword`, numeric
  `extended_bounds`, a widget per layout cell, a `cardinality` beside every top N. It asserts the
  *count* of `extended_bounds`, since `tasks.json` deliberately has no `dateRange`.

## Verifying against a real server

A local Nuxeo is usually running. Ask the user for the URL and credentials, use them **in the
session only, and never write them to disk** — not in `.env`, not in a config file, not in a
comment. Read-only calls are enough: `POST /nuxeo/site/es/{index}/_search`, and `GET` on
`/api/v1/me`, `/capabilities`, `/user/{id}`, `/group/{name}`, `/config/types/{name}`,
`/config/schemas`, `/ui/i18n/messages.json`.

**Any newly emitted request shape must be run once against the real index before it is called
done.** The fixtures were written from reading the Nuxeo sources, which is circular: a spec proves
we build what we meant to build, never that OpenSearch accepts it, and it happily enshrines a
mistake — the `extended_bounds` assertions did exactly that, and took two pages down. The cheapest
check is a throwaway spec that plans with the real planner and `fetch`es the result, deleted once
it has answered. Confronting fixtures with a live index is what found that `_source` nests complex
properties as objects while aggregations address them with a dot, that `time_zone` was missing, and
that a bound cannot be a date string.

Two paths the dataset cannot exercise, so a green run proves nothing about them: **`time_zone`**,
every document having been created between 07:00 and 12:00 UTC so no bucket moves — use a control
zone at UTC−10; and **"N targeting trashed" on proxies**, which needs a proxy on a *live* document
later trashed, proxies on versions inheriting a flag that stays false.

**Both audit indices on the sandbox are partly fabricated and prove nothing about the platform.**
In `audit`, `principalName` and `eventDate` of `documentCreated` and `documentModified` were taken
from the target document, and the login events were generated outright; the prior state is kept in
`nuxeo-audit-backup-20260918`. In `audit_wf`, 2173 entries covering 450 instances were bulk loaded
because the twenty genuine ones had nothing completed or cancelled; prior state in
`nuxeo-audit-backup-20260919`, and every fabricated entry carries an `id` at or above 900000.
Loading them needed `docker exec` on the `opensearch` container: the passthrough is read-only and
rejects any index it does not declare, and OpenSearch is not published on a host port. Three
consequences before a demo or a conclusion: three of the five models there — `RequestDownload`,
`AdHoc`, `ClaimReview` — exist in no repository, so filtering on them leads to documents nobody can
open; the durations were drawn uniformly, so mean and median coincide per model by construction;
and any distribution or daily curve read there reflects what was written.

## Facts the README does not carry

- **Never add `<require>org.nuxeo.web.ui</require>` to `dashboard-webresources-contrib.xml`.**
  Inside a component `require` names a *component*, and no component bears that name — it is only a
  bundle symbolic name. The component would stay pending and, `nuxeo.start.strict` defaulting to
  true, the server would refuse to start. The file documents this; leave the paragraph there.
- **`MANIFEST.MF` needs its trailing newline**, and one `Nuxeo-Component` entry per line with a
  single leading space on continuations. Without the newline the last header is silently dropped.
- **"Overdue, but the workflow is finished" is an empty bucket by construction.**
  `DocumentRoutingWorkflowDoneListener` cancels the remaining tasks in the very transaction that
  sets the route to `done` — its `async="true"` is ignored, the class implementing `EventListener`.
  And on a finished task "overdue" would need `nt:dueDate < dc:modified`, hence a script, which
  `AggConfig` refuses.
- **A task carries no workflow model name.** `nt:processName` receives the node's *notification
  template*, usually empty; only `nt:processId` leads to the instance. Grouping tasks by model
  needs a join the planner cannot express.
- **A node with no `taskDueDateExpr` produces `nt:dueDate = now`**, so its tasks are overdue a
  second after creation. Both shipped models set the expression; a Studio model need not.
- **In `audit_wf`, `docType` and `docUUID` name the route or the task, never the business
  document.** A "documents entering a workflow" widget was designed on the opposite assumption and
  dropped. A table linking back to Web UI fails for the same reason: the planner always adds
  `ecm:uuid` to `_source`, which the audit does not have.
- **`percentiles` answers a map under `values`**, keyed as OpenSearch formats it (`"50.0"`, but
  `"99.9"` for a fractional percent), so `result-mapper` reads the single entry rather than
  recomposing the key; and being multi-valued, a `terms` ordered by it needs `metric.50` in the
  order path, not `metric`.

## Design decisions, and why

Do not undo these without knowing what they were for. The README explains the mechanisms; this is
about the choices behind them.

| Decision | Reason |
| --- | --- |
| Aggregations named after the widget, not after Web UI's `by` key | With `by`, two widgets in one request would write to the same place. The naming is what makes batching possible |
| "All selected" compiles to *no clause*, never to every value | Otherwise a fully selected member swallows its siblings, and a facet filter silently does nothing while all types stay checked |
| Scopes taken out of `baseFilter` | A widget can only narrow the shared query. With the live-document filter shared, no tile could ever count versions or proxies |
| No "trashed" line under the Total tile | Proxies inherit `ecm:isTrashed` from their target, so a repository-wide count differs from the Trashed tile with no visible explanation |
| An IANA zone name rather than a fixed offset for `time_zone` | Correct on both sides of a daylight saving change, which `+02:00` is not. Web UI's own element uses the offset |
| No Nuxeo JS client | CommonJS, not tree-shakable; it would pull batch upload, directories and OAuth2 for three call shapes. A `fetch` wrapper is enough |
| No implicit exclusion of technical documents | Explicit user decision: a customer creating five `Domain` objects has reasons to see them counted. The type filter is the tool, and it is persisted |
| A page names its missing prerequisite instead of being greyed out | A disabled menu entry cannot tell the reader which package to install. Workflows, Users and Governance all follow this |
| A period is two inclusive calendar days, not date math | Only concrete days can be shown in, and edited through, the two date fields. `gte` at the start of the first day, `lt` at the start of the day after the last |
| `extended_bounds` derived from the filter, never configured | A histogram otherwise spans only the days holding a document, so a quiet start of period silently shortens the chart. Deriving it also keeps `AggConfig` closed |
| The failed logins list resolves no name | The value is evidence: whether `admin` or `Admin` was typed matters, and a prettified name would hide it. It also spares ten doomed `/api/v1/user` lookups |
| A truncated bucket list says so, with a count | Ten bars out of forty-seven users read as the whole team. The line is derived, so it stays silent on a small repository |
| `LabelService` caches the in-flight promise, not the answer | Widgets resolve their buckets in parallel, so three charts naming the same author start before any has replied. Caching the answer deduplicates nothing at that moment |
| Merging the two forms of a principal adds counts only | Two averages recombine only with their weights, so `labels: "user"` together with a `metric` raises a plan error naming the reason rather than merging a wrong figure |
| A mixed aggregate always ships with a breakdown beside it | An aggregate over unlike populations describes none of its members: on five workflow models spanning two orders of magnitude the mean lands where no model is |

## Blob volumetry, set aside

Asked for: "Total Size" and "Live Docs Size" tiles, deduplicated, over *every* blob field.
Investigated, then set aside. Do not walk this road again from scratch.

- **A plain sum answers a different question.** A version holds its own copy of the blob while the
  store keeps one object per digest, so a document versioned ten times without changing its file is
  counted eleven times — an order of magnitude, not an imprecision.
- **The community cookbook's method does not scale.** It groups by `file:content.digest` with
  `"size": 1000000000` and adds the buckets with `sum_bucket`; past `search.max_buckets`, 65,536 by
  default and set nowhere in the LTS 2025 tree, the request fails outright.
- **`composite` does not rescue it.** Several `sources` produce a cartesian product rather than a
  union, so one pagination per blob field is needed; without an index sorted on the digest every
  page rescans the filtered set; deduplicating across fields means holding every digest in browser
  memory; renditions, the heaviest on a media repository, are `index: false`; and the passthrough
  has a 20 s socket timeout with no retry.
- **The road to take if it comes back.** `DELETE /api/v1/management/blobs/orphaned?dryRun=true`
  starts a bulk action; polling `GET /api/v1/management/bulk/{commandId}` yields `result.totalSize`
  and `result.deletedSize`. Deduplicated by construction, exhaustive without knowing a schema, and
  `dryRun` deletes nothing. It needs the `queryBlobKeys` capability, hence MongoDB — VCS answers
  501 — which `GET /api/v1/capabilities` reports without a side effect. Above all **the figure
  ignores the date range and the type filter**: it is a storage truth, not a documentary one, so it
  needs a card of its own outside the filtered grid, never a tile among the others.
- Two facts worth keeping: `GET /api/v1/config/schemas` types every field in one call, a blob being
  literally `"blob"` or `"blob[]"`; and `ecm:blobKeys` is **not** indexed, so there is no shortcut
  there. With `nuxeo-quota` installed, `dss:innerSize`, `dss:sizeVersions` and `dss:sizeTrash` are
  indexed `long` fields a plain `sum` can aggregate under the dashboard filters — not deduplicated,
  but the only route to a volume without a heavy operation.

## Style

Comments explain *why*, never *what*. Prefer no comment to one that restates the code, and fix a
comment whose justification is wrong — one claimed OpenSearch flattens blobs, which it does not,
and another claimed `principalName` protected against impersonation, which it does not either.

No emoji. Four-space indentation does not apply here; Prettier owns formatting.

Answer the user in French, using *vous*.

## Where things stand

Five live screens — Content, Users, Workflows, Tasks, Diagnostics — plus Governance, which is
still a placeholder naming its missing prerequisite. Build green, 348 tests over 27 files.

The work is pushed to `github.com/ThibArg/nuxeo-labs-repository-dashboard`, a public backup until
the plugin is ready to be forked into `nuxeo-sandbox`; the README carries a warning saying so, and
`AGENTS.md` is deliberately **not** gitignored in this repository, so keep it free of credentials.

**Phase 5, the Governance dashboard, is next.** The record and legal hold tiles are already out of
`content.json`, so it starts from a blank page rather than from a move; it may well need
`DataTableComponent`, which `tasks.json` already exercises. Then phase 2 (cross filtering on bucket
click, active filter chips, path scope, CSV and PNG export) and phase 3 (configuration editor with
a field picker fed by `/api/v1/config/schemas`). The README's status banner still says "phase 4"
and lists only three dashboards; it predates 4b–4d.
