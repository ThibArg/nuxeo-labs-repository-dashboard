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
npm test                                      # 40 files, vitest + jsdom
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

## How it is wired

- **No Java at all.** Four resources under `nuxeo-labs-repository-dashboard-web/nuxeo/` deploy the
  SPA; the jar carries the Angular output under `nuxeo.war/dashboard/`. The README's "Deployment"
  table says which resource does what.
- **A widget declares the index it reads, and `planDashboard` groups by it** — one request per
  index present on the page, not one per dashboard and not one per widget. The old limit is gone,
  so a page *can* now read the repository and the audit in the same breath. What has not changed
  is that a trustworthy "workflows running now" figure needs `DocumentRoute` on the repository
  index, which is now a matter of adding that widget rather than of splitting the page.
- **Two forms of dashboard file coexist, and will for a while.** Content is a *composition*, which
  names widgets from `src/app/library/` and compiles to the configuration everything downstream
  already understood; the other four are still written as that configuration. `isComposition`
  discriminates on a `use` key inside a layout cell, which a compiled layout cannot hold — its
  cells are plain strings. Use `src/testing/shipped.ts` in a spec rather than casting the import,
  or the spec goes green for the wrong reason the day that dashboard is migrated.
- **Declaring a widget and placing it are two different things.** A composition may use `layout`,
  which the twelve column grid draws, or a flat `widgets` list, which a page component places
  itself. `DashboardSession` — provided per page, like `DashboardRunner` — holds everything a
  reader does to a dashboard, and `<nxd-widget for="…">`, `<nxd-dashboard-filters>`,
  `<nxd-dashboard-header>` and `[nxdExportRoot]` all read it, so a bespoke screen writes a template
  and nothing else. `pages/bespoke-layout.spec.ts` is the worked example; there is no such screen
  in the product, deliberately.
- **Dashboards are JSON** in `src/app/config/dashboards/`, copied to `assets/dashboards/` by
  `angular.json` and fetched at runtime. The specs `import` those very files, so a shipped
  configuration cannot drift from what is tested.
- **An administrator's edit wins over the shipped file.** `DashboardConfigService.load` asks
  `DashboardOverrideService` (`engine/dashboard-override.service.ts`, `localStorage` under
  `nxd.config.<dashboard>`) before fetching the asset, and ignores an override that no longer
  compiles. The editor itself is `layout/config-editor.component.ts`, a `<dialog>` holding one
  text area, opened from the Configure button in `layout/page-header.component.ts` and wired in
  `pages/dashboard-page.component.ts` by `openEditor`, `validateDraft`, `saveConfig` and
  `revertConfig`. `validateConfig`, beside the override service, is the gate: it runs the real
  planner rather than restating its rules.

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

- **One request per index.** Adding a widget must not add a round trip, and every dashboard that
  ships reads one index, so in practice that is still one request each. Table widgets are the
  only exception, because they need `hits`. Do not be tempted to give a widget its own request:
  the cost is not the round trips, it is that a partition read from four of them adds up by luck,
  and that `now` — which OpenSearch evaluates per request — stops being one instant across the
  tiles bounded by it.
- **`AggConfig` stays a closed union, and `agg-compiler.ts` stays its only compiler.** No raw DSL
  reaches the passthrough, which would forward `script` verbatim for an administrator.
  `facet-values.service.ts` once built its own JSON and so escaped every guarantee; it no longer
  does.
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

The whole of the shipped configuration was confronted this way once: 17 planned requests over the
four dashboards and every date range, all accepted, `shard_size` on every `terms`, `time_zone` on
every histogram, `extended_bounds` only on the field the date filter constrains, `ecm:uuid` in the
table's `_source`, and `percentiles` keyed `"50.0"`. Two assertions failed and **both were the
harness's fault** — it demanded bounds on every histogram, and read the percentile under `inner`
rather than under `metric`. Worth remembering before concluding that a red live check means the
application is wrong.

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
- **In `audit_wf`, `docType` and `docUUID` name the route or the task, never the business
  document.** A "documents entering a workflow" widget was designed on the opposite assumption and
  dropped. A table linking back to Web UI fails for the same reason: the planner always adds
  `ecm:uuid` to `_source`, which the audit does not have.
- **`percentiles` answers a map under `values`**, keyed as OpenSearch formats it (`"50.0"`, but
  `"99.9"` for a fractional percent), so `result-mapper` reads the single entry rather than
  recomposing the key — and it sits under `metric`, not under the bucket name. Being multi-valued,
  a `terms` ordered by it needs `metric.50` in the order path, not `metric`. **That ordering path
  is the one thing no shipped configuration exercises**: the only two ordered `terms` in
  `workflows.json` sort by `avg`, so it has never been confronted with a live index.
- **`Blob.text()` strips a byte order mark**, the UTF-8 decode algorithm removing one by
  definition, so no assertion on the text of an exported CSV can ever see it. The mark is what
  keeps Excel from reading UTF-8 as the local encoding, so it is worth proving: read the bytes.
- **`ChartWidgetComponent` cannot be rendered under jsdom**, ECharts needing a canvas, so its CSV
  rows are built by `bucketRows` and tested there while `getDataURL` is exercised nowhere. That
  call, and the white background given to the PNG, have never run outside a real browser.
- **`link: "document"` and `labels: "boolean"` ship with no example either.** Both had one, in the
  Governance record table, and lost it when that widget was dropped. They stay covered by
  `data-table.component.spec.ts` and `label.service.spec.ts`, so this is not a gap in the suite —
  it is the same caveat as the order path above: nothing has put them on a real screen.
- **`@children` trails a write by about a second.** Listing a container straight after creating
  twenty-three documents in it answered six. `CURRENT_DOC_CHILDREN` is declared a
  `coreQueryPageProvider` and no Elasticsearch override of it exists anywhere in the LTS 2025 tree,
  so this is not the indexing lag it looks like. Any script that enumerates what it has just
  written has to converge rather than read once.

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
| No whole page PNG | The browser cannot rasterise DOM, and 27 of the 54 shipped widgets are KPI tiles rather than charts, so `getDataURL` reaches half of nothing. It needs a screenshotting dependency, and an approximate one |
| The configuration editor is a text area, not a form | The grammar is already a closed union in the model; a form would be a second description of it, drifting the first time a widget type is added. Validation runs the real planner, so editor and dashboard cannot disagree |
| An override that stops compiling is ignored, not rendered | A configuration can break without being touched, a field having gone away. Falling back to what ships is still correct; a column of errors with no way out is not |
| A path scope is not persisted either | It is the filter a reader is most likely to forget having set, and the one whose figures look perfectly ordinary while describing a corner of the repository |
| A widget declares its query instead of running it | Thirteen requests where there was one would be affordable; figures that stop adding up would not. A partition read from four requests over a moving index is right by luck, and `now` bounds eight tiles at eight different instants |
| The library names one widget per idea, not per shape | Fifty-four widgets are eleven ideas, but a composition saying `topNChart('ecm:primaryType')` is writing a query again. The builders factor, the names do not |
| A composition compiles to `DashboardConfig` rather than replacing it | Everything downstream — planner, compiler, mapper, the four widget components, both exports, the editor — keeps working untouched, and every invariant their tests hold keeps holding |
| A definition goes through typed predicates, never `EsClause` | The four dashboards still in the old form carry 27 hand written clauses, using two shapes in the end, and the passthrough forwards `script` verbatim for an administrator. A composition cannot express a clause at all |
| The editor opens on the source, not on the compilation | Handing back the thirteen widgets a composition stands for answers a question nobody asked, and turns the next edit into a fork of the shipped file rather than a change to it |
| An empty `types` or `facets` means no constraint | The same rule the filter dialog follows. Read the other way, a widget restricted to nothing in particular would match nothing at all |
| A widget reads the session instead of eight inputs | Input drilling works while a grid is the only parent. A widget in a tab, a panel or a bespoke layout has none, so placement would have stayed the engine's business |
| The export root is a directive, not a view query | A query answers whatever came first; only the page knows where its dashboard stops and its chrome begins, and on a bespoke layout that line is wherever its author drew it |
| The grid keeps only its span arithmetic | Drawing a widget is `<nxd-widget>`'s job there as anywhere else. Two descriptions of it would drift the first time a widget type is added |
| No tabs, no sections, no layout grammar | Every UI idea would need a new grammar node and a new component, and the grammar would never be complete. Angular already is that language |

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

Six live screens — Content, Users, Workflows, Tasks, Governance, Diagnostics. Build green, 558
tests over 42 files. `UpcomingPageComponent` is gone with the last placeholder; the requirement
notice it used to carry is now tested where it lives, in `requirement-notice.component.spec.ts`.

**Content is composed, the other four are still configured.** Thirteen definitions live in
`src/app/library/content/`, over three builders — `countTile`, `topNChart`, `trendChart` — and
five named populations. Migrating the rest is phase 6d, and the shape to copy is there. The
equivalence of the two forms was proved and then deleted: `content-composition.spec.ts` planned
both and compared the requests byte for byte, and it lived in commit `0d1117c` alone, because the
hand written file it compared against went away in the next one.

Two things the library still lacks, and both matter before phase 6d. **No audit widget exists**,
so the two-index grouping is exercised by `index-grouping.spec.ts` and by a live probe, never by
anything that ships. And **`topNChart` carries neither `order` nor `metric`**, which Workflows
needs for the two `terms` it orders by `avg` — add them there rather than writing a fourth
builder.

The work is pushed to `github.com/ThibArg/nuxeo-labs-repository-dashboard`, a public backup until
the plugin is ready to be forked into `nuxeo-sandbox`; the README carries a warning saying so, and
`AGENTS.md` is deliberately **not** gitignored in this repository, so keep it free of credentials.

**Phases 2 and 3 shipped, so the field picker of phase 3b is all that is left.** It would feed the
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

`governance.json` reads the repository index under a `baseFilter` of live, untrashed,
non-versioned, non-proxy documents. That last pair is near-tautological and deliberately kept: a
record can be neither checked in nor published, so no version and no proxy ever carries one, which
means the scopes never double count the way Content's proxies do. Its scopes are `all`, `records`,
`governed` (the `Record` facet), `retained` and `held`, and the three horizon tiles partition
`retained` exactly — a spec evaluates scope and widget filter together, since the lower bound of
every tile comes from the scope alone.

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
