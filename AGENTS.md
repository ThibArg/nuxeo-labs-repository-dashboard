# Working on this repository

Read `README.md` first. It documents the product, the configuration schema, the deployment
contributions, the label strategies and — under "Indexing rules worth knowing" and "Who an action
is credited to" — every field-level trap the queries depend on. This file carries only what the
README does not: how to drive the build, how the tests are wired, what must not be undone, and
which roads were already walked and abandoned.

**If you are here to change the plugin rather than to maintain it**, read `CUSTOMIZING.md`
instead, then come back. It is written for whoever forks this and works on their copy with an AI
assistant: the four layers a change can belong to, a prompt per kind of change, what each recipe
actually costs — measured by performing it — and the security checklist to run on the diff. The
recipes it carries are proven; the invariants below are the reasons behind them.

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
npm test                                      # 48 files, vitest + jsdom
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
- **`npm run build` produces nothing deployable.** It fills `dist/`, which nothing installs: the
  `nuxeo.war/dashboard/` tree inside the jar is written by `mvn install` alone. A change that
  compiles is therefore not a change that ships, and the symptom of forgetting is the *previous*
  screen rather than an error — the Governance page was reported empty on a server whose jar
  predated its configuration file by two hours, still serving the placeholder it replaced. Trust
  the artefact rather than the console:
  `unzip -l nuxeo-labs-repository-dashboard-web/target/*.jar | grep assets/dashboards`.
- **Nothing in the Maven build runs `format:check`**, so a badly formatted commit still goes green.
- `npm start` needs `.env` (`cp .env.example .env`). It is gitignored; never commit credentials.
- `src/proxy.conf.mjs` is outside the Prettier glob, which only covers `src/**/*.{ts,html,css,json}`.

Commits are single-line imperative subjects of about sixty characters with no prefix, stating the
behaviour that changed, followed by a body arguing the reasoning and citing the evidence. Match it.

## The dialect

Nothing rejects an idiom this codebase does not use. There is no linter, and `npm run build` only
catches what fails to compile — after a full pass, and only if it is run. The application is
**Angular 22: zoneless, standalone, signal based**, which is about two years old, so the abundant
and confident answer is Angular 15 and it does not belong here. Every line below is a count taken
over `src/`, not a preference.

| Write | Never | Measured |
| --- | --- | --- |
| `input()`, `output()` | `@Input()`, `@Output()` | 94 and 25, against 0 |
| `@if`, `@for`, `@switch` | `*ngIf`, `*ngFor`, `ngClass`, `<ng-container>` | 47, 23 and 1, against 0 |
| `signal`, `computed`, `effect`, `linkedSignal` | RxJS, `Observable`, the `async` pipe | 35, 54, 7 and 4, against 0 imports of `rxjs` |
| `imports:` on the component | `NgModule`, `CommonModule` | 30 standalone declarations, against 0 |
| `inject()` | injection through constructor parameters | 38, against 0 |
| `NuxeoHttpService` | `HttpClient` | plain `fetch`, against 0 |
| `template:` inline, styles in `src/styles.css` | `templateUrl`, `styleUrl` | 30, against 0 |
| a function from `core/format.ts` | a pipe | 0 pipes |
| `(input)`, `(change)`, native `<dialog>` | `ngModel`, `FormsModule` | 0 imports of `@angular/forms` |
| `ChangeDetectionStrategy.OnPush` | the default | 29 of the 30; the odd one is a test host |

`rxjs` sits in `package.json` because `@angular/core`, `@angular/common` and `@angular/router` each
declare it a peer dependency. It is imported nowhere, and removing it would break the install rather
than shrink anything. `@angular/forms` was in the same list and was not load bearing at all: nothing
declared it a peer dependency, so it is gone.

**There is no lifecycle hook anywhere**, and adding the first one is almost always the wrong move:
what went into `ngOnInit` belongs in a field initialiser, in a `computed`, or in the constructor.
`effect` is deliberate and rare — six in the application, each load bearing: three synchronise a
native `<dialog>` with a signal, one debounces principal suggestions, one reopens the session when
the route names another dashboard, one registers a chart's snapshot for the HTML export. The
seventh is `testing/chart-widget.stub.ts` mirroring the sixth. Reaching for an eighth usually means
the value wanted was a `computed` — or, when the value has to be writable *and* derived from an
input, a `linkedSignal`, which is what the fold of a section and the open panel of a `tabs` use.

Eleven services are `@Injectable({ providedIn: 'root' })`. The two that are not — `DashboardRunner`
and `DashboardSession` — are provided by the page, which is what stops two dashboards from sharing
one state; a component placing widgets without declaring them fails at construction.

## How it is wired

- **No Java at all.** Five resources under `nuxeo-labs-repository-dashboard-web/nuxeo/` deploy the
  SPA; the jar carries the Angular output under `nuxeo.war/dashboard/`. The README's "Deployment"
  table says which resource does what.
- **A widget declares the index it reads, and `planDashboard` groups by it** — one request per
  index present on the page, not one per dashboard and not one per widget. The old limit is gone,
  so a page *can* now read the repository and the audit in the same breath. What has not changed
  is that a trustworthy "workflows running now" figure needs `DocumentRoute` on the repository
  index, which is now a matter of adding that widget rather than of splitting the page.
- **All five dashboards are compositions now**, naming widgets from `src/app/library/` and
  compiling to the configuration everything downstream already understood. The compiled form is
  still accepted — an older stored override holds one — and `isComposition` discriminates on a
  `use` key inside a layout cell or on a `widgets` **array**, neither of which a compiled
  configuration can hold. Use `src/testing/shipped.ts` in a spec rather than casting the import.
- **Declaring a widget and placing it are two different things.** A composition may use `layout`,
  which the twelve column grid draws, or a flat `widgets` list, which a page component places
  itself. `DashboardSession` — provided per page, like `DashboardRunner` — holds everything a
  reader does to a dashboard, and `<nxd-widget for="…">`, `<nxd-dashboard-filters>`,
  `<nxd-dashboard-header>` and `[nxdExportRoot]` all read it, so a bespoke screen writes a template
  and nothing else. `pages/bespoke-layout.spec.ts` is the worked example; there is no such screen
  in the product, deliberately.
- **A layout is a tree of exactly three node kinds**, declared in `dashboard-config.model.ts`: a
  row with `cells`, a `section` with `rows`, a `tabs` with labelled panels. It is bounded to two
  levels — a node at the top, rows inside it — so the grid draws it without recursing, and
  `isLayoutRow`, `isLayoutSection` and `isLayoutTabs` are the only way to tell them apart.
  **`layoutCells` and `layoutRows` are the only walkers**, and every reader goes through them:
  `query-planner.ts`, `validateConfig`, `toBlocks`, and the six specs that check a shipped file.
  Reading `layout.flatMap((row) => row.cells)` again compiles for a flat dashboard and silently
  loses every widget inside a tab.
- **Dashboards are JSON** in `src/app/config/dashboards/`, copied to `assets/dashboards/` by
  `angular.json` and fetched at runtime. The specs `import` those very files, so a shipped
  configuration cannot drift from what is tested.
- **An administrator's edit wins over the shipped file.** `DashboardConfigService.load` asks
  `DashboardOverrideService` (`engine/dashboard-override.service.ts`, `localStorage` under
  `nxd.config.<dashboard>`) before fetching the asset, and ignores an override that no longer
  compiles. The editor itself is `layout/config-editor.component.ts`, a `<dialog>` holding one
  text area, opened from the Configure button in `layout/page-header.component.ts`, carried by
  `layout/dashboard-header.component.ts` and wired to `openEditor`, `validateDraft`, `saveConfig`
  and `revertConfig` on `engine/dashboard-session.service.ts`. `validateConfig`, beside the
  override service, is the gate: it runs the real planner rather than restating its rules.

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
- **`session.stub.ts`** hands a component a `DashboardSession` standing still, which is what lets
  the grid and any bespoke layout be tested for what they do — placing widgets — without eight
  injected services. **`shipped.ts`** reads a dashboard file whichever form it takes.

Name a test as a statement of behaviour, not of implementation. A test that cannot observe what it
claims to verify is worse than no test: the range reminder passed silently until the chart stub was
made to render hints, and a broken `LabelStrategy` passed until it rendered bucket labels.

## Invariants the tests protect

- **One request per index.** Adding a widget must not add a round trip, and every dashboard that
  ships reads one index, so in practice that is still one request each. Table widgets are the
  only exception, because they need `hits`. Do not be tempted to give a widget its own request:
  the cost is not the round trips, it is that a partition read from four of them adds up by luck,
  and that `now` — which OpenSearch evaluates per request — stops being one instant across the
  tiles bounded by it.
- **A shared clause is attributed to the indices it constrains, and a mixed page must say so.**
  `dateRange.byIndex` was the first case; `termsGroup.indices`, `pathScope.indices` and the `index`
  a pick carries from the chart it was clicked on are the rest, and `baseFilter` is refused outright
  because it has no index it could belong to. Absent means every index, so the five shipped files
  declare nothing and behave exactly as before. The reason it is *demanded* rather than derived:
  knowing which field lives on which index would mean a copy of the Nuxeo mapping in here, wrong
  the first time somebody adds a field — and the failure it prevents is silent, an audit request
  carrying `ecm:path.children` coming back empty rather than unfiltered. `validateConfig` is the
  gate, so a shipped file is held to it exactly as an administrator's edit is;
  `index-grouping.spec.ts` is where the whole contract is written down.
- **`AggConfig` stays a closed union, and `agg-compiler.ts` stays its only compiler.** No raw DSL
  reaches the passthrough, which would forward `script` verbatim for an administrator.
  `facet-values.service.ts` once built its own JSON and so escaped every guarantee; it no longer
  does.
- **Every `EsClause` is rebuilt by `clause-compiler.ts`, never relayed.** Rebuilding is what makes
  the guarantee: a clause that passes leaves nothing behind it, so a key nobody thought to refuse
  cannot ride along beside one that was accepted — which two of its tests say out loud. Five
  entries: `baseFilter`, the result of `scopeClauses`, `widget.filter`, `secondary.filter`, and
  the sub-filters of a `filters` aggregation. The shipped screens were never the risk, a
  composition being unable to write a clause at all; **a stored override is in the compiled form**,
  and that was.
  Two things to know before touching it. `RANGE_BOUNDS` deliberately omits `format`, `relation`
  and `time_zone`, so a widget needing one will be refused and the closed set has to be widened
  knowingly. And `clause-compiler.spec.ts` runs `build({})` over all 62 definitions and demands
  **idempotence** — adding a predicate shape without widening the set breaks every shipped
  dashboard, and that test is what says so first.
- **The repository populations are a partition**: `liveNotTrashed + trashed + versions + proxies`
  equals `all`. They live in `library/populations.ts` now, so `populations.spec.ts` holds it once
  for every dashboard rather than per configuration file, and it evaluates the clauses against
  synthetic documents rather than trusting a reading of them. Confirmed live: 709 + 87 + 3091 + 46
  = 3933 = `hits.total`.
- **A widget body never sets `label`, `span` or `spanByRange`.** Where a card sits and what it is
  called belong to the page; `WidgetBody` omits them so a builder cannot quietly decide. `hint` is
  the exception — a definition carries a sensible one and a composition may replace it.
- **The compiler compiles everything or nothing.** A page built out of the cells that happened to
  resolve is a page whose figures nobody can account for.
- **Every declared widget is planned, whether it is on screen or not.** That is what makes opening
  a tab free and what keeps the figures of two tabs comparable. Never filter the plan down to what
  is rendered: a widget discovered when its tab opens would arrive in a request of its own, at its
  own instant.
- **The expiry tiles are a partition too** — `expired`, `expiringWeek`, `expiring60`, never two.
  The sixty day window starts at `gt: now+7d`, so J+7 belongs to the week alone. A reader adds the
  three figures up, so an overlap is a wrong answer, not a detail.
- **Workflows populations are mutually exclusive but *not* exhaustive**: three reachable events fall
  outside them, so that spec asserts exclusivity only.
- **Grid rows fill whole lines**: the spans of a row sum to a multiple of twelve, for every range.
- **`shipped-dashboards.spec.ts`** re-checks every shipped file: no `.keyword`, numeric
  `extended_bounds`, a widget per layout cell, a `cardinality` beside every top N, and the very
  `validateConfig` an administrator's edit goes through. It asserts the *count* of
  `extended_bounds`, since `tasks.json` deliberately has no `dateRange`, and it resolves the padded
  field **per index** rather than once. It finds the files with `import.meta.glob` rather than
  listing them, so adding a dashboard does not mean remembering to add it to a test — the same
  reason `registry.spec.ts` walks the library folder. That is a Vite feature and belongs to the
  specs only: `ng build` uses esbuild, so `registry.ts` stays hand written.

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

**Point that harness at a dead port before believing its green run.** It reaches the server through
plain `fetch`, so a wrong base URL, a missing credential or a typo in the path yields a suite that
passes without touching anything. The last run answered in 280 ms and looked fake; it was
OpenSearch's request cache, and the dead-port control is what established the difference. Write the
`process`/`Buffer` access untyped, too: there is no `@types/node` here, and a throwaway file does
not deserve a dependency.

**A shell harness fails green even more easily, because an empty count reads as zero.** The
Governance fixture's own check once announced a perfectly clean repository while all five of its
probes had returned nothing: macOS still ships bash 3.2, where expanding an empty array under
`set -u` aborts the command, and `$(( ))` then read the empty results as zeroes that happily added
up to the expected total. Two habits close it: refuse a count that is not numeric rather than
letting it default, and publish results in a variable instead of through `$(...)`, since a `die`
inside a subshell ends the subshell and nothing else. The same subshell trap silently swallowed a
`die` after every document creation before it was noticed.

The shipped configuration was confronted this way once, before Governance was migrated: 17 planned
requests over the four dashboards of the day and every date range, all accepted, `shard_size` on
every `terms`, `time_zone` on every histogram, `extended_bounds` only on the field the date filter constrains, `ecm:uuid` in the
table's `_source`, and `percentiles` keyed `"50.0"`. Two assertions failed and **both were the
harness's fault** — it demanded bounds on every histogram, and read the percentile under `inner`
rather than under `metric`. Worth remembering before concluding that a red live check means the
application is wrong.

**The mixed-page shapes were confronted the same way, on lts 2025.24.15, and the silent failure
they close was measured rather than argued.** A composition over `documents-created`,
`documents-by-type`, `distinct-users-per-day` and `top-users-by-logins`, filtered by a period, a
document type, a container and a pick, planned two requests and both were accepted with no shard
failure: 2861 hits on the repository bounded by `dc:created`, 6400 on the audit bounded by
`eventDate` against 16443 unbounded. The same audit request carrying `ecm:primaryType` and
`ecm:path.children` — what a shared filter did before it was attributed to an index — answered
**status 200, no error, zero hits**. That is the whole argument, in one number. The group's
candidate values answered 13 buckets on `nuxeo` and none on `audit`, which is the facet dialog that
used to come back empty; and `byIndex: { "audit": "" }` left the audit half at 16443, so the escape
hatch is honoured live.

One path the dataset cannot exercise, so a green run proves nothing about it: **"N targeting
trashed" on proxies**, which needs a proxy on a *live* document later trashed, proxies on versions
inheriting a flag that stays false. **`time_zone` used to be on that list and no longer is**: a
control zone at `Pacific/Honolulu` shifts the buckets onto local midnight, 10:00 UTC, so the
parameter is demonstrably honoured even though every document here was created between 07:00 and
12:00 UTC.

**Both audit indices on the sandbox are partly fabricated and prove nothing about the platform.**
In `audit`, `principalName` and `eventDate` of `documentCreated` and `documentModified` were taken
from the target document, and the login events were generated outright; the prior state is said to
be kept in `nuxeo-audit-backup-20260918`. In `audit_wf`, 2173 entries covering 450 instances were
bulk loaded because the twenty genuine ones had nothing completed or cancelled; prior state in
`nuxeo-audit-backup-20260919`, and every fabricated entry carries an `id` at or above 900000.
Neither backup index can be checked from here: the passthrough rejects any index it does not
declare, so those two names are hearsay until somebody looks from inside the container. Loading the
entries needed `docker exec` on the `opensearch` container for that same reason, OpenSearch not
being published on a host port either. Three consequences before a demo or a conclusion: three of
the five models there — `RequestDownload`, `AdHoc`, `ClaimReview` — exist in no repository, so
filtering on them leads to documents nobody can open; the durations were drawn uniformly, so mean
and median coincide per model by construction; and any distribution or daily curve read there
reflects what was written.

**Figures drift, so re-measure rather than quote.** `audit_wf` held 2193 entries when the loading
was recorded and holds 2241 today. `nt:actors` carried `Josh` five times against one `user:Josh`;
it now carries six against two, which merge to eight. Every count in this file is a photograph.

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
- **A `terms` clause accepts an object, and then reads another index.** `{"terms": {"f": {"index":
  …, "id": …, "path": …}}}` is a terms lookup: it fetches the values out of that document, wearing
  the clothes of an ordinary filter. `clause-compiler.ts` refuses it by requiring a list, which is
  the least obvious of the shapes it turns away.
- **In `audit_wf`, `docType` and `docUUID` name the route or the task, never the business
  document.** A "documents entering a workflow" widget was designed on the opposite assumption and
  dropped. A table linking back to Web UI fails for the same reason: the planner always adds
  `ecm:uuid` to `_source`, which the audit does not have.
- **`percentiles` answers a map under `values`**, keyed as OpenSearch formats it (`"50.0"`, but
  `"99.9"` for a fractional percent), so `result-mapper` reads the single entry rather than
  recomposing the key — and it sits under `metric`, not under the bucket name. Being multi-valued,
  a `terms` ordered by it needs `metric.50` in the order path, not `metric`. Ordering by an `avg`
  **is** exercised and has been confirmed live — `durationByModel` and `slowestSteps` come back in
  descending order — but ordering by a *percentile* still is not, no shipped widget asking for it.
- **`Blob.text()` strips a byte order mark**, the UTF-8 decode algorithm removing one by
  definition, so no assertion on the text of an exported CSV can ever see it. The mark is what
  keeps Excel from reading UTF-8 as the local encoding, so it is worth proving: read the bytes.
- **`ChartWidgetComponent` cannot be rendered under jsdom**, ECharts needing a canvas, so its CSV
  rows are built by `bucketRows` and tested there while `getDataURL` is exercised nowhere. That
  call, and the white background given to the PNG, have never run outside a real browser.
- **`labels: "boolean"` has an example now**, `rules-by-flexibility`, and it confirmed the shape
  that mattered: a `terms` on a boolean answers the key `1`, not `"true"`, which the strategy
  already handled. **`link: "document"` still ships with no example**: it had one in the Governance
  record table and lost it when that widget was dropped. It stays covered by
  `data-table.component.spec.ts`, so this is not a gap in the suite — nothing has put it on a real
  screen.
- **`@children` trails a write by about a second.** Listing a container straight after creating
  twenty-three documents in it answered six. `CURRENT_DOC_CHILDREN` is declared a
  `coreQueryPageProvider` and no Elasticsearch override of it exists anywhere in the LTS 2025 tree,
  so this is not the indexing lag it looks like. Any script that enumerates what it has just
  written has to converge rather than read once.
- **A "downloads per day" chart counts thumbnails unless it says otherwise.** `download` is audited
  out of the box — `DownloadService.EVENT_NAME`, routed by `audit-contrib.xml` with no property to
  set — but `PreviewAdapter` and every rendition fire it too. Measured here: 539 events, of which
  **524 `rendition` and 15 `download`**. `extended.downloadReason` is a `keyword` through the audit
  mapping's dynamic template, so filtering on it costs nothing; not filtering on it means a chart
  that measures the interface rather than the readers. `HEAD` requests and the `webengine` reason
  are not logged at all, and a `nxbigblob` download carries no `docUUID`, no `docType` and no
  `category`, so a breakdown by type silently loses those rows.
- **A stale `<bundle>.jar.tmp` *directory* blocks every later install, and this plugin used to
  create one.** `mp-install` copies the bundle to `nxserver/bundles/<name>.jar.tmp` before renaming
  it, and the deployment fragment used `${bundle.fileName}.tmp` as its own scratch directory for
  appending the Web UI translations — the very same path. The platform's own fragments do this too,
  `nuxeo-drive-core` among them, so the idiom is inherited rather than invented; it is a latent
  collision all the same. An interrupted deployment leaves the directory behind and every later
  attempt dies on `Cannot execute command. Parameter 'destFile' is not a file: …jar.tmp`, with
  nothing naming the leftover and the package stuck at `installing` in `packages/.packages`.
  The scratch is `${bundle.fileName}.i18n-tmp` now, which nothing else writes. **Do not rename it
  back.**
  What makes it worth knowing even so: **the screens keep working** while this is happening,
  because `nuxeo.war/dashboard/` was unzipped at an earlier start and Tomcat serves those files
  whether or not any bundle is loaded. So the symptom is a plugin that looks deployed, answers on
  every URL, and runs code from two builds ago. Clear a leftover with `rmdir`, not `rm -rf`, so a
  directory holding anything refuses to go and says so. And confirm on three things rather than on
  the screen: `.packages` reads `started`, a real jar is in `nxserver/bundles/`, and the `main-*.js`
  named by `/dashboard/index.jsp` matches the one in `target/`.
- **`mp-install` refuses to reinstall a package that is already `started` while the server runs**,
  with `Cannot execute command. A server is running with process ID …`. The README's install
  sequence works for a first installation and not for the second, which is the one a developer
  iterating on a fork performs all day. Inside a container the sequence that works is
  `nuxeoctl stop`, then `mp-install`, then `docker restart` — the stop leaves the container alive,
  so `docker exec` still reaches it.

- **There is no upload event in Nuxeo, at all.** Neither `BatchManager`, nor `BatchManagerComponent`,
  nor the REST `BatchUploadObject` fires anything, and `blobUpdated` does not exist; `FileManager`
  emits only `duplicatedFile`, which is not in the audit route. That is coherent — a batch upload
  writes to temporary storage, with no document and no transaction, and may never be attached. The
  approximations are `documentCreated` filtered on blob-carrying types, which over-counts, or a
  contributed `extendedInfo` with an EL expression on `${source...}`. `documentModified` is not one:
  the audit entry says nothing about *what* changed, `AbstractSession` passing only
  `documentIsDirty` and the versioning options. Do not re-investigate this; the answer is no.

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
| No dashboard lists records until it can paginate | Twenty rows under a badge reading ten thousand describe nothing, and no sort makes the other 9,980 reachable. Answering "how much" is the grid's job; reaching the documents needs paging and export |
| A click on a charted field a group declares is routed into that group | Two paths to one constraint must not become two states. Otherwise the button reads "all document types" beside a chip saying the opposite, and no reader can tell which the figures obeyed |
| Picks are not persisted, group selections are | A group is a stated preference with an explicit Apply; a pick is a gesture made while reading a chart. Restoring one a week later, over figures that have moved on, is noise rather than context |
| Chips render picks only | A group's selection is already named by its own button, which is also where it is edited. A second rendering would be two places to reconcile and two to keep in sync; a pick has no button, so without a chip it could be neither seen nor undone |
| The container picker reads the index, not `@children` | `@children` returns every child whatever its type, so finding four folders under ten thousand files means paginating through the files. `ecm:mixinType: Folderish` asks the question directly, and the dashboard already is a search client |
| The page export clones the live DOM | Re-rendering each widget would be a second description of how a KPI, a list and a table look, drifting the moment a type is added. Only the canvas cannot be cloned, so only the charts are swapped for an image |
| No whole page PNG | The browser cannot rasterise DOM, and 27 of the 58 placed widgets are KPI tiles rather than charts, so `getDataURL` reaches half of nothing. It needs a screenshotting dependency, and an approximate one |
| The print sheet names `[echarts]` and puts its canvas back in the flow | zrender positions its canvas absolutely, so the shell's `height: auto` reset leaves the card with nothing in its flow: it collapses to its title while the drawing paints its on-screen width over the neighbouring column. Measured on a real tirage: canvases of 679 and 1414 px in columns of 461, and rows advancing 140 px for a chart 399 px tall. Do not fold the exception back into the reset |
| The span is written twice on a grid cell | A custom property cannot be matched by a selector, and the print sheet has to give a full width widget both of its two paper columns. Halving a trend over three hundred days makes a band of unreadable dates |
| The printed page states its filters instead of showing the bar | Seven period buttons and two empty `dd/mm/yyyy` fields describe an application and never say which period is in force. `DashboardSession.filterContext` feeds the sheet and the standalone file from one place, so the two cannot drift, and `<nxd-dashboard-filters>` carries both the bar and the block replacing it |
| The configuration editor is a text area, not a form | The grammar is already a closed union in the model; a form would be a second description of it, drifting the first time a widget type is added. Validation runs the real planner, so editor and dashboard cannot disagree |
| An override that stops compiling is ignored, not rendered | A configuration can break without being touched, a field having gone away. Falling back to what ships is still correct; a column of errors with no way out is not |
| A path scope is not persisted either | It is the filter a reader is most likely to forget having set, and the one whose figures look perfectly ordinary while describing a corner of the repository |
| A widget declares its query instead of running it | Thirteen requests where there was one would be affordable; figures that stop adding up would not. A partition read from four requests over a moving index is right by luck, and `now` bounds eight tiles at eight different instants |
| The library names one widget per idea, not per shape | Fifty-eight placements are eleven ideas, but a composition saying `topNChart('ecm:primaryType')` is writing a query again. The builders factor, the names do not |
| A composition compiles to `DashboardConfig` rather than replacing it | Everything downstream — planner, compiler, mapper, the four widget components, both exports, the editor — keeps working untouched, and every invariant their tests hold keeps holding |
| A definition goes through typed predicates, never `EsClause` | The passthrough forwards an administrator's payload unmodified, so a `script` clause runs Painless per document. `clause-compiler.ts` closes that for every form by rebuilding each clause out of a closed set; a composition cannot express one at all |
| The editor opens on the source, not on the compilation | Handing back the thirteen widgets a composition stands for answers a question nobody asked, and turns the next edit into a fork of the shipped file rather than a change to it |
| An empty `types` or `facets` means no constraint | The same rule the filter dialog follows. Read the other way, a widget restricted to nothing in particular would match nothing at all |
| A widget reads the session instead of eight inputs | Input drilling works while a grid is the only parent. A widget in a tab, a panel or a bespoke layout has none, so placement would have stayed the engine's business |
| The export root is a directive, not a view query | A query answers whatever came first; only the page knows where its dashboard stops and its chrome begins, and on a bespoke layout that line is wherever its author drew it |
| The grid keeps only its span arithmetic | Drawing a widget is `<nxd-widget>`'s job there as anywhere else, and sizing a row is `<nxd-widget-rows>`'s. Two descriptions of it would drift the first time a widget type is added |
| A layout grammar of exactly two nodes, and no more | The open-ended version was refused for a good reason — every UI idea would want a node, and the grammar would never be complete. What changed is who writes the page. A composition is checked by `validateConfig`, which runs the real planner and *names* what it refuses; a bespoke component is checked by a build, a test run and a `mvn install`, and a layout mistake by nothing at all. `tabs` and `section` cover the reorganisations people actually ask for; anything past them is still a component, deliberately |
| `collapsible` is an attribute of `section`, not a third node | A foldable block and a plain one are one idea seen twice. Two nodes for it would be two things to keep in step, for no expressive gain |
| The grammar is bounded to two levels | A node at the top, rows inside it. Tabs within tabs is a worse screen than the one it replaces, and the bound is what lets the grid draw without recursion — hence without `<ng-template>`, which the dialect does not use |
| A closed tab and a folded section are removed from the DOM, not hidden | zrender sizes a canvas against the box it is mounted in, so a chart started inside a hidden panel paints itself at zero width and stays there. The cost is that neither carries into the HTML export, which is the bargain a snapshot already makes |
| A widget describing configuration stays out of a page describing content | The same filters cannot serve both: retention rules live outside `/default-domain`, so a path scope empties them, and their creation date answers a question nobody asked |
| Bands and table columns live in the definition, not in a parameter | "Under an hour, up to a day, up to a week, beyond" is what that widget means. A parameter for it would need a shape the closed `ParamSpec` union does not have, and a different split is a different idea |

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

Seven live screens — Content, Users, Downloads, Workflows, Tasks, Governance, Diagnostics. Build
green, 932 tests over 51 files. `UpcomingPageComponent` is gone with the last placeholder; the
requirement notice it used to carry is now tested where it lives, in
`requirement-notice.component.spec.ts` — which witnesses on `audit`, deliberately, `setInput` being
untyped and `retention` being the prerequisite most likely to be removed.

**All six are composed.** 69 definitions over five builders — `countTile`, `topNChart`,
`trendChart`, `bandChart`, `recordTable` — filling 65 places on the shipped screens, 64 of them
distinct;
`live-documents` serves both Content and Governance, which is the only sharing so far. Governance
carries 17 of them, split four ways, and its five rule widgets sit on no page: they describe
configuration, and `/RetentionRules` lives outside `/default-domain`, so a path scope would empty
them silently.

**Downloads is the newest, and it is the worked example the customisation guide is written from.**
Seven definitions over `library/downloads/`, every one of them naming
`extended.downloadReason` as well as `eventId: download` — because the event covers a reader
saving a file and the interface fetching a thumbnail alike, and the second outnumbers the first
524 to 15 on the sandbox. Its populations are exclusive and **not** exhaustive, `cmis` and
`cmisRendition` being counted by neither, which is why the two tiles are two answers rather than a
split of one total. It gives `labels: "document"` its second shipped example: `docUUID` resolved
through `GET /api/v1/id/{uuid}`, confirmed live on a real document.

Each migration was proved and then deleted. `migration.harness.ts` planned both forms over three
filter states and compared them, and it lived through commits `d0213fd` to `e7f5235` only, because
the hand written files it compared against went away one by one. Two things it taught, worth
keeping:

- **Byte identity only survives where the old file had no `baseFilter`.** Content, Users and
  Workflows had none, so their plans matched exactly. Tasks and Governance shared clauses that way,
  and a composition cannot express a clause at all, so those clauses moved into the widgets: the
  documents counted are the same and the JSON is not. The harness compared the *effective clauses*
  per widget instead, which is the claim that actually matters.
- **It missed one real difference, which a page test caught.** Governance's `liveDocuments` used to
  be read off `hits.total`, because the page's base filter happened to be exactly its population.
  It now answers under its own wrapper. Across all five dashboards exactly one widget still reads
  `hits.total` — Content's `totalAll`, which constrains nothing and is meant to.

The work is pushed to `github.com/ThibArg/nuxeo-labs-repository-dashboard`, a public backup until
the plugin is ready to be forked into `nuxeo-sandbox`; the README carries a warning saying so, and
`AGENTS.md` is deliberately **not** gitignored in this repository, so keep it free of credentials.

**One roadmap line is still open: the field picker of phase 3b.** It would feed the
configuration editor from `GET /api/v1/config/schemas`, which **nothing in the application calls
today** — `NuxeoHttpService.get` is the way in, and it would be that endpoint's first caller.

Measured on the sandbox, so that a session does not have to guess the shape: a **flat array of 91
objects**, each `{ name, "@prefix", fields }`. A field maps to a type string — `string`,
`string[]`, `boolean`, `date`, `long`, `double`, `blob`, `blob[]` — or, in **13 of the 91**, to an
object `{ type: "complex" | "complex[]", fields: { … } }` that nests further.

Two traps the picker has to survive. **`@prefix` is sometimes the empty string**, `l10nvocabulary`
and `oauth2Client` among others, and a field of such a schema is addressed by the schema name
instead. And a type alone does not say whether a field can be aggregated: the README's "Indexing
rules worth knowing" is where that lives — never a `.keyword` suffix, a dot rather than a slash
inside a complex property, `dc:title` readable from `_source` but not aggregatable,
`ecm:retainUntil` written only when non null, `thumb:thumbnail.*` and `picture:views.*` mapped
`index: false`. A picker offering a field the compiler will refuse is worse than no picker, and
`agg-compiler.ts` already refuses the first two by construction.

Governance reads the repository index, every widget narrowing to live, untrashed, non-versioned,
non-proxy documents through `GOVERNED_REPOSITORY` in `library/governance/populations.ts`. That
last pair is near-tautological and deliberately kept: a record can be neither checked in nor
published, so no version and no proxy ever carries one, which means the populations never double
count the way Content's proxies do. They are `RECORDS`, `GOVERNED_BY_A_RULE` (the `Record` facet),
`UNDER_RETENTION`, `UNDER_LEGAL_HOLD` and `RETENTION_RULES`, and the three horizon tiles partition
`UNDER_RETENTION` exactly — a spec evaluates every clause a widget carries together, since the
lower bound of all three comes from the population rather than from the tile.

**The obstacle both files used to name is lifted.** The sandbox held no record, no legal hold, no
`ecm:retainUntil` and no `RetentionRule` at all, so a Governance page would have rendered a column
of zeroes with no read-only way to tell a correct empty page from one querying a field that does
not exist. A reversible fixture now sits in
`/default-domain/workspaces/governance-fixture`: 23 throwaway documents and three `RetentionRule`
documents under `/RetentionRules`, all named `gov-fixture-*`. 22 records, 2 legal holds, 19
retentions over three horizons, two document types, and one untouched control. **The creation and
teardown scripts live outside this repository** — they write to a server and have no business in a
public plugin — and the teardown was run for real, to zero, before the fixture was rebuilt.

**What the live index then established**, none of which was decidable read-only, and all of which
the README's "Indexing rules worth knowing" now carries as rules:

- `record:ruleIds` does reach the index once a first record exists, and both `terms` and
  `cardinality` answer on it. That was the open question, and it is closed.
- `ecm:isFlexibleRecord` never does. Do not design a widget that separates flexible from enforced.
- The `Record` facet is the only discriminant left, and the fixture measures the gap it describes:
  22 records against 19 facets.

**Three things the fixture still cannot prove**, to be treated like "N targeting trashed":
`record:retainUntil`, which only a passing expiry fills; `Document.UnattachRetentionRule` against
an enforced record, refused by construction; and a document carrying a legal hold *and* a
retention, deliberately left out because `Document.Hold` hardens a record irreversibly and its
cleanup would then have to wait for the date.

**The design question the fixture raised is settled.** `record:ruleIds` holds document uuids, and
no `LabelStrategy` resolved one, so a "by rule" chart would have drawn bare uuids. A `document`
strategy now does, through `GET /api/v1/id/{uuid}`, sharing the user lookup's in-flight cache —
which is why the two now go through one `resolveCached` helper rather than two copies of the same
eighteen lines. The fixture carries three rules rather than one so that the chart has something to
show, and the live index resolves all three to their titles.
