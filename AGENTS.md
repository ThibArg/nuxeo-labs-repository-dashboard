# Working on this repository

Read `README.md` first: the product, the configuration schema, the deployment contributions, the
label strategies, and — under "Indexing rules worth knowing" and "Who an action is credited to" —
every field-level trap the queries depend on. `CUSTOMISING.md` is for whoever forks this and
changes it with an assistant; its "Requests that are not what they look like" table points back
here for the arguments. This file carries only what neither of them does: how to drive the build,
how the tests are wired, what must not be undone, and which roads were already walked.

Every count below was re-measured on the day it was written. Treat them as photographs.

## Commands

```bash
mvn clean install                 # both modules; runs the Angular tests
mvn clean install -DskipTests
```

Node is not a prerequisite: `frontend-maven-plugin` downloads the version pinned in the parent
`pom.xml` (`frontend-plugin.node.version`) into `nuxeo-labs-repository-dashboard-web/node/`. Put
it on the path before running npm yourself, otherwise you get the system node, which is too old
for Angular 22:

```bash
cd nuxeo-labs-repository-dashboard-web
export PATH="$PWD/node:$PATH"
npm test -- --watch=false                                                 # 54 files, 1011 tests
npm test -- --watch=false --include src/app/engine/agg-compiler.spec.ts   # one file
npm test -- --watch=false --filter 'never emits a .keyword'               # one behaviour
npm run build     # this IS the typecheck: strict, noUnusedLocals, strictTemplates
npm run format    # prettier; nothing in the Maven build checks formatting
npm start         # :4200, proxying /nuxeo to the server named in .env
```

- **`ng test` defaults `--watch` to true in a TTY**, so a bare `npm test` never returns. `--include`
  and `--filter` are Angular builder options, not vitest flags.
- **There is no linter and no `typecheck` script.** `npm run build` is the only thing that type
  checks the application, and only after a full pass.
- **`npm run build` ships nothing.** It fills `dist/`, which nothing installs: `nuxeo.war/dashboard/`
  inside the jar is written by `mvn install` alone. A change that compiles is not a change that
  ships, and the symptom of forgetting is the *previous* screen rather than an error. Trust the
  artefact: `unzip -l nuxeo-labs-repository-dashboard-web/target/*.jar | grep assets/dashboards`.
- **Specs are found by glob**, so a deleted one vanishes silently. Note the test count before and
  after. Zero of those tests reach anything under `nuxeo/` — MANIFEST, fragment, Web UI resource.
- `npm start` needs `.env` (`cp .env.example .env`); it is gitignored, never commit credentials.
  `src/proxy.conf.mjs` is outside the Prettier glob, which covers `src/**/*.{ts,html,css,json}`.

Commits are a single imperative subject of about sixty characters, no prefix, naming the behaviour
that changed, then a body arguing the reasoning and citing the evidence. Match it.

## The dialect

Nothing rejects an idiom this codebase does not use. The application is **Angular 22: zoneless,
standalone, signal based**, about two years old, so the abundant and confident answer out there is
Angular 15 and it does not belong here. Every entry in the "Never" column measures **zero
occurrences in `src/`**, verified.

| Write | Never |
| --- | --- |
| `input()`, `output()` | `@Input()`, `@Output()` |
| `@if`, `@for`, `@switch` | `*ngIf`, `*ngFor`, `ngClass`, `<ng-container>` |
| `signal`, `computed`, `effect`, `linkedSignal` | RxJS, `Observable`, the `async` pipe |
| `imports:` on the component | `NgModule`, `CommonModule` |
| `inject()` | injection through constructor parameters |
| `NuxeoHttpService` (plain `fetch`) | `HttpClient` |
| `template:` inline, styles in `src/styles.css` | `templateUrl`, `styleUrl` |
| a function from `core/format.ts` | a pipe |
| `(input)`, `(change)`, native `<dialog>` | `ngModel`, `FormsModule` |
| `ChangeDetectionStrategy.OnPush` | the default — 30 of the 31 components; the odd one is a test host in a spec |

`rxjs` sits in `package.json` only because `@angular/core`, `common` and `router` declare it a peer
dependency; it is imported nowhere, and removing it breaks the install rather than shrinking
anything. `@angular/forms` was not load bearing at all and is gone.

**There is no lifecycle hook anywhere**, and adding the first one is almost always wrong: what
would go in `ngOnInit` belongs in a field initialiser, a `computed`, or the constructor. `effect`
is deliberate and rare — six, each load bearing: three synchronise a native `<dialog>` with a
signal (`config-editor`, `facet-group-dialog`, `path-scope-picker`), one debounces principal
suggestions (`facet-panel`), one reopens the session when the route names another dashboard
(`dashboard-page`), one registers a chart's snapshot for the HTML export (`chart-widget`). A
seventh mirrors the last in `testing/chart-widget.stub.ts`. Reaching for an eighth usually means
the value wanted was a `computed`, or a `linkedSignal` when it must be writable *and* derived from
an input — which is what a section's fold and a `tabs` open panel use.

Eleven services are `@Injectable({ providedIn: 'root' })`. The two that are not — `DashboardRunner`
and `DashboardSession` — are provided by the page, which is what stops two dashboards from sharing
one state; a component placing widgets without declaring them fails at construction.

## How it is wired

- **No Java at all.** The resources under `nuxeo-labs-repository-dashboard-web/nuxeo/` deploy the
  SPA; the jar carries the Angular output under `nuxeo.war/dashboard/`. README → "Deployment".
- **Seven screens**, six of them dashboards driven by JSON (`content`, `users`, `downloads`,
  `workflows`, `tasks`, `governance`) plus `diagnostics`. `app.routes.ts` types what a route hands
  a page, so dropping a `PreflightFeature` is a compilation error rather than a notice shown over
  a healthy server.
- **A widget declares the index it reads, and `planDashboard` groups by it** — one request per
  index present on the page, not one per dashboard and not one per widget. A page may therefore
  read the repository and the audit in one breath.
- **All six dashboards are compositions**, naming widgets from `src/app/library/` and compiling to
  the `DashboardConfig` everything downstream already understood. The compiled form is still
  accepted — a stored override may hold one — and `isComposition` discriminates on a `use` key in
  a layout cell or a `widgets` **array**, neither of which a compiled configuration can hold. In a
  spec use `src/testing/shipped.ts` rather than casting the import.
- **Declaring a widget and placing it are two different things.** A composition may use `layout`,
  drawn by the twelve column grid, or a flat `widgets` list a page component places itself.
  `DashboardSession` holds everything a reader does to a dashboard, and `<nxd-widget for="…">`,
  `<nxd-dashboard-filters>`, `<nxd-dashboard-header>` and `[nxdExportRoot]` all read it, so a
  bespoke screen writes a template and nothing else. `pages/bespoke-layout.spec.ts` is the worked
  example; no such screen ships, deliberately.
- **A layout is a tree of exactly three node kinds** (`dashboard-config.model.ts`): a row with
  `cells`, a `section` with `rows`, a `tabs` with labelled panels — bounded to two levels, so the
  grid draws it without recursing. `isLayoutRow`, `isLayoutSection`, `isLayoutTabs` tell them
  apart. **`layoutCells` and `layoutRows` are the only walkers**, used by `query-planner.ts`,
  `validateConfig`, `toBlocks` and the specs. Writing `layout.flatMap((row) => row.cells)` again
  compiles on a flat dashboard and silently loses every widget inside a tab.
- **Dashboards are JSON** in `src/app/config/dashboards/`, copied to `assets/dashboards/` by
  `angular.json` and fetched at runtime. The specs `import` those very files, so a shipped
  configuration cannot drift from what is tested.
- **An administrator's edit wins over the shipped file.** `DashboardConfigService.load` asks
  `DashboardOverrideService` (`localStorage`, key `nxd.config.<dashboard>`) before fetching the
  asset, and ignores an override that no longer compiles. The editor is
  `layout/config-editor.component.ts`, opened from `layout/page-header.component.ts`, wired to
  `openEditor` / `validateDraft` / `saveConfig` / `revertConfig` on `DashboardSession`.
  `validateConfig` (in `engine/dashboard-override.service.ts`) is the gate, and it runs the real
  planner rather than restating its rules.

## Testing conventions

Helpers live in `src/testing/`; use them rather than inventing equivalents.

- **`installFetchStub(routes)`** replaces `globalThis.fetch`. Routes match on a URL substring and,
  when needed, on the parsed body: a dashboard issues its aggregation batch, its facet values query
  and its table query against the very same `_search` URL, so use the `isAggregationsRequest`,
  `isFacetValuesRequest` and `isHitsRequest` predicates. A route's `wait` holds its answer until a
  promise settles, which is how two runs are made to answer out of order. `healthyServerRoutes()`
  and `emptySearchResponse()` cover the preflight calls a page makes before any of that; their audit
  answers no `horizon`, so a page knows no audit start and shows no notice until a test puts
  `auditHorizonRoute(instant)` first and runs `PreflightService.run()` itself.
- **`settle(fixture)`** drains the asynchronous work a page starts. The application is zoneless and
  uses plain `fetch`, so `whenStable()` alone knows nothing of those promises.
- **`ChartWidgetStubComponent`**, installed with `TestBed.overrideComponent(WidgetOutletComponent, …)`,
  replaces the real chart: ECharts paints on a canvas jsdom does not provide. It renders the label,
  the hint, the period **and** the resolved bucket labels, so all four stay observable.
  `buildChartOption` being pure, option building is tested directly.
- **`stubSession()`** hands a component a `DashboardSession` standing still, which is what lets the
  grid and any bespoke layout be tested for what they do — placing widgets — without ten injected
  services. **`captureDownloads()`** intercepts what an export hands the browser.
- **`setup.ts`** polyfills `ResizeObserver` and the modal behaviour of `<dialog>`.

Name a test as a statement of behaviour, not of implementation. A test that cannot observe what it
claims to verify is worse than none: the range reminder passed silently until the chart stub was
made to render hints, and a broken `LabelStrategy` passed until it rendered bucket labels.

## Invariants the tests protect

- **One request per index.** Adding a widget must not add a round trip. Table widgets are the only
  exception, needing `hits`. The cost is not the round trips: a partition read from four requests
  adds up by luck, and `now` — evaluated per request by OpenSearch — stops being one instant across
  the tiles bounded by it.
- **A query is narrowed only by what every widget of its request already counts.** A `filter`
  wrapper narrows what a widget counts, not what a shard walks, so `narrowingClauses` lifts into the
  query the clauses every widget filter carries, then the union of what remains of them. One widget
  with no filter of its own — `read: 'total'`, an unwrapped metric or chart, a `match_all` wrapper
  holding only a secondary figure or a distinct count — lifts nothing, which is what keeps Content's
  Total tile a total. Widget filters stay whole. `shipped-dashboards.spec.ts` holds both directions
  over every shipped file: nothing added that some widget does not state, and something added
  whenever every widget has a filter. What it prevents is a walk, not a wrong figure: under
  `match_all`, Tasks sent every entry of the repository index past eight collectors to count ten
  tasks.
- **A shared clause is attributed to the indices it constrains, and a mixed page must say so.**
  `dateRange.byIndex`, `termsGroup.indices`, `pathScope.indices`, and the `index` a pick carries
  from the chart it was clicked on; `baseFilter` is refused outright, having no index it could
  belong to. Absent means every index, so the shipped files declare nothing. It is *demanded*
  rather than derived because deriving it would mean a copy of the Nuxeo mapping in here, wrong the
  first time somebody adds a field — and the failure it prevents is silent: an audit request
  carrying `ecm:path.children` comes back empty, not unfiltered. `index-grouping.spec.ts` holds the
  whole contract.
- **`AggConfig` stays a closed union and `agg-compiler.ts` stays its only compiler.** No raw DSL
  reaches the passthrough, which would forward an administrator's `script` verbatim.
  `facet-values.service.ts` once built its own JSON and escaped every guarantee; it no longer does.
  It has been widened twice, each time by one value the compiler checks: `calendar_interval:
  "auto"`, which may compile to an `auto_date_histogram`, and `execution_hint: "map"` on `terms`,
  any other hint refused. A spec holds the second to `docUUID`, where it belongs.
- **Every `EsClause` is rebuilt by `clause-compiler.ts`, never relayed.** Rebuilding is the
  guarantee: a key nobody thought to refuse cannot ride along beside one that was accepted. Five
  entries: `baseFilter`, the result of `scopeClauses`, `widget.filter`, `secondary.filter`, and the
  sub-filters of a `filters` aggregation. Two things before touching it: `RANGE_BOUNDS` is
  `gt/gte/lt/lte` only — `format`, `relation` and `time_zone` are deliberately absent, so widening
  the set is a knowing act — and `clause-compiler.spec.ts` runs `build({})` over the whole library
  and demands **idempotence**, so a new predicate shape that is not in the set breaks every shipped
  dashboard, and that test says so first.
- **The repository populations are a partition**: `liveNotTrashed + trashed + versions + proxies`
  equals `all`. They live in `library/populations.ts`, and `populations.spec.ts` evaluates the
  clauses against synthetic documents rather than trusting a reading of them.
- **The expiry tiles partition too** — `expired`, `expiringWeek`, `expiring60`, never two. The sixty
  day window starts at `gt: now+7d`, so J+7 belongs to the week alone. A reader adds the three up.
- **No histogram pads itself over a span nobody measured.** `search.max_buckets` is 65,535 over the
  whole response and one document dated 1899 makes a daily chart 46,000 bars; two such charts fail
  every widget of the request. A trend's `interval` defaults to `auto`: `resolveHistogram` derives a
  width from the period only when the period bounds that very field at both ends, and sends an
  `auto_date_histogram` of `AUTO_BUCKETS` everywhere else. `shipped-dashboards.spec.ts` refuses a
  padded `date_histogram` on "All time" and holds the widest range the date fields accept, year 1
  to 9999, under the ceiling. Mind an asymmetry that is easy to miss: a typed range pads only the
  chart on the filtered field, through `extended_bounds`, while a stray document stretches every
  chart grouping by its field.
- **The audit's start moves a chart's padding, never a clause nor a width.** `histogramBounds`
  raises `extended_bounds.min` to the first day the audit holds (`HistogramBounds.floor`), so months
  nobody kept are not drawn as months nothing happened; the interval is still chosen from the
  period, which is what the query bounds, and a period wholly before the horizon pads nothing,
  OpenSearch refusing a `min` above `max`. `query-planner.spec.ts` holds all three and that the
  query is unchanged. The horizon itself is read by the preflight with **no query at all**: a
  `min` under a `match_all` is read from each segment's point index, and anything else walks the
  audit at every start. `preflight.service.spec.ts` holds the body whole.
- **Workflows populations are mutually exclusive but *not* exhaustive**: three reachable events fall
  outside them, so that spec asserts exclusivity only. Downloads is the same shape, `cmis` and
  `cmisRendition` being counted by neither tile.
- **A widget body never sets `label`, `span` or `spanByRange`.** Where a card sits and what it is
  called belong to the page; `WidgetBody` omits them. `hint` is the exception.
- **The compiler compiles everything or nothing.** A page built from the cells that happened to
  resolve is a page whose figures nobody can account for.
- **Only the latest run writes.** Nothing awaits a run before starting the next, and the page is
  reused from one dashboard to the next, so `DashboardRunner` numbers its runs and each gives up
  after any wait once another has started; only the latest sets `loading` back to false. The
  session's `loadConfig` does the same with the dashboard id. The requests given up are not
  aborted, the passthrough holding its thread until OpenSearch answers whatever the browser does —
  90 s at most, since every search asks to be stopped then.
  `dashboard-runner.service.spec.ts` holds the runner; a page spec holds the switch of dashboard.
- **Every search asks OpenSearch to stop it after 90 s**, `esUrl` appending
  `cancel_after_time_interval` (`SEARCH_CANCEL_AFTER`), which the passthrough forwards with the
  query string. OpenSearch before 1.1 refuses it on every search, so the preflight's repository
  probe — the session's first search, and the only place that can learn it — drops it for the
  session on a Nuxeo 500 quoting "unrecognized parameter" and the name; any other failure stays a
  failure of the index. A search sent before that probe would take every screen down on such a
  cluster. `preflight.service.spec.ts` holds the three cases, `nuxeo-http.service.spec.ts` the
  message a cancelled search is given.
- **So does the mapper, with an answer.** OpenSearch answers 200 when shards fail, with what the
  others counted; `mapResponse` refuses a response whose `_shards.failed` is above zero, or whose
  `timed_out` is true, and the runner fails the page as for a request that failed outright. Count
  from `failed`, never from `failures`, which OpenSearch groups by reason. An absent `_shards`
  header is accepted, which is what every fixture in `src/testing/` sends. The facet value lists
  and the container picker read their answers without this check.
- **Every declared widget is planned, on screen or not.** That is what makes opening a tab free and
  keeps the figures of two tabs comparable. A widget discovered when its tab opens would arrive in
  a request of its own, at its own instant.
- **Grid rows fill whole lines**: the spans of a row sum to a multiple of twelve, for every range.
- **`shipped-dashboards.spec.ts`** re-checks every shipped file: no `.keyword`, numeric
  `extended_bounds` (asserted by *count*, `tasks.json` deliberately having no `dateRange`, and
  resolved per index), a widget per layout cell, a `cardinality` beside every top N, and the very
  `validateConfig` an administrator's edit goes through. It finds the files with `import.meta.glob`,
  as `registry.spec.ts` walks the library folder, so adding a dashboard needs no test edit. That is
  a Vite feature and belongs to the specs only: `ng build` uses esbuild, so `registry.ts` stays
  hand written.

## Verifying against a real server

A local Nuxeo is usually running. Ask the user for URL and credentials, use them **in the session
only and never write them to disk** — not in `.env`, not in a config file, not in a comment.
Read-only calls suffice: `POST /nuxeo/site/es/{index}/_search`, and `GET` on `/api/v1/me`,
`/capabilities`, `/user/{id}`, `/group/{name}`, `/config/types/{name}`, `/config/schemas`,
`/ui/i18n/messages.json`.

**Any newly emitted request shape must be run once against the real index before it is called
done.** A spec proves we built what we meant to build, never that OpenSearch accepts it, and it
happily enshrines a mistake — the `extended_bounds` assertions did exactly that and took two pages
down. The cheapest check is a throwaway spec that plans with the real planner and `fetch`es the
result, deleted once it has answered; write the `process` / `Buffer` access untyped, there being no
`@types/node` here. Confronting fixtures with a live index is what found that `_source` nests
complex properties as objects while aggregations address them with a dot, that `time_zone` was
missing, and that a bound cannot be a date string.

**Point that harness at a dead port before believing its green run.** Reaching the server through
plain `fetch` means a wrong base URL, a missing credential or a typo yields a suite that passes
without touching anything. One run answered in 280 ms and looked fake; it was OpenSearch's request
cache, and the dead-port control is what established the difference.

**A shell harness fails green even more easily, because an empty count reads as zero.** macOS ships
bash 3.2, where expanding an empty array under `set -u` aborts the command, and `$(( ))` then reads
empty results as zeroes that add up to the expected total. Refuse a count that is not numeric
rather than letting it default, and publish results in a variable instead of through `$(...)`: a
`die` inside a subshell ends the subshell and nothing else.

**What live runs have already established** (lts 2025.24.15): every planned request accepted, with
`shard_size` on every `terms`, `time_zone` honoured (proved by shifting a control zone to
`Pacific/Honolulu`), `extended_bounds` only on the field the date filter constrains, `ecm:uuid` in
the table's `_source`, `percentiles` keyed `"50.0"`, and a mixed page planning two requests that
both answer. The same audit request carrying `ecm:primaryType` and `ecm:path.children` — what a
shared filter did before it was attributed to an index — answered **status 200, no error, zero
hits**: that is the whole argument for `byIndex`, in one number. Narrowing a query changes no
figure: the six shipped dashboards over All time, thirty days and twelve months, each aggregation
request sent with and without its lifted clauses, answered the same `aggregations`, byte for byte
but for the bounds of Tasks' lateness `date_range`, computed from `now`, which drift by a few
milliseconds between two requests — compare such pairs without them. `hits.total` showed the
narrowing reach the server: 4031 to 10 on Tasks, 17951 to 886 on Downloads, 17951 to 10333 on Users,
4031 to 793 on Governance, Content unchanged. The repository index has one shard there, the audit
five. `auto_date_histogram` is accepted with `buckets`, `minimum_interval`, `format` and
`time_zone`, answers the width it chose under `interval` (`1d`), and keeps its empty buckets,
contiguous — which a category axis needs. With every trend pinned to `day`, a range typed from 1800
failed on every dashboard carrying a trend and one from 1899 on Workflows alone, whose two charts
padded to 2 × 46,289 buckets while one chart of 46,289 answered; the passthrough reported each as a
Nuxeo 500 wrapping the OpenSearch `ResponseException`. With `auto`, all of them answered. Auto
buckets wider than a day never occurred on that data, so the shortening of month and year keys in
`result-mapper.ts` is exercised by specs only. `execution_hint: "map"` on the most downloaded
documents is honoured, not merely accepted: with `profile: true` every shard reports
`MapStringTermsAggregator` where it reported `GlobalOrdinalsStringTermsAggregator` (or its
`.LowCardinality` variant), over identical aggregations. At the sandbox's 69 downloads it is no
faster; the gain is for an audit naming far more documents than a period downloads. The audit
horizon probe answers `2026-06-23T22:31Z` there, 24 June in Paris, and is read without visiting an
entry: profiled, all five shards report `MinAggregator` with `collect_count: 0`, against about 3,600
each once an `exists` query is added. Its `took` was 823 ms on the first call of a session and 0 to
2 ms on every later one, 40 s of idleness included; the first figure was not explained. Users,
Downloads and Workflows planned with and without that horizon, over a period starting five years
before it, answered identical aggregations but for each trend's leading empty buckets, 64 monthly
buckets becoming 4; a period wholly before the horizon, sent without `extended_bounds`, answered
zero, and one starting on it the very same body. The six shipped dashboards over the five
shortcuts, 35 requests, all answered `_shards.failed: 0` and `timed_out: false` (one shard on the
repository, five on the audit), so refusing an incomplete answer refuses nothing there. No partial
answer could be provoked for the other direction: a search `timeout` as short as `1nanos` never
fires on that data, OpenSearch reading the clock it caches every 200 ms, and no clause shy of a
script fails one shard and not the others; that direction is held by a spec only. The same 35
requests sent with `?cancel_after_time_interval=90s` all answered 200 and complete, `nuxeo`,
`audit` and `audit_wf` alike; a misspelt parameter came back as a Nuxeo 500 whose `message`, first
in the body and well inside the 2,000 characters `NuxeoHttpError` keeps, quotes OpenSearch's
"contains unrecognized parameter", which is what the preflight watches for. No search could be made
to be cancelled: at `1nanos` or `1ms` it finishes before the timer fires, so the cancelled messages
are held by specs built from the reasons `TimeoutTaskCancellationUtility` and `QueryPhase` write in
the 1.3.20 sources. Three assertions
ever failed, the drifting `now` being the third, and all were the harness's fault, so a red live
check is not proof that the application is wrong.

**The sandbox's audit indices are partly fabricated and prove nothing about the platform.** In
`audit`, login events were generated and `principalName` / `eventDate` copied from target
documents; in `audit_wf`, some 2200 entries were bulk loaded because the genuine twenty had nothing
completed or cancelled (every fabricated entry carries an `id` ≥ 900000, and three of the five
models exist in no repository). Durations were drawn uniformly, so mean and median coincide by
construction. Governance runs on a reversible fixture under
`/default-domain/workspaces/governance-fixture` plus three `RetentionRule` documents under
`/RetentionRules`, all named `gov-fixture-*`; **its creation and teardown scripts live outside this
repository**, writing to a server having no business in a public plugin.

Paths no dataset here can exercise, so a green run proves nothing about them: "N targeting trashed"
on proxies; `record:retainUntil`, which only a passing expiry fills; `Document.UnattachRetentionRule`
against an enforced record; and a document carrying a legal hold *and* a retention.

## Traps the README does not carry

- **Never add `<require>org.nuxeo.web.ui</require>` to `dashboard-webresources-contrib.xml`.** Inside
  a component, `require` names a *component*, and no component bears that name — it is a bundle
  symbolic name. The component would stay pending and, `nuxeo.start.strict` defaulting to true, the
  server would refuse to start. The file documents this; leave the paragraph there.
- **`MANIFEST.MF` needs its trailing newline**, and one `Nuxeo-Component` entry per line with a
  single leading space on continuations. Without the newline the last header is silently dropped.
- **The deployment fragment's scratch directory must stay `${bundle.fileName}.i18n-tmp`.** It used
  `.tmp`, which is exactly where `mp-install` stages the bundle, so an interrupted deployment left a
  *directory* there and every later install died on `Parameter 'destFile' is not a file: …jar.tmp`,
  with nothing naming the leftover. Do not rename it back. What makes it worth knowing anyway: **the
  screens keep working** meanwhile, Tomcat serving a `nuxeo.war/dashboard/` unzipped at an earlier
  start, so the symptom is a plugin that looks deployed and runs code from two builds ago. Clear a
  leftover with `rmdir`, never `rm -rf`. Confirm a deployment on three things, not on the screen:
  `packages/.packages` reads `started`, a real jar sits in `nxserver/bundles/`, and the `main-*.js`
  named by `/dashboard/index.jsp` matches the one in `target/`.
- **`mp-install` refuses to reinstall a package already `started` while the server runs**
  (`A server is running with process ID …`). The README's sequence covers the first installation;
  the second, which is what iterating looks like, needs `nuxeoctl stop`, then `mp-install`, then
  `docker restart` — the stop leaves the container alive, so `docker exec` still reaches it.
- **A `terms` clause accepts an object, and then reads another index.** `{"terms": {"f": {"index": …,
  "id": …, "path": …}}}` is a terms lookup wearing the clothes of an ordinary filter.
  `clause-compiler.ts` refuses it by requiring a list — the least obvious shape it turns away.
- **`percentiles` answers a map under `values`**, keyed as OpenSearch formats it (`"50.0"`, but
  `"99.9"` for a fractional percent), and it sits under `metric`, not under the bucket name, so
  `result-mapper` reads the single entry rather than recomposing the key. Being multi-valued, a
  `terms` ordered by it needs `metric.50` in the order path. Ordering by an `avg` is confirmed live;
  ordering by a percentile is exercised nowhere.
- **In `audit_wf`, `docType` and `docUUID` name the route or the task, never the business document.**
  A table linking back to Web UI fails for the same reason: the planner always adds `ecm:uuid` to
  `_source`, which the audit does not carry.
- **A task carries no workflow model name.** `nt:processName` receives the node's *notification
  template*, usually empty; only `nt:processId` leads to the instance.
- **A node with no `taskDueDateExpr` produces `nt:dueDate = now`**, so its tasks are overdue a second
  after creation. Both shipped models set the expression; a Studio model need not.
- **"Overdue, but the workflow is finished" is empty by construction.**
  `DocumentRoutingWorkflowDoneListener` cancels the remaining tasks in the very transaction that
  sets the route to `done` (its `async="true"` is ignored, the class implementing `EventListener`),
  and on a finished task "overdue" would need `nt:dueDate < dc:modified`, hence a script, which
  `AggConfig` refuses.
- **A "downloads per day" chart counts thumbnails unless it says otherwise.** `download` is audited
  out of the box, but `PreviewAdapter` and every rendition fire it too — measured here, 524
  `rendition` against 15 `download`. `extended.downloadReason` is a `keyword` through the audit
  mapping's dynamic template, so filtering on it costs nothing. `HEAD` requests and the `webengine`
  reason are not logged at all, and a `nxbigblob` download carries no `docUUID`, no `docType` and no
  `category`, so a breakdown by type silently loses those rows.
- **Governance fields:** `record:ruleIds` does reach the index once a first record exists, and both
  `terms` and `cardinality` answer on it; `ecm:isFlexibleRecord` never does, so do not design a
  widget separating flexible from enforced; the `Record` facet is the only discriminant left, and it
  under-counts records (22 against 19 on the fixture).
- **`@children` trails a write by about a second.** `CURRENT_DOC_CHILDREN` is a
  `coreQueryPageProvider` with no Elasticsearch override anywhere in the LTS 2025 tree, so this is
  not the indexing lag it looks like: listing a container straight after creating twenty-three
  documents answered six. A script enumerating what it has just written must converge, not read once.
- **`Blob.text()` strips a byte order mark** by definition of the UTF-8 decode algorithm, so no
  assertion on an exported CSV's text can see it. The mark is what stops Excel reading UTF-8 as the
  local encoding, so prove it on the bytes.
- **`ChartWidgetComponent` cannot render under jsdom**, ECharts needing a canvas, so its CSV rows are
  built by `bucketRows` and tested there. `getDataURL`, and the white background given to the PNG,
  have never run outside a real browser.
- **`link: "document"` ships with no example.** It is covered by `data-table.component.spec.ts`, but
  nothing has put it on a real screen. `labels: "boolean"` does have one, `rules-by-flexibility`,
  which confirmed that a `terms` on a boolean answers the key `1`, not `"true"`.
- **A re-theme touches six places, and five are not the token block.** `styles.css` `@theme` holds
  30 colour tokens that most of the application follows, but `chart-options.ts:25-36` copies the ten
  `--color-series-*` byte for byte as a fallback, `:57-58` freezes the axis and gridline greys as
  literals no CSS is ever read for, `chart-widget.component.ts:98` bakes `#ffffff` into every
  exported PNG, `styles.css:350,388` are the print sheet's own, and seven `text-white` / `bg-black/5`
  utilities sit in five components. `chart-options.spec.ts:14` declares `color` and never asserts on
  it, so a wrong palette goes green; `buildLineOption` takes `palette[3]`, so every trend chart is
  `--color-series-4`. `border-subtle`, `nxd-dialog` and `nxd-button` are used in three components and
  defined nowhere.
- **A Web UI slot content is disabled by name, and the name is not an API.** A later contribution
  bearing the same `name` wins (`nuxeo-slots.js:46`, on `>=`), a `disabled` stub carrying no template
  is explicitly supported (`:352`, honoured at `:239`), and addons load after the native bundle
  (`index.js:91` then `:100`). But `defaultDocumentActions`, the example in Nuxeo's own training
  material, has zero occurrences in the LTS 2025 tree: a name that moved registers as a new
  contribution and the entry stays exactly where it was, silently.

## Roads already walked

Each was asked for, investigated, set aside. `CUSTOMISING.md` summarises them for a forker; this is
the argument.

- **Blob volumetry ("Total Size", "Live Docs Size", deduplicated, over every blob field).** A plain
  sum answers a different question: the store keeps one object per digest while every version holds
  its own copy, so a document versioned ten times is counted eleven — an order of magnitude, not an
  imprecision. The community method (group by `file:content.digest` with `"size": 1000000000`, add
  with `sum_bucket`) dies past `search.max_buckets`, 65,535 by default and set nowhere in the LTS
  2025 tree. `composite` does not rescue it: several `sources` produce a cartesian product, not a
  union, so it needs one pagination per blob field, every page rescans without an index sorted on
  the digest, deduplicating across fields means holding every digest in browser memory, renditions
  are `index: false`, and the passthrough waits 121 s by default, never retrying. **If it comes
  back**, the route is `DELETE /api/v1/management/blobs/orphaned?dryRun=true` polled through
  `GET /api/v1/management/bulk/{commandId}` for `result.totalSize` — deduplicated by construction,
  exhaustive without knowing a schema, deleting nothing, needing the `queryBlobKeys` capability
  (hence MongoDB; VCS answers 501), and **ignoring the date range and the type filter entirely**, so
  it needs a card of its own outside the filtered grid. Two facts worth keeping:
  `GET /api/v1/config/schemas` types every field in one call (a blob is literally `"blob"` or
  `"blob[]"`), `ecm:blobKeys` is **not** indexed, and with `nuxeo-quota` installed `dss:innerSize`,
  `dss:sizeVersions` and `dss:sizeTrash` are indexed `long` fields a plain `sum` can aggregate under
  the dashboard filters — not deduplicated, but the only route to a volume without a heavy operation.
- **There is no upload event in Nuxeo, at all.** Neither `BatchManager`, nor `BatchManagerComponent`,
  nor the REST `BatchUploadObject` fires anything, and `blobUpdated` does not exist; `FileManager`
  emits only `duplicatedFile`, which is not in the audit route. That is coherent: a batch upload
  writes to temporary storage, with no document and no transaction, and may never be attached. The
  approximations are `documentCreated` filtered on blob-carrying types, which over-counts, or a
  contributed `extendedInfo` with an EL expression on `${source...}`. `documentModified` is not one:
  the audit entry says nothing about *what* changed. Do not re-investigate this; the answer is no.
- **The dashboard emailed on a schedule.** It needs a Java module — this plugin has none — a
  scheduler, and server-side rendering, while the HTML export clones the *live DOM*, which does not
  exist on a server. The three ways out are a headless browser, a second description of the
  dashboard in Java that will drift, or an email carrying a link. A design conversation, not a task.
- **A "documents entering a workflow" widget** was designed on the assumption that `audit_wf`
  `docUUID` named the business document, and dropped when it did not.

## Design decisions, and why

Do not undo these without knowing what they were for.

| Decision | Reason |
| --- | --- |
| Aggregations named after the widget, not after Web UI's `by` key | Two widgets in one request would otherwise write to the same place. The naming is what makes batching possible |
| "All selected" compiles to *no clause*, never to every value | Otherwise a fully selected member swallows its siblings, and the filter silently does nothing while every box stays checked |
| Scopes taken out of `baseFilter` | A widget can only narrow the shared query; with the live-document filter shared, no tile could ever count versions or proxies |
| No "trashed" line under the Total tile | Proxies inherit `ecm:isTrashed` from their target, so a repository-wide count differs from the Trashed tile with no visible explanation |
| An IANA zone name rather than a fixed offset for `time_zone` | Correct on both sides of a daylight saving change, which `+02:00` is not. Web UI's own element uses the offset |
| A period is two inclusive calendar days, not date math | Only concrete days can be shown in, and edited through, the two date fields |
| `extended_bounds` derived from the filter, never configured | A histogram otherwise spans only the days holding a document, so a quiet start of period silently shortens the chart. It also keeps `AggConfig` closed |
| A trend's width follows the period, and OpenSearch picks it where the span is unknown | A fixed daily width is 46,000 buckets from one document dated 1899, and the ceiling is per response. `auto` is the one widening of `AggConfig` this took, and `auto_date_histogram` the one new aggregation reaching the passthrough |
| Not `min_doc_count: 1` on a trend | It bounds the bucket count just as well, but the x axis lists buckets rather than scaling time: empty years vanish and an 1899 bar sits beside 2024. The retention horizon keeps it, where a month with no expiry is a gap, not information |
| Content opens on the last twelve months, Governance on All time | Content on All time is the one full scan of the repository index the planner cannot narrow, its Total tile reading `hits.total`. Governance describes what holds today, and a window on `dc:created` would hide a record written three years ago and still under retention |
| The period is stated on every widget it constrains, not in hints | A hint names it only where a definition thought to, and a tile below the fold or pasted into a slide loses the picker; on Content, Total counts a year of the repository. `<nxd-widget>` decides once, through `dateFieldFor`, so a widget the period does not touch says nothing rather than something false |
| `execution_hint: "map"` on `docUUID`, and nowhere else | The default builds global ordinals over every value the shard holds, whatever the period selects: on `docUUID`, every document the audit ever named, rebuilt after each refresh. `map` hashes only what is collected, which is cheaper there and dearer on a field of a few thousand values |
| No implicit exclusion of technical documents | An explicit user decision: the type filter is the tool, and it is persisted |
| No Nuxeo JS client | CommonJS, not tree-shakable; it would pull batch upload, directories and OAuth2 for three call shapes |
| A page names its missing prerequisite instead of being greyed out | A disabled menu entry cannot tell the reader which package to install |
| The failed logins list resolves no name | The value is evidence: whether `admin` or `Admin` was typed matters. It also spares ten doomed `/api/v1/user` lookups |
| A truncated bucket list says so, with a count | Ten bars out of forty-seven users read as the whole team. The line is derived, so it stays silent on a small repository |
| `LabelService` caches the in-flight promise, not the answer | Three charts naming the same author start before any has replied; caching the answer deduplicates nothing at that moment |
| Merging the two forms of a principal adds counts only | Two averages recombine only with their weights, so `labels: "user"` beside a `metric` raises a plan error naming the reason |
| A mixed aggregate always ships with a breakdown beside it | An aggregate over unlike populations describes none of its members: over five models spanning two orders of magnitude the mean lands where no model is |
| No dashboard lists records until it can paginate | Twenty rows under a badge reading ten thousand describe nothing, and no sort makes the other 9,980 reachable |
| A click on a charted field a group declares is routed into that group | Two paths to one constraint must not become two states, or the button reads "all document types" beside a chip saying the opposite |
| Picks are not persisted, group selections are | A group is a stated preference with an explicit Apply; a pick is a gesture made while reading a chart |
| Chips render picks only | A group's selection is already named by its own button, which is where it is edited; a pick has no button, so without a chip it could be neither seen nor undone |
| A path scope is not persisted either | It is the filter a reader is most likely to forget having set, and the one whose figures look ordinary while describing a corner of the repository |
| The container picker reads the index, not `@children` | `@children` returns every child whatever its type, so four folders under ten thousand files means paginating through the files |
| The page export clones the live DOM | Re-rendering each widget would be a second description of how a KPI, a list and a table look, drifting the moment a type is added |
| No whole page PNG | The browser cannot rasterise DOM, and nearly half the placed widgets are KPI tiles, so `getDataURL` reaches half of nothing |
| The print sheet names `[echarts]` and puts its canvas back in the flow | zrender positions its canvas absolutely, so the shell's `height: auto` reset leaves the card collapsed to its title while the drawing paints over the neighbouring column. Do not fold the exception back into the reset |
| The span is written twice on a grid cell | A custom property cannot be matched by a selector, and the print sheet has to give a full width widget both paper columns |
| The printed page states its filters instead of showing the bar | Five period buttons and two empty date fields describe an application, never which period is in force. `DashboardSession.filterContext` feeds the sheet and the standalone file from one place |
| The configuration editor is a text area, not a form | The grammar is already a closed union in the model; a form would be a second description of it. Validation runs the real planner, so editor and dashboard cannot disagree |
| The editor opens on the source, not on the compilation | Handing back the thirteen widgets a composition stands for turns the next edit into a fork of the shipped file rather than a change to it |
| An override that stops compiling is ignored, not rendered | A configuration can break untouched, a field having gone away. Falling back to what ships is still correct; a column of errors with no way out is not |
| The library names one widget per idea, not per shape | A composition saying `topNChart('ecm:primaryType')` is writing a query again. The builders factor, the names do not |
| A composition compiles to `DashboardConfig` rather than replacing it | Planner, compiler, mapper, widget components, both exports and the editor keep working untouched, and every invariant their tests hold keeps holding |
| A definition goes through typed predicates, never `EsClause` | The passthrough forwards an administrator's payload unmodified, so a `script` clause runs Painless per document. A composition cannot express one at all |
| An empty `types` or `facets` means no constraint | The same rule the filter dialog follows; read the other way, a widget restricted to nothing in particular would match nothing |
| A widget reads the session instead of eight inputs | Input drilling works while a grid is the only parent; a widget in a tab, a panel or a bespoke layout has none |
| The export root is a directive, not a view query | A query answers whatever came first; only the page knows where its dashboard stops and its chrome begins |
| The grid keeps only its span arithmetic | Drawing a widget is `<nxd-widget>`'s job there as anywhere else, and sizing a row is `<nxd-widget-rows>`'s |
| Two grouping nodes and no more, bounded to two levels | A composition is checked by `validateConfig`, which *names* what it refuses; a bespoke component is checked by nothing. `tabs` and `section` cover the reorganisations people ask for; anything past them is a component, and the bound is what lets the grid draw without recursion |
| `collapsible` is an attribute of `section`, not a third node | A foldable block and a plain one are one idea seen twice |
| A closed tab and a folded section are removed from the DOM, not hidden | zrender sizes a canvas against the box it is mounted in, so a chart started in a hidden panel paints at zero width and stays there. The cost is that neither carries into the HTML export |
| A widget describing configuration stays out of a page describing content | The same filters cannot serve both: retention rules live outside `/default-domain`, so a path scope empties them silently |
| Bands and table columns live in the definition, not in a parameter | "Under an hour, up to a day, up to a week, beyond" is what that widget means; a different split is a different idea |

## Style

Comments explain *why*, never *what*. Prefer no comment to one restating the code, and fix a comment
whose justification is wrong — one claimed OpenSearch flattens blobs, which it does not.

No emoji. Prettier owns formatting; the four-space rule of the global instructions does not apply to
this project. Reply in the language the user writes in, and in English when there is nothing to go
by. Write every piece of documentation in English — the README, this file, `CUSTOMISING.md`, and
any report or review produced about the project — whatever language the conversation is held in.

## Where things stand

Seven screens, six composed dashboards. 69 definitions over five builders — `countTile`,
`topNChart`, `trendChart`, `bandChart`, `recordTable` — filling 65 places, 64 of them distinct;
`live-documents` serves both Content and Governance, the only sharing so far. Governance carries 17
definitions split four ways, five of which sit on no page, describing configuration rather than
content. Exactly one widget still reads `hits.total`: Content's `total-documents`, which constrains
nothing and is meant to — and which is why Content alone keeps its query unnarrowed. 1011 tests
over 54 files, build green.

Every page reading the audit says where it starts, measured once by the preflight as the earliest
`eventDate` (`engine/audit-horizon.ts`): a line under the filter bar, each widget's period restated
from that day, no padding before it, a sentence on Workflows about durations, the same sentence in
the printed and exported context. Not built: a start per page, from the first of the events a page
reads, which is what would reveal an event never audited, such as `loginSuccess` under the `perf`
template.

Downloads is the newest screen and the worked example `CUSTOMISING.md` is written from: seven
definitions naming `extended.downloadReason` beside `eventId: download`, and the second shipped use
of `labels: "document"`, resolved through `GET /api/v1/id/{uuid}`.

**One roadmap line is open: the field picker of phase 3b.** It would feed the configuration editor
from `GET /api/v1/config/schemas`, which **nothing calls today** — `NuxeoHttpService.get` is the way
in. Measured on the sandbox so a session need not guess: a flat array of 91 objects, each
`{ name, "@prefix", fields }`, a field mapping to a type string (`string`, `string[]`, `boolean`,
`date`, `long`, `double`, `blob`, `blob[]`) or, in 13 of the 91, to `{ type: "complex" | "complex[]",
fields: { … } }` nesting further. Two traps: **`@prefix` is sometimes the empty string**
(`l10nvocabulary`, `oauth2Client`), and such a schema's fields are addressed by the schema name; and
a type alone does not say whether a field can be aggregated — that lives in the README's "Indexing
rules worth knowing". A picker offering a field the compiler will refuse is worse than no picker.

The work is pushed to `github.com/ThibArg/nuxeo-labs-repository-dashboard`, a public backup until
the plugin is forked into `nuxeo-sandbox`. `AGENTS.md` is deliberately **not** gitignored here, so
keep it free of credentials.
