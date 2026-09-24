# Nuxeo Labs Repository Dashboard

> [!IMPORTANT]
> This plugin is **WORK IN PROGRESS** — do not use it as is for now. It will be published in the
> `nuxeo-sandbox` repository once ready. For now, we use GitHub mainly as a backup.

An administrator facing analytics dashboard for a Nuxeo repository, served by the platform at
`/nuxeo/dashboard/` and reachable from the Web UI Administration menu.

The dashboard is a standalone Angular application packaged as a Nuxeo bundle. Charts and figures
are described by configuration rather than hard coded, and the widgets of one index are batched
into a single OpenSearch aggregation request.

> **Status: seven screens live.** Content, Users, Downloads, Workflows, Tasks and Governance are
> complete, alongside Diagnostics. All six are composed from a reusable widget library of 69
> definitions, see [Roadmap](#roadmap).

> **Want a dashboard of your own?** This plugin is meant to be forked and changed, and it was built
> to be changed with an AI assistant. See
> [CUSTOMISING.md](CUSTOMISING.md) — the four layers a change can belong to, a prompt to paste for
> each kind of change, what to verify, how to ship your own renamed package, and the security
> checklist to run on the diff.

> **How this was made.** The plugin was written with an AI assistant — OpenCode driving Claude Opus
> 5, in September 2026 — and it is meant to be maintained the same way. What that changes for
> whoever picks it up, and what stands in for a line by line human reading, is set out in
> [CUSTOMISING.md](CUSTOMISING.md#written-with-an-assistant-and-maintained-with-one).

## Screens

| Screen | Data source |
| --- | --- |
| **Content** | Repository index: repository composition (live, trashed, versions, proxies), `ecm:primaryType`, `ecm:currentLifeCycleState`, `dc:created`, `dc:modified`, `dc:creator`, `dc:expired` |
| **Users** | Audit index: `loginSuccess`, `loginFailed`, `documentCreated` and `documentModified`, grouped by `principalName` over `eventDate` |
| **Downloads** | Audit index: the `download` event split by `extended.downloadReason`, with `docUUID`, `docType` and `principalName` over `eventDate` |
| **Workflows** | `audit_wf` passthrough view: workflow state derived from `eventId`, `extended.modelName`, `extended.workflowInitiator`, `extended.taskName`, `extended.action`, and durations from `extended.timeSinceWfStarted` and `extended.timeSinceTaskStarted` |
| **Tasks** | Repository index: open tasks only, through the `Task` facet — `nt:dueDate`, `nt:actors`, `nt:name`, `nt:directive` |
| **Governance** | Repository index: `ecm:isRecord`, `ecm:hasLegalHold`, `ecm:retainUntil`, the `Record` facet through `ecm:mixinType`, and `record:ruleIds` resolved against the `RetentionRule` documents |
| **Diagnostics** | The preflight report, always available |

## Composing a dashboard

A dashboard names widgets from a library and says where they go. Adding a chart means naming one
more, not writing a query.

```jsonc
{
  "id": "content",
  "label": "Content Dashboard",
  "filters": [{ "type": "dateRange", "field": "dc:created", "default": "all" }],
  "layout": [
    {
      "cells": [
        { "use": "documents-by-type", "as": "byType", "span": 6 },
        { "use": "documents-created", "as": "created", "span": 6, "with": { "interval": "week" } }
      ]
    }
  ]
}
```

| Key | Meaning |
| --- | --- |
| `use` | Id of a widget in the library, `src/app/library/` |
| `as` | Name it takes on the page, defaulting to `use`. Must be unique |
| `title` | Card title, overriding the widget's own |
| `hint` | Secondary line under the title; `{range}` is replaced by the active date range, `{interval}` by the width of a trend's bars |
| `span` | Width in the 12 column grid; omitted spans share the row evenly |
| `spanByRange` | Overrides `span` for a given date range id |
| `with` | Parameters the widget declares, see below |

Beside the layout, a composition carries `id`, `label`, an optional `subtitle` shown under the
title, and `filters`. A screen laid out by hand replaces `layout` with a flat `widgets` list. A
page whose widgets read more than one index also carries `index`, naming the one its filters are
written against.

`as` has to be unique because it is what names the aggregation inside the shared request. That
naming — after the widget rather than after the field — is precisely what lets two widgets reading
the same field travel together instead of overwriting each other.

### Grouping widgets: sections and tabs

A `layout` is a list of three kinds of entry. A **row** puts widgets side by side. A **section**
gives a group of rows a heading, and optionally a fold. A **tabs** shows one panel at a time.

```jsonc
"layout": [
  { "cells": [{ "use": "total-documents", "as": "total", "span": 12 }] },

  {
    "section": "Trends",
    "collapsible": true,
    "rows": [{ "cells": [{ "use": "documents-created", "as": "created" }] }]
  },

  {
    "tabs": [
      { "label": "Creation",     "rows": [{ "cells": [{ "use": "documents-created",  "as": "created2" }] }] },
      { "label": "Modification", "rows": [{ "cells": [{ "use": "documents-modified", "as": "modified" }] }] }
    ]
  }
]
```

| Key | Meaning |
| --- | --- |
| `section` | Heading shown above the rows |
| `collapsible` | Adds a fold control. Without it the block is always open |
| `collapsed` | Starts folded. Only read when `collapsible` is true |
| `tabs` | Panels, each with a `label` and its own `rows` |

The grammar is **bounded to two levels**: an entry at the top, rows inside it. No tabs within tabs
and no sections within sections — that screen is worse than the one it replaces, and the bound is
what keeps the grammar small enough to hold in your head. Anything past it is a page component,
which is what "Laying it out yourself" below is for.

Three things worth knowing before using either:

- **Every widget is fetched, on screen or not.** A tab nobody opened and a section left folded are
  planned with the rest, in the same request, at the same instant. That is what makes opening a tab
  free and what lets two tabs be compared. The price is paying for what is not being looked at.
- **A closed panel is removed from the page, not hidden.** ECharts sizes a chart against the box it
  is drawn in, so a chart started inside a hidden panel would paint itself at zero width and stay
  that way. The consequence is that **the HTML export carries the tab that was open** and not the
  others, exactly as a photograph carries what was in frame.
- **On paper the strip becomes a heading.** The tab strip and the fold control are controls, so
  print and the standalone file drop them — and the open panel then names itself, or the reader
  would be looking at figures that nothing accounts for.

### The widget library

Each widget is a dozen lines in `nuxeo-labs-repository-dashboard-web/src/app/library/`, carrying a
semantic id, the index it reads, one sentence saying what it measures, and the parameters it
accepts. **The definitions are the catalogue**: point an assistant at that folder and it has
everything it needs, with nothing generated to fall out of step.

**69 definitions filling 65 places on the six shipped screens**, grouped by subject. Sixty-four
of them are placed — `live-documents` twice — and the five describing retention rules are not:

| Folder | Reads | Widgets |
| --- | --- | --- |
| `content/` | repository | 13 — composition tiles, expiry, breakdowns, trends |
| `users/` | `audit` | 5 — logins, failed logins, who creates and modifies |
| `downloads/` | `audit` | 7 — files saved against renditions served, by day, type, person and document |
| `workflows/` | `audit_wf` | 18 — volumes, durations, models, steps, initiators |
| `tasks/` | repository | 9 — what is waiting on whom, and how late |
| `governance/` | repository | 17 — records, retention horizon, legal holds, and the rules themselves |

Downloads is the one domain whose populations exist to separate two readings of a single event.
`download` is audited out of the box and is fired both by a reader saving a file and by the
interface fetching a thumbnail: measured on a repository in ordinary use, 524 of 539 entries were
renditions. So every widget there names `extended.downloadReason` as well, and the screen shows
the two figures side by side rather than presenting either of them as "downloads".

Governance is split four ways — `records.ts`, `horizon.ts`, `holds.ts`, `rules.ts` — because they
answer different questions: what is protected, until when, what cannot be touched at all, and how
the protection is configured. Its page draws on the first three; `live-documents` comes from
Content, whose population is exactly the one Governance figures are a share of. The first widget
two screens have in common, which is the point of a library.

**The five rule widgets sit on no shipped page, deliberately.** They describe configuration rather
than content, and the two do not survive the same filters: retention rules live under
`/RetentionRules`, outside `/default-domain`, so narrowing a page to a container would empty them
without saying why. Compose them onto a screen where the content filters have no business.

```ts
export const documentsCreated = defineWidget<TrendParams>({
  id: 'documents-created',
  index: 'nuxeo',
  title: 'Documents Created',
  summary: 'How many live documents were created, over time.',
  params: TREND_PARAMS,
  build: (params) => trendChart({ of: [...LIVE_NOT_TRASHED, ...restrict(params)], ... }),
});
```

Sixty-five widgets are placed across the six screens, and counting a population and ranking the top
values of a field account for fifty-four of them on their own — so the reuse lives in
**five builders**,
`countTile`, `topNChart`, `trendChart`, `bandChart` and `recordTable`, while the *names* stay one
per idea. A composition saying `topNChart('ecm:primaryType')` would be back to writing queries by
hand.

Two things a builder takes and a composition cannot: the bands of a distribution, and the columns
of a table. "Under an hour, up to a day, up to a week, beyond" *is* what
`workflow-duration-distribution` means — a different split is a different widget, not a setting.

The thirteen Content definitions accept `types` and `facets`, which narrow them to a few document
types or to documents carrying a facet. The other repository widgets do not declare them, and a
parameter a definition never declared is **refused rather than ignored**. An empty list means **no
constraint**, never "no value": compiled the other way, a widget restricted to nothing in
particular would match nothing at all.

#### What a parameter may be

A closed union, and the contract a composition is written against. The build function's argument is
**derived** from it, so the two cannot disagree: reading a parameter the widget never declared does
not compile.

| `type` | Extra keys | What `with` accepts |
| --- | --- | --- |
| `number` | `min`, `max` | a number, refused outside the bounds |
| `string` | | a string |
| `string[]` | | a list of strings; empty means no constraint |
| `boolean` | | `true` or `false` |
| `enum` | `values` | one of `values`, and nothing else |

Every one of them takes `default` and `describe`. A parameter with a default is always present when
the widget builds; one without may be absent. **A parameter the definition never declared is
refused rather than ignored** — a misspelt one would otherwise produce a widget that renders
perfectly while describing something else.

### Why a recipe rather than a component

A widget that ran its own search would be simpler to compose and would cost thirteen requests
where Content costs one. The round trips are affordable — this is a page a few administrators
open. The arithmetic is not.

Content shows `total = live + trashed + versions + proxies`, and figures read from four separate
requests over a moving index add up by luck. The expiry tiles are worse: they are bounded by `now`,
which OpenSearch evaluates when it *receives* a request, so one request means one instant and
eight mean eight — and a document expiring at exactly J+7 can then be counted twice or not at all.

### Laying it out yourself

The twelve column grid is a default, not a constraint. A dashboard can declare its widgets without
saying where they go, and a page component then puts them wherever it likes — tabs, panels,
anything its author writes.

```jsonc
{
  "id": "content-tabs",
  "label": "Content",
  "filters": [{ "type": "dateRange", "field": "dc:created" }],
  "widgets": [
    { "use": "documents-created",  "as": "createdTrend" },
    { "use": "documents-modified", "as": "modifiedTrend" },
    { "use": "top-contributors",   "as": "topContributors" }
  ]
}
```

```ts
@Component({
  providers: [DashboardRunner, DashboardSession],
  imports: [DashboardHeaderComponent, DashboardFiltersComponent, WidgetComponent, ExportRootDirective],
  template: `
    <nxd-dashboard-header />
    <section class="px-8 pb-8" nxdExportRoot>
      <nxd-dashboard-filters />

      <!-- From here on, everything belongs to whoever writes this page. -->
      <div role="tablist" class="flex gap-2 border-b border-subtle">
        <button (click)="tab.set('creation')">Creation</button>
        <button (click)="tab.set('modification')">Modification</button>
      </div>

      @if (tab() === 'creation') {
        <div class="nxd-grid">
          <nxd-widget for="createdTrend" [style.--nxd-span]="8" [attr.data-span]="8" />
          <nxd-widget for="topContributors" [style.--nxd-span]="4" [attr.data-span]="4" />
        </div>
      } @else {
        <nxd-widget for="modifiedTrend" />
      }
    </section>
  `,
})
export class ContentTabsPage {
  private readonly session = inject(DashboardSession);
  readonly tab = signal<'creation' | 'modification'>('creation');
  constructor() { void this.session.open('content-tabs'); }
}
```

Four reusable pieces, all reading the same session and none needing a single input wired:

| Tag | What it carries |
| --- | --- |
| `<nxd-dashboard-header />` | Title, Refresh, Export page, Configure, and the editor behind it |
| `<nxd-dashboard-filters />` | Period, container picker, facet groups, chips, and their dialogs |
| `<nxd-widget for="…" />` | One widget, drawn wherever the tag sits |
| `[nxdExportRoot]` | Which part of the page the HTML export takes away |

`DashboardSession` is what they all read: which configuration is in force, what it is filtered by,
what the last run answered. It is provided **per page** — a component placing widgets must declare
`providers: [DashboardRunner, DashboardSession]`, or injection fails at construction.

Four consequences worth knowing before building tabs:

- **Every declared widget is fetched, on screen or not.** A tab nobody has opened costs nothing to
  open, and its figures describe the same instant as the ones being read. The price is paying for
  what is not being looked at.
- **A chart that has never been rendered has no photograph**, so the HTML export of a tabbed page
  carries the tab that was open. A snapshot shows what was on screen, which is defensible, but it
  is not everything the dashboard declares.
- **A `<nxd-widget>` naming something the configuration no longer declares says so** rather than
  rendering nothing. An administrator who removed it from the composition has no other way of
  finding where the template still asks for it.
- **The span is written twice**, as a custom property for the screen and as `data-span` for paper:
  a selector cannot match a custom property, and the print sheet needs one to give a full width
  widget both of its two paper columns. The grid does it; a bespoke page placing widgets by hand
  has to do it too.

### The compiled form

A composition compiles to the configuration the engine plans, batches and renders, and a dashboard
may also be written in that form directly. **No shipped dashboard is**, all six being
compositions; what still arrives in this form is an edit stored by an administrator before the
migration, which is why it is still accepted and still documented.

```jsonc
{
  "id": "content",
  "index": "nuxeo",
  "layout": [{ "cells": ["byType"] }],
  "widgets": {
    "byType": {
      "type": "donut",
      "label": "By Document Type",
      "span": 6,
      "labels": "doctype",
      "agg": { "terms": { "field": "ecm:primaryType", "size": 10 } }
    }
  }
}
```

The layout grammar is the same here, with plain widget names in place of `use` cells: a `cells`
entry holds strings, and `section` and `tabs` nest rows of them exactly as a composition does.

| Key | Values |
| --- | --- |
| `type` | `kpi`, `donut`, `pie`, `bar`, `hbar`, `line`, `area`, `ranked-list`, `table` |
| `agg` | `terms`, `date_histogram`, `range`, `date_range`, `filters` |
| `agg.date_histogram.time_zone` | IANA zone the buckets are cut in; defaults to the reader's own |
| `metric` | `count`, `cardinality`, `sum`, `avg`, `min`, `max`, `percentile` — nested under the aggregation |
| `index` | Index this widget reads, when it is not the dashboard's own |
| `scope` | Named population this widget describes, see below |
| `labels` | `raw`, `doctype`, `lifecycle`, `user`, `document`, `boolean`, `message`, `workflowModel` |
| `lookup` | `user` on a filter member: ranks values by volume and searches the directory as the reader types |
| `format` | `integer`, `decimal`, `bytes`, `percent`, `duration`, `date`, `daysUntil`, `text` |
| `filter` | Extra OpenSearch clauses for this widget only, compiled into a `filter` aggregation |
| `secondary` | A second figure under a KPI, counted within the tile's own population |
| `severity` | Colour a KPI carries: `neutral`, `accent`, `warning`, `danger`, `success` |
| `limit` | Caps how many buckets are drawn, independently of the aggregation size |
| `columns`, `sort`, `size` | A table's columns, its ordering and how many rows it fetches |
| `agg.terms.order` | `count_desc` by default; `metric_desc` ranks by the metric instead |
| `agg.terms.missing` | Value counted for documents where the field is absent |
| `agg.date_histogram.format` | Java pattern for the bucket key, e.g. `yyyy-MM` |
| `agg.date_histogram.min_doc_count` | `0` by default, so a quiet day stays a bar. `1` drops the empty buckets, which only suits a field whose values are scattered rather than a trend |
| `span` | Width in the 12 column grid; omitted spans share the row evenly |
| `spanByRange` | Overrides `span` for a given date range id |
| `hint` | Secondary line under the title; `{range}` is replaced by the active date range, `{interval}` by the width of a trend's bars |
| `subtitle` | On the dashboard, not the widget: a sentence under the page title |

Aggregations are a **closed whitelist**, not raw OpenSearch DSL. The passthrough forwards an
administrator's payload verbatim, so accepting arbitrary DSL from a configuration file would also
accept `script` and `runtime_mappings`. `agg-compiler.ts` is the only code that emits aggregation
JSON, and it rejects anything else — including a `.keyword` suffix, which would silently match
nothing on a Nuxeo index.

**Filters are closed too, since `clause-compiler.ts`.** `baseFilter`, `scopes`, a widget's
`filter`, a secondary figure's, and the sub-filters of a `filters` aggregation are typed
`EsClause`, and every one of them is now rebuilt out of a closed set — `term`, `terms`, `range`,
`exists`, `bool` — rather than forwarded. Rebuilding rather than checking is the point: a clause
that passes leaves nothing behind it, so a key nobody thought to refuse cannot ride along beside
one that was accepted.

Two shapes are worth naming among the refusals. A `script` clause runs Painless per document under
the administrator's identity, the passthrough forwarding their payload unmodified. And a `terms`
clause may be given an *object* naming an index, an id and a path, which reads the values out of
that document — a read of an index this application never declared, wearing the clothes of an
ordinary filter.

A widget definition goes through four typed predicates on top of that — `equals`, `anyOf`,
`dateWindow`, `exists` — and a composition cannot express a clause at all.

## Scopes

A widget can only ever narrow the shared query, never widen it. Putting "exclude versions and
proxies" in `baseFilter` would therefore make it impossible to also show how many versions exist.
Populations solve that: the distinction lives on the widget, not on the dashboard.

A widget definition states its own, out of `library/populations.ts`:

```ts
export const LIVE_NOT_TRASHED: Predicate[] = [notVersion, notProxy, notTrashed];
export const TRASHED: Predicate[] = [notVersion, notProxy, equals('ecm:isTrashed', true)];
export const VERSIONS: Predicate[] = [equals('ecm:isVersion', true), notProxy];
export const PROXIES: Predicate[] = [equals('ecm:isProxy', true)];
```

The compiled form names them at the page level instead, and widgets point at one by name. No
shipped file does this any more; the grammar remains for an edit stored before the migration:

```jsonc
"defaultScope": "liveNotTrashed",
"scopes": {
  "all":            [],
  "liveNotTrashed": [{"term":{"ecm:isVersion":false}},{"term":{"ecm:isProxy":false}},{"term":{"ecm:isTrashed":false}}],
  "trashed":        [{"term":{"ecm:isVersion":false}},{"term":{"ecm:isProxy":false}},{"term":{"ecm:isTrashed":true}}],
  "versions":       [{"term":{"ecm:isVersion":true}},{"term":{"ecm:isProxy":false}}],
  "proxies":        [{"term":{"ecm:isProxy":true}}]
}
```

The four non-empty populations partition the repository exactly, so the composition row adds up:

```
liveNotTrashed + trashed + versions + proxies = all
```

Measured on the test instance: 709 + 87 + 3091 + 46 = 3933, which is `hits.total`. Stating them in
the library rather than in each configuration file is what turns that into a property one test
holds for good, evaluated against synthetic documents rather than read off the clauses.

Every Content chart describes the same population as the "Live" tile — each widget states it
rather than leaving it to be guessed. The clauses are added to the `filter` aggregation the
planner already emits per widget, so this costs **no extra request**.

### Two things the trash does that are not obvious

**Proxies are never trashed.** `PropertyTrashService.doTrashDocument` removes them outright.
However a proxy *reads* `ecm:isTrashed` from its target, so a proxy pointing at a trashed document
is indexed with `ecm:isTrashed: true` (NXP-30219). The proxies tile therefore labels its secondary
figure *targeting trashed*: it counts orphan publications, not deleted proxies.

**Versions are trashed more often than you would expect.** Trashing does *not* propagate to
versions: it descends through `ecm:ancestorId`, which versions do not have, and the platform has a
unit test asserting a version stays untrashed when its live document is trashed. But
`ecm:isTrashed` is copied verbatim at check-in — neither `DBSSession.copy` nor `SQLInfo.getCopyHier`
resets it — so **a version created while its document was already in the trash is born trashed**.
On a real repository this is not marginal: 105 such versions were counted on the test instance. The
tile therefore keeps the figure, and only hides it when it really is zero.

The same blind copy works in reverse: restoring a version overwrites the live document's
`ecm:isTrashed` with the version's value.

### Day buckets are cut in the reader's zone

A `date_histogram` without `time_zone` is cut at UTC midnight, so a document created at 23:30 in
Paris is credited to the previous day and an evening of activity lands on the wrong bar. The
compiler therefore sends the reader's own zone, taken from
`Intl.DateTimeFormat().resolvedOptions().timeZone`.

An IANA name is sent rather than a fixed offset: a range spanning a daylight saving change is then
cut correctly on both sides of it, which `+02:00` could not do. A dashboard meant to read the same
for every reader can pin it:

```jsonc
"agg": { "date_histogram": { "field": "dc:created", "calendar_interval": "day", "time_zone": "UTC" } }
```

### The width of a bar follows the period

A trend's `interval` defaults to `auto`. OpenSearch refuses a response holding more than 65,535
buckets in all (`search.max_buckets`), and a histogram keeping its empty buckets spans whatever it
is given: one migrated document dated 1899-12-30 makes a daily chart over "All time" 46,000 bars.
Two such charts, or a date a century older, and the whole request fails, every widget on the page
with it. So the planner decides the width:

| Where | Width |
| --- | --- |
| The period bounds the very field the chart groups by, at both ends | Chosen from its days: a day up to 92, a week up to two years, a month up to twenty, a year beyond |
| Anywhere else — "All time", a range open at one end, `dc:modified` under a filter on `dc:created` | Left to OpenSearch: an `auto_date_histogram` of at most 100 buckets, never narrower than a day |

The first case is the only one whose span the planner can know, since the query keeps every entry
inside the period; `extended_bounds` still pads it, derived from the period and never configured.
In the second, OpenSearch widens the bars until the dates fit, so a stray 1601 costs the chart its
resolution rather than costing the page its request. Its empty buckets are kept too, which matters
here: the x axis lists buckets rather than scaling time, so a missing bucket would not leave a gap,
it would move the next bar up against the previous one. That is also why `min_doc_count: 1`, which
would bound the count just as well, is not the answer on a trend — an 1899 bar would sit right
beside 2024.

Measured on the test instance, with each trend pinned to `day` as it used to be: a range typed from
1800 failed on every dashboard drawing a trend, and one from 1899 on Workflows, its two charts
padding to 2 × 46,289 buckets. With `auto`, all of them answer — 128 yearly bars from 1899, and
fifty-three weekly bars over Last 12 months where there were 365 daily ones.

A composition naming a width keeps it: `"with": { "interval": "day" }` draws by the day whatever the
period, and takes back the risk above on "All time". `min_doc_count` cannot be written beside `auto`,
`auto_date_histogram` having no such setting.

### Reminding the reader of the active range

A widget sitting below the fold loses sight of the date range picker, and a tile pasted into a
slide loses the page altogether. So every widget the period constrains states it on its card,
under the title and the hint — "Last 12 months", "All time", or the two days of a typed range — and
follows it when it changes. On Content that is what tells the Total tile's reader they are looking
at a year of the repository rather than all of it.

A widget whose index the period does not constrain states nothing: Tasks declares no period, and
on a page mixing two indices a `byIndex` of `""` leaves one half out of it. A period written over
a figure it never touched would mislead as much as silence over one it did. The line is drawn by
`<nxd-widget>`, so a tab, a bespoke layout and the HTML export carry it alike.

A hint can still name the period in its own words, through `{range}`:

```jsonc
"createdTrend": { "hint": "Created per {interval} ({range})" }
```

The shipped definitions no longer do, the card saying it already. One wording remains worth
keeping whatever the placeholder: the period filters `dc:created` while "Documents Modified"
buckets `dc:modified`, so its hint says the chart counts modifications *among the documents created
in the period*, not modifications made during it.

`{interval}` names the width of the bars — `week`, `7 days`, `3 months` — which follows the period
(above) and is sometimes only known once OpenSearch has answered, so it is read off the data rather
than the configuration. Until the first answer arrives it reads "interval".

Interpolation happens once, in `WidgetOutletComponent`, which returns the original configuration
untouched when there is no placeholder, so a widget without one never re-renders for nothing.

### Laying out by range

`spanByRange` lets a widget change width with the selected period:

```jsonc
"createdTrend": { "span": 12, "spanByRange": { "7d": 6, "30d": 6 } }
```

Two widgets declared in the same layout row both spanning 12 wrap onto separate lines; both
spanning 6 sit side by side. The trend pair therefore stacks over a long period, where the bars
need the full width, and pairs up over a short one, where comparing them matters more. No grid
code is involved: CSS auto placement does it.

### Secondary figures

```jsonc
"proxies": {
  "type": "kpi", "label": "Proxies", "scope": "proxies",
  "secondary": {
    "filter": [{ "term": { "ecm:isTrashed": true } }],
    "label": "{value} targeting trashed",
    "hideWhenZero": true
  }
}
```

The figure is nested inside the widget's scope wrapper, so it is counted *within* the tile's own
population rather than across the repository.

## Filtering

Filters are declared alongside the widgets and rendered above the grid.

```jsonc
"filters": [
  { "type": "dateRange", "field": "dc:created", "default": "all" },
  {
    "type": "termsGroup",
    "id": "kind",
    "label": "Document kinds",
    "combine": "or",
    "members": [
      { "id": "types",  "field": "ecm:primaryType", "label": "Document types", "labels": "doctype", "size": 200 },
      { "id": "facets", "field": "ecm:mixinType",   "label": "Facets", "size": 200,
        "note": "A document carries several facets, so these counts overlap." }
    ]
  }
]
```

Each of them also accepts the indices it constrains — `byIndex` for the period, `indices` for the
other two. Absent means every index, which is what the six shipped files rely on; on a page
reading two, saying nothing is refused rather than rendered. See
[A shared filter is shared only with the half that can answer it](#a-shared-filter-is-shared-only-with-the-half-that-can-answer-it).

### Members union, groups intersect

Document type and facet are two alternative answers to the same question — *what kind of document
is this?* — so they belong to one group and are combined with **OR**. Groups are combined with
**AND**, with each other and with the date range.

`ecm:mixinType` holds the facets declared by the document type as well as those added to the
instance, so `ecm:mixinType = 'Picture'` catches every image bearing document whatever its type,
including a customer's own types. That is the point of offering facets next to types.

The rule that makes the union work: **a fully selected member means "no constraint", not "every
value"**. Were it compiled as `terms(field, [every value])`, it would swallow whatever its siblings
express and a facet filter would silently do nothing while all document types stayed checked.

| Types | Facets | Clause | Result |
| --- | --- | --- | --- |
| all | all | *none* | every document |
| File, Note | all | `terms(ecm:primaryType, […])` | File and Note |
| all | Picture | `terms(ecm:mixinType, ['Picture'])` | everything image bearing |
| File, Note | Picture | `bool.should`, `minimum_should_match: 1` | the union of both |

The dialog states the outcome in plain language — *Including: document types Contract or Invoice,
or facets Picture* — so the OR is never a hidden surprise. Alt-clicking a checkbox applies its new
state to the whole list. Changes apply on confirmation, not on every click.

### Values, counts and cost

Candidate values come from a `terms` aggregation on the configured field, with an explicit `size`:
the OpenSearch default of 10 would truncate the list silently. Counts are displayed, which is what
makes a noisy type such as `Tagging` visible and actionable. Nothing is hidden or excluded on the
dashboard's behalf; the filter is the tool for that, and the selection is remembered.

All members of a group are aggregated in a single request, issued the first time the dialog is
opened rather than with the dashboard, so a user who never opens the editor never pays for it. The
query deliberately excludes the constraints of the group being described, otherwise unchecking a
type would remove it from its own list. Each member also asks for a `cardinality`, so a truncated
list can say **how many** values it leaves out rather than merely warning that it does.

| Action | Requests |
| --- | --- |
| Initial load | 1 per index on the page, plus 1 per table widget |
| Date range change | the same again |
| First opening of a filter dialog | 1 extra, then cached |
| Selection change | the same again |

Every dashboard that ships reads one index, so that is one request each — two for Tasks, whose
table needs `hits` of its own.

### Filtering on a field with as many values as there are people

A checkbox list works for eighteen document types. It does not work for the assignees of an
insurance company with three hundred claim adjusters: the list is unreadable, resolving every
label costs one request per person, and no top N can be relied on to hold the one person a reader
is looking for.

```json
{ "id": "actors", "field": "nt:actors", "label": "Assignees",
  "labels": "user", "lookup": "user", "size": 20 }
```

`lookup` changes three things at once:

- **Values are ranked by volume**, not alphabetically. Three hundred names in alphabetical order
  help nobody; the busiest twenty answer "who is holding up the work".
- **The list is short**, which is what makes it affordable: twenty labels cost twenty lookups
  instead of two hundred.
- **Typing queries the directory**, through `UserGroup.Suggestion` — the same operation Web UI's
  own picker calls, with the same three character threshold and 300 ms debounce, and an aborted
  request so a fast typist never sees answers arrive out of order. It returns users and groups
  together, composes their label server side, and hands back the prefixed identifier, which is
  precisely the form `nt:actors` stores.

The two halves answer different questions and neither replaces the other: only the index knows who
is busiest, only the directory knows where Kate is. Selected values are pinned to the top of the
list, so clearing the search box never hides what was just ticked, and a persisted selection stays
visible even when its owner has dropped out of the busiest twenty.

One consequence worth knowing: under `lookup` a full page is **never** collapsed back to `all`.
Holding every row of a top N says nothing about holding every value, and collapsing would silently
widen the filter to people who were never shown.

### Filtering by clicking a chart

Clicking a bar, a slice or a row of a ranked list narrows the whole dashboard to that value.
Clicking it again lifts the constraint, so the gesture is its own undo.

Only a `terms` aggregation offers this. The bucket of a histogram or of a range aggregation names
an interval, and its key — `2026-09-15`, `over 30 days late` — is not a value the field ever
equals, so those charts stay inert and their pointer says so.

**A click on a field a filter group already declares is routed into that group** rather than kept
beside it. Content charts `ecm:primaryType` and also exposes it as a filter member, so clicking a
slice of "By Document Type" checks that type in "Document kinds": one constraint, one place, and no
possibility of the button reading "all document types" while something else narrowed the figures.
It is persisted like any other change to that group, because it *is* one.

Everything else becomes a **pick**, shown as a chip under the filter bar with the field it
constrains and a cross to remove it. Picks are deliberately **not** persisted. A group selection is
a stated preference, edited through a dialog with an explicit Apply; a pick is a gesture made while
reading a chart, and restoring one a week later over figures that have moved on would be noise
rather than context.

Two picks on the same field are read as alternatives — nothing is at once a `File` and a `Note`
— while picks on different fields stack, which is the ordinary reading of two filters. A pick on a
field whose values are principals searches both forms, exactly as a selection made through the
dialog does.

### Restricting the figures to one place

A dashboard declaring a `pathScope` filter gains a container picker. Everything on the page then
describes that container and its descendants.

```jsonc
{ "type": "pathScope", "label": "Location", "root": "/default-domain" }
```

Only worth declaring where the documents counted *are* the business documents. A task lives under
`/task-root` and a workflow instance under `/document-route-instances-root`, so scoping either by
path would say something about the plumbing rather than about the content — which is why Content
and Governance declare it and Tasks, Workflows, Users and Downloads do not.

The picker browses rather than asking for a path to be typed: a path is only obvious to whoever
created it, and an administrator reading someone else's repository recognises a container by its
title. Each level is one query against the index for the `Folderish` documents one step below,
which is why a container created seconds ago may be missing — indexing is asynchronous, and for
choosing a place to read figures about that is the right trade. The trail doubles as the way back
up, and the scope is not persisted: a place is the filter a reader is most likely to forget having
set.

### Taking the figures away

Every widget with buckets or rows behind it — a chart, a ranked list, a table — offers a **CSV** of
exactly what it shows, and an ECharts one a **PNG** besides. A KPI tile offers neither: its figure
is already the whole of what it holds. Both are discreet until the card is hovered: an export is a
rare gesture, and a row of icons competing with the figures would make every widget look like a
toolbar. Neither is offered while a widget is loading, failing or empty, a file describing nothing
being worse than no file.

The CSV carries `key`, `label`, `value` and `documents`. The raw key sits beside the resolved label
because the label is what a reader recognises and the key is what a query would use. Values are
written as **numbers rather than as they were displayed**: a spreadsheet renders 1258291 as 1.2 MB
and cannot turn "1.2 MB" back into a number. `documents` differs from `value` on any widget
carrying a metric, where the value is an average or a sum and the count says over how many
documents it was taken.

Two details that decide whether the file opens correctly. It begins with a **byte order mark**,
without which Excel reads UTF-8 as the local single byte encoding and every accent and em dash
becomes mojibake. And rows end with `\r\n`, per RFC 4180, which is what keeps older Excel builds
from reading the whole file as one line.

A ranked list exports no PNG: it is plain DOM, and there is no canvas to ask one of. The PNG that
a chart does write is given an explicit white background, ECharts rendering onto a transparent one
— a chart pasted into a document would otherwise show whatever sits behind it.

**Export page**, in the title bar, takes the whole dashboard away in one of two forms.

A **standalone HTML file** that depends on nothing: the application's own stylesheet is inlined and
every chart is embedded as a data URL, so it opens from a mail attachment and a browser showing it
can be copied into a wiki with the charts intact. It is built by cloning the live grid rather than
by re-rendering each widget — re-implementing how a KPI, a ranked list and a table look would be a
second description of the same thing, drifting the moment a widget type is added. What a clone
cannot carry is a canvas, which copies blank, so each chart is swapped for the image its own
component photographed. Controls are stripped: a snapshot carrying a Refresh button describes an
application rather than a set of figures.

The file states **what the figures were filtered by** and when it was taken. A page showing 5,941
documents says nothing a week later unless it also says which 5,941, and the filter bar it was
read beside is not in the export.

**Print or save as PDF** relies on a print stylesheet instead: navigation, controls and dialogs are
dropped, cards are kept off page boundaries, and the twelve column grid becomes two so that it
fits a sheet. A widget given the whole width keeps it, since halving a trend over three hundred
days makes a band of unreadable dates.

Three things that sheet has to say out loud, because a browser would otherwise get them wrong:

- **The filter bar becomes words.** Five period buttons and two empty `dd/mm/yyyy` fields
  describe an application and never say which period is in force, so the bar is dropped and the
  constraints are written out — the same phrases the standalone file carries, from the same place,
  so the two cannot drift.
- **Backgrounds are printed.** The severity of a tile and the bar of a ranked list carry meaning,
  and a browser drops them by default. The canvas grey of the page itself goes back to white.
- **Charts are put back in the flow.** zrender sizes its canvas in screen pixels and positions it
  absolutely, so the reset that unclips the shell leaves a card with nothing in its flow: it
  collapses to its title while the drawing paints its on-screen width over the neighbouring
  column.

Nothing about a whole page PNG: the browser has no way to rasterise DOM, and half of these widgets
are not charts — 30 of the 65 placed are KPI tiles. It would need a screenshotting dependency,
and an approximate one.

### Persistence

Selections are stored in `localStorage`, per dashboard, under `nxd.filters.<dashboard>.<group>`.
The field of each member is recorded so that a configuration later pointed at another field
discards the stale value rather than filtering on the wrong dimension. `all` is stored as such, so
a document type created later is included automatically instead of being excluded by a snapshot of
today's list.

## Editing a dashboard

**Configure**, in the title bar, opens the JSON the page is described by — the composition where
there is one, the configuration otherwise. Saving re-renders it immediately; **Use the shipped
one** discards the edit for good.

It opens on what was *written*, never on what that expands to. Handing back the thirteen widgets a
Content composition stands for would be answering a question nobody asked, and would make every
later edit a fork of the shipped file rather than a change to it.

A text area rather than a form, deliberately. Every shape a configuration accepts is already a
closed union in `dashboard-config.model.ts`, so a form would be a second description of the same
grammar — one that drifts the first time a widget type is added. What the editor owes instead is a
refusal to save anything that cannot render, and a reason for it. **Validation runs the very
planner that renders the page**, so the editor and the dashboard cannot disagree: a `.keyword`
suffix or a slash in a field name is refused here because the compiler refuses it there. A
composition is compiled first and then held to exactly the same checks, so a widget the library
does not offer, or a parameter it never declared, is named here rather than discovered on screen.

It also checks what the planner cannot, having only the layout to walk: that the id still matches
the page, and that cells and widgets name each other exactly.

**The edit lives in this browser**, under `nxd.config.<dashboard>`, so a colleague opening the same
page sees what ships. That is a known limit rather than a design: `DashboardConfigService` resolves
the override before the bundled asset, and moving that store into a Nuxeo document later changes
nothing for any caller.

**An override that no longer compiles is ignored rather than rendered broken.** A configuration can
stop working without being touched — a widget naming a field a later Studio change removed — and
quietly falling back to what ships is far better than a column of errors nobody can escape from.
The editor is where the reason is shown.

## Requirements

- Nuxeo LTS 2025
- JDK 21 or later, Maven 3.8 or later, to build
- A Nuxeo server using **OpenSearch as its search client**
- An **administrator** session
- On a large repository, an OpenSearch cluster **sized for it**: see
  [Performance depends on the cluster](#performance-depends-on-the-cluster)

On a standard LTS 2025 server running OpenSearch there is usually **nothing to configure**: the
required properties are already set by the packages listed below. The dashboard checks everything
at startup and its **Diagnostics** page names any missing prerequisite together with its fix, so
start there rather than with this table.

| Requirement | Provided by | Without it |
| --- | --- | --- |
| `nuxeo.passthrough.elasticsearch.enabled=true` | The `nuxeo-search-client-opensearch1` package, through its `opensearch1-search-client` template | Nothing works |
| `nuxeo.search.client.default.name=opensearch` | Same package | Nothing works |
| Administrator session | — | Nothing works |
| `nuxeo.passthrough.elasticsearch.audit.enabled=true` | The `nuxeo-audit-opensearch1` package, through its `opensearch1-audit` template | Users, Downloads and Workflows dashboards reduced to a notice naming the prerequisite |
| `RetentionRule` document type | The `nuxeo-retention` package | Governance keeps its records, retention and legal hold figures, which read core fields, and carries a notice naming the package; only the rule breakdown stays empty |
| Web UI | The `nuxeo-web-ui` package, declared as a dependency | No Administration menu entry; the dashboard stays reachable by URL |

Why administrators only: for a non administrator the passthrough rewrites the query to inject an
`ecm:acl` filter, which silently changes every figure, and the `audit` index is refused outright.
Rather than displaying numbers that mean something different per user, the dashboard asks for an
administrator session.

**Asks, and it is worth being exact about what enforces it.** The deployment maps
`NuxeoAuthenticationFilter` onto `/dashboard/*`, which establishes a session and checks no group;
the Web UI menu entry is hidden from non administrators, which hides a link and protects nothing.
The gate is `preflight.service.ts`, a blocking check the shell honours — client-side code, and the
reader owns their client.

What keeps that from mattering is the platform rather than this plugin. The passthrough refuses
`audit` and `audit_wf` to a non administrator outright, and injects `terms(ecm:acl, principals)`
into every query on the repository index. So somebody who types the URL sees the Diagnostics screen
and aggregations over the documents they could already read — nothing they could not obtain
otherwise. It stops being true the day a widget reads something other than the passthrough, which
is the reason to say it here rather than to discover it then.

### Do not declare the templates by hand

`nuxeo-search-client-opensearch1` and `nuxeo-audit-opensearch1` both carry a
`<config addtemplate="..."/>` directive in their `install.xml`, so installing the package appends
its template to `nuxeo.templates` for you. Adding `opensearch1-search-client` to `nuxeo.templates`
manually **before** the package is installed makes configuration generation fail at startup.

### Pointing Nuxeo at an OpenSearch server

One property feeds both the search client and the audit backend. It is a comma separated list,
each entry parsed by `HttpHost.create`:

```properties
nuxeo.opensearch1.client.server=http://opensearch:9200
```

The legacy `elasticsearch.addressList` is still honoured as a fallback. On a single node cluster,
also consider `elasticsearch.indexNumberOfReplicas=0` to keep indices green.

## Performance depends on the cluster

Every figure is computed when the page opens, by OpenSearch, over the documents the period
selects. Nothing is precomputed and, in practice, nothing is cached: OpenSearch does not cache a
request that uses `now`, which Content, Governance and Tasks do, and an index being written to
drops its cache at every refresh. How fast a page answers is therefore decided less by this plugin
than by the cluster behind it, and a repository of hundreds of millions of documents needs a
cluster sized for one.

### What one request costs

A page sends one request per index it reads. OpenSearch searches **each shard of that index with
one thread** of its `search` pool, on the node holding the shard, all shards at once, and the
request answers when the slowest shard has. On each shard, every entry the query selects is handed
to every widget of the page in a single pass, so the time a shard takes grows with two things:

- **the entries of that shard the query selects.** That is the period and the shared filters,
  narrowed to what every widget of the page counts ([Querying](#querying)): Tasks goes through the
  open tasks only, Governance through live documents only, Users, Downloads and Workflows through
  the events they read only. Content cannot be narrowed, its Total tile counting everything the
  shared filters select, so "All time" there selects every entry of the repository index, versions
  and proxies included — and a repository commonly holds several versions per live document;
- **the widgets on the page**: thirteen on Content and on Governance, eighteen on Workflows. A
  widget narrowing to its own population still sees every entry the query selects go past.

Three consequences for sizing:

- **Shards are the unit of parallelism.** A request takes as many search threads as the index has
  shards and holds them until it answers. Five shards over five hundred million entries is a
  hundred million entries per thread.
- **Cores decide whether those threads really run side by side.** Shards piled onto a small node
  queue behind one another, and behind the Web UI searches reaching the same node.
- **Replicas add capacity, not speed.** A request reads one copy of each shard: a replica lets the
  dashboard and Web UI work at the same time, it does not shorten a single request.

Aggregations also take heap on the data nodes, counted against the request and field data circuit
breakers — 60 % and 40 % of the heap by default. A breaker that trips fails the shard concerned
rather than the whole request, and **the dashboard does not yet detect a response some shards
failed to contribute to**: on an undersized cluster, a figure can come back short instead of
failing.

### What it costs Nuxeo

The passthrough is synchronous. For as long as OpenSearch works on a request, Nuxeo holds:

| Resource | Default | Set with |
| --- | --- | --- |
| A Tomcat request thread | 20 in all | `nuxeo.server.http.maxThreads` |
| A connection to OpenSearch | 10 per OpenSearch node, 30 in all, shared with indexing and every Web UI search | nothing: the client library's defaults |
| The wait before giving up | 121 s | `nuxeo.opensearch1.client.socketTimeout` (`180s`, for instance), or the legacy `elasticsearch.restClient.socketTimeoutMs` |

Nuxeo does no heavy computing here, the work being OpenSearch's, but an administrator changing
periods on a large repository holds threads and connections that Web UI users need too. And a
search the browser gave up on carries on: neither the passthrough nor OpenSearch cancels it.

### Two indices that do not grow alike

**Content, Governance and Tasks read the repository index**, which holds every document the
repository keeps — live documents, versions and proxies — and is never purged. Those three screens
depend on the size of the repository and on the cluster, whatever is done to the audit.

**Users, Downloads and Workflows read the audit**, which many installations archive regularly
before starting again from an empty index or purging the older entries. There the cost depends on
two things, and a purge only acts on the second:

- **the volume of a day.** A screen goes through the events it reads only, but thirty days of them
  is thirty days however often the audit is purged, so a busy installation may still have tens of
  millions of entries to go through on the default period;
- **what the index has held since the last purge.** That bounds "All time" and the longer periods.

One ranking would depend on that history rather than on the period, and is kept from doing so. The
most downloaded documents rank `docUUID`, which takes a value per document the audit ever named.
Ranked the default way, a keyword goes through *global ordinals*: a table of every value the shard
holds, built whatever the period selects and rebuilt after a refresh that changed the shard — years
of documents to name the ten of a week. That widget asks for `execution_hint: "map"` instead, which
hashes the values of the downloads actually collected, so its cost follows the period like every
other widget's. Measured on the test instance, the profile reports `MapStringTermsAggregator` where
it reported `GlobalOrdinalsStringTermsAggregator`, over the very same ranking. No other shipped
widget asks for it, and a spec holds it to `docUUID`: on a field of a few thousand values, such as
`principalName`, the table is small and the default the cheaper of the two.

How the audit is purged matters as much as how often. An index recreated after a snapshot is small
at once. Entries removed with `delete_by_query` stay in their segments until OpenSearch merges
them, so the index shrinks later than its count does.

A purged audit also means the audit screens describe only what happened since the purge, which
they do not yet say on screen: "All time" there means "since the last purge".

### Before opening it on a large repository

- **Choose the shard count before the data arrives.** It is fixed when an index is created, and
  changing it afterwards means reindexing. Both indices default to five through
  `elasticsearch.indexNumberOfShards`, which sets the repository *and* the audit at once; set them
  apart with `nuxeo.search.client.default.opensearch1.settings.numberOfShards` and
  `nuxeo.audit.backend.default.opensearch1.settings.numberOfShards`. OpenSearch's own guidance
  keeps a shard between 10 and 50 GB.
- **Give the data nodes cores and heap**: enough cores to search every shard of an index at once
  while Web UI keeps working, and enough heap that the breakers stay quiet.
- **Plan for the audit.** In LTS 2025 it is a single index with no retention and no rollover, so it
  grows until somebody archives and purges it, and renditions weigh heavily in it: every thumbnail
  Web UI fetches is audited as a `download`, which is why 524 of 539 such entries on the test
  instance were renditions.
- **Prefer short periods.** The cost follows the period: a month of audit or of new documents is a
  fraction of "All time". Content opens on the last twelve months for that reason. Governance
  still opens on "All time", because its figures describe what holds today — a record written
  three years ago and still under retention — which a window on `dc:created` would hide.
- **Measure on your own data.** Content, Users and Workflows show under their title how many
  requests the page sent and how long the slowest took — OpenSearch's own `took`. The three other
  dashboards replace that line with a subtitle of their own. Read it page by page, over the periods
  people will actually choose, before rolling the dashboard out.

## Build

```bash
mvn clean install
```

Node is **not** a prerequisite: `frontend-maven-plugin` downloads a pinned version into
`nuxeo-labs-repository-dashboard-web/node/`. Pin it in the parent `pom.xml` through
`frontend-plugin.node.version`. Use `-DskipTests` to skip the Angular unit tests.

The marketplace package lands in
`nuxeo-labs-repository-dashboard-package/target/nuxeo-labs-repository-dashboard-package-*.zip`.

## Install

```bash
nuxeoctl mp-install nuxeo-labs-repository-dashboard-package-*.zip --accept=true
```

The package declares `restart="true"`, so restart the server afterwards. Inside a container:

```bash
docker cp nuxeo-labs-repository-dashboard-package-*.zip <container>:/tmp/
docker exec -it <container> nuxeoctl mp-install /tmp/nuxeo-labs-repository-dashboard-package-*.zip --accept=true
docker restart <container>
```

Then open <http://localhost:8080/nuxeo/dashboard/>, or use **Administration → Repository
Dashboard** in Web UI.

### Acceptance checklist

Seven checks after a deployment. Items 6 and 7 matter most: they cover the two contributions that
no unit test can reach.

1. **Bundle loaded** — `grep nuxeo-labs-repository-dashboard server.log`, no preprocessing error
2. **Application responds** — `/nuxeo/dashboard/` renders the shell and its sidebar
3. **Diagnostics** — the seven checks, ideally all green
4. **Real figures** — the eight Content tiles match what the repository holds
5. **Web UI entry** — *Administration → Repository Dashboard* shows up. A hard reload is needed:
   Web UI registers a service worker that caches its bundles
6. **Deep link** — open `/nuxeo/dashboard/diagnostics` then press F5. No 404. This is what
   validates the rewrite rule of `deployment-fragment.xml`
7. **Login round trip** — sign out from `/nuxeo/dashboard/`, sign back in, and land on the
   dashboard. This is what validates the `startURLPattern` contribution

## Development

```bash
cd nuxeo-labs-repository-dashboard-web
cp .env.example .env         # point it at your server, then edit the credentials
export PATH="$PWD/node:$PATH"
npm install
npm start                    # http://localhost:4200
```

`src/proxy.conf.mjs` forwards every `/nuxeo/**` call to the server declared in `.env` and injects
an `Authorization` header, so the dev server never hits the login page. `.env` is gitignored;
never commit real credentials.

```bash
npm run build                  # production bundle
npm test -- --watch=false      # unit tests, vitest + jsdom. `ng test` watches by default in a TTY
npm run format                 # prettier
```

## How it works

### Deployment

Six resources, no Java:

| File | Role |
| --- | --- |
| `nuxeo/META-INF/MANIFEST.MF` | Declares the bundle and names both components. It needs its trailing newline: without it the last `Nuxeo-Component` line is silently dropped |
| `nuxeo/OSGI-INF/deployment-fragment.xml` | Unzips the app into `nuxeo.war/dashboard/`, maps `NuxeoAuthenticationFilter` onto `/dashboard/*`, adds a rewrite rule so Angular deep links survive a refresh, and appends the menu label to Web UI's own message bundles. It stages that append through `${bundle.fileName}.i18n-tmp` — **not** `.tmp`, which is where `mp-install` writes its own staging file, and where an interrupted deployment would leave a directory that blocks every later install |
| `nuxeo/OSGI-INF/dashboard-auth-contrib.xml` | Declares `dashboard/` as a valid start URL, so a login redirect returns to the requested page |
| `nuxeo/OSGI-INF/dashboard-webresources-contrib.xml` | Registers the Web UI menu entry with the `web-ui` resource bundle |
| `nuxeo/web/nuxeo.war/ui/nuxeo-labs-repository-dashboard.html` | The `nuxeo-slot-content` itself, a plain HTML file needing no build step |
| `nuxeo/web/nuxeo.war/ui/i18n/messages*.json` | The label that entry shows, `repositoryDashboard.menu`, in English and French. Without them the menu reads its own key |

Authentication relies entirely on the existing `JSESSIONID` cookie. Web UI remains the default UI
after login: no `startupPage` is contributed.

`nuxeo_build_tools/htmlToJsp.mjs` turns the built `index.html` into an `index.jsp` whose
`<base href>` reads the `app.base.url` property, so the deployment path stays configurable behind
a reverse proxy.

### Querying

The Nuxeo passthrough exposes neither `_msearch` nor `_mapping`. Issuing one request per widget
would mean a dozen round trips per screen, so `query-planner.ts` folds the widgets of one index
into a single request: each widget owns a named aggregation, and one carrying its own predicate is
wrapped in a `filter` aggregation. Table widgets need `hits` and keep a request of their own.

The Content dashboard, thirteen widgets, therefore costs **one request**:

```jsonc
POST /nuxeo/site/es/nuxeo/_search        // Content-Type: application/json is mandatory
{
  "size": 0,
  "track_total_hits": true,
  "query": { "match_all": {} },           // "All time"; a period becomes a range on dc:created
  "aggs": {
    "expiringWeek":    { "filter": { "bool": { "filter": [ /* live */, { "range": { "dc:expired": { "gte": "now", "lte": "now+7d" } } } ] } } },
    "expired":         { "filter": { "bool": { "filter": [ /* live */, { "range": { "dc:expired": { "lt": "now" } } } ] } } },
    "byType":          { "filter": { /* live */ }, "aggs": { "inner": { "terms": { "field": "ecm:primaryType", "size": 10 } } } },
    "topContributors": { "filter": { /* live */ }, "aggs": { "inner": { "terms": { "field": "dc:creator", "size": 10 } } } }
  }
}
```

A widget with neither predicate nor metric emits no aggregation at all: it reads `hits.total`.
That is why the Total tile is absent from the twelve aggregations Content sends.

A `filter` aggregation narrows what a widget counts, not what OpenSearch goes through: every entry
the query selects is handed to every aggregation. So the query also states what every widget of the
request restricts itself to — the clauses all their filters carry, then the union of what remains
of them. Each widget filter implies both, so no figure changes. Tasks, whose eight widgets all
count open tasks, sends:

```jsonc
"query": { "bool": { "filter": [
  { "term": { "ecm:mixinType": "Task" } },
  { "term": { "ecm:currentLifeCycleState": "opened" } }
] } }
```

Users, whose widgets share no clause, sends the period and the union of the four `eventId` they
read. A single widget with no filter of its own counts the whole query — the Total tile, a metric
tile, a chart over the dashboard population — and stops this for its whole request, which is why
Content's query is the shared filters alone. Placing such a widget on Tasks would send the whole
repository index past every widget again, to count a few thousand tasks.

### One request per index, not per dashboard

A widget may declare the index it reads, and the planner groups by it. A page mixing the
repository and the audit therefore costs two requests rather than being impossible — which it was
until recently, one `index` per dashboard being a limit rather than a choice.

Two things stay deliberately unsplit. Widgets of one index still travel together, which is what
keeps a partition adding up and `now` a single instant among the tiles bounded by it. And a
single-index dashboard still costs exactly one request, so nothing that ships pays for the change.

One picker, several fields: a period means `dc:created` in the repository and `eventDate` in the
audit, so the date filter names the second one per index.

```jsonc
{ "type": "dateRange", "field": "dc:created", "byIndex": { "audit": "eventDate" } }
```

#### A shared filter is shared only with the half that can answer it

The date filter was the first case of a rule that now covers all of them. `ecm:path.children` and
`ecm:primaryType` live on the repository and nowhere else, so an audit request carrying them does
not come back unfiltered — it comes back **empty**. The widget renders, the figure reads zero, and
nothing distinguishes that from a quiet week.

So every shared clause names the indices it constrains, and a page reading two of them is refused
until each one has:

```jsonc
"filters": [
  { "type": "dateRange", "field": "dc:created", "byIndex": { "audit": "eventDate" } },
  { "type": "termsGroup", "id": "kind", "label": "Document kinds", "indices": ["nuxeo"], "members": [ /* … */ ] },
  { "type": "pathScope", "indices": ["nuxeo"] }
]
```

| Where | Key | Absent means |
| --- | --- | --- |
| `dateRange` | `byIndex` | the same field on every index, which is right for one and wrong for two |
| `termsGroup` | `indices` | every index |
| `pathScope` | `indices` | every index |
| A pick | — | it carries the index of the chart it was clicked on |
| `baseFilter` | — | refused outright on a mixed page: it has no index it could belong to |

**Nothing is guessed.** Deriving which field lives on which index would mean a copy of the Nuxeo
mapping inside this application, wrong the first time somebody adds a field. `validateConfig` names
what is missing instead, and it runs on a shipped file exactly as it runs on an administrator's
edit.

A mixed page also has to name the index its filters are written against, `index` beside `label` in
a composition. Inferring it from the first widget is right while there is only one; past that the
order of the cells would decide which index the facet value lists are counted on, and moving a cell
would empty a dialog with nothing on screen to explain it.

None of this costs a single-index dashboard anything: every declaration is absent from the six
files that ship, and every clause applies exactly as before.

### Labels

Document types and lifecycle states reuse Web UI's own translation bundle, fetched once from
`/nuxeo/ui/i18n/messages.json`, with the same key conventions and the same fallback as
`nuxeo-format-behavior.js`: `label.document.type.<lower case type>` and `label.ui.state.<state>`.
Users are resolved through `/api/v1/user/{id}`, deduplicated and cached. Every lookup degrades to
the raw value, so a missing translation or a deleted principal never breaks a chart.

Workflow values reach the same bundle by two further strategies. `message` translates a value that
*is* an i18n key: `extended.taskName` holds `wf.parallelDocumentReview.chooseParticipants.title`,
which the bundle renders as "Choose Participants". `workflowModel` composes one out of a model
name, `wf.<name with a lower case initial>.<name>`, which is how Web UI's own workflow layouts
address it.

That key is written into the model's `dc:title` by Studio at generation time; nothing in the
platform composes it, and the bundle holding it belongs to the Studio project rather than to Web
UI. A model whose project is not deployed on the server therefore resolves to nothing — as do
Nuxeo's own test fixtures, which carry a literal title. `workflowModel` then falls back to the
words of the identifier rather than to the identifier itself, so `ClaimReview` reads "Claim
Review" instead of sitting next to a properly translated "Parallel Document Review". An initialism
stays whole, `HRRequest` reading "HR Request", and a name already containing a space or an
underscore is left exactly as it was written.

`extended.action` deliberately gets **no** strategy. The audit records the button's `name`
(`approve`, `reject`, `validate`), while the i18n key sits in the button's `label` and never leaves
the model definition. Declaring a strategy there would promise a translation that can never happen.

`document` names the document a uuid points at, through `/api/v1/id/{uuid}`, and shares the user
lookup's cache discipline. It exists for a field holding document references: `record:ruleIds`
carries the uuid of the `RetentionRule` that turned a document into a record, so a chart grouped by
it would otherwise draw bare uuids. A rule deleted after the records it governs leaves its uuid
behind and the server answers 404 — the bucket still holds documents, so it falls back to the
uuid, which is a poor label but an honest one. Unlike `user`, this strategy carries no merging
rule, so it combines freely with a `metric`.

### A principal reaches the index under two forms

**`nt:actors` holds `Josh` for one task and `user:Josh` for the next, in the same workflow
instance.** This is stock Nuxeo behaviour, not a quirk of one server, and a dashboard that ignores
it reports one person twice, each holding part of their work.

The field has no resolver and no normalisation, so the platform stores verbatim what the workflow
node produced. Two sources coexist:

| Node assigns | Form stored | Why |
| --- | --- | --- |
| `workflowInitiator` | `Josh` | the initiator comes from `getActingUser()`, which is bare |
| a variable fed by Web UI's picker | `user:Josh` | that widget carries the `prefixed` attribute |

In `ParallelDocumentReview`, "Choose Participants" and "Consolidate" are bare while "Give Opinion"
is prefixed. A reassignment then rewrites the list bare again, so one task changes form over its
life.

The platform copes by searching both at once: `TaskActorsHelper.getTaskActors()` builds "prefixed
and unprefixed names of the principal and all its groups", and six page providers feed that to
`nt:actors/* IN ?`. Every "My tasks" screen in Nuxeo therefore queries both forms.

So does this dashboard, wherever `labels` is `user`:

- **Buckets are merged** on a canonical key, adding their counts. Only counts: two averages
  recombine solely with their weights, so a widget combining `"labels": "user"` with a `metric`
  fails loudly at plan time rather than reporting a figure that would be wrong.
- **A selection expands to both forms.** Ticking "Josh" sends `["Josh", "user:Josh"]`, always —
  not merely the forms already seen, since a reassignment can change the stored one afterwards.
- **A group stays distinct from a user of the same name.** Only the user form is collapsed, which
  preserves the very distinction the prefix was introduced for. A bare value is read as a user,
  as `UserManagerResolver` does.

On the sandbox the difference is measurable: filtering on `Josh` without this finds five of his
six open tasks.

### Metrics with no value

A count, a cardinality and a sum over an empty set are all legitimately zero. An average, a
minimum, a maximum and a percentile are not: OpenSearch answers `null`, and the dashboard renders
that as a dash rather than as `0`. Without this, an average duration tile would read `0 s` on a
server where no workflow has ever completed, which no reader can tell apart from a genuinely
instantaneous workflow.

### When the mean describes nobody

```json
"metric": { "percentile": { "field": "extended.timeSinceWfStarted", "percent": 50 } }
```

`percent: 50` is the median, `percent: 90` the figure a service level is written against. Both
matter whenever a dashboard aggregates populations that have nothing in common. On the sandbox,
five workflow models span two orders of magnitude — a download request settles in hours, a claim
review drags on for weeks — so the overall mean lands at ten days, a value **no model approaches**,
while the median says one day. The mean is not wrong; it simply describes nobody.

Two consequences for anyone writing a configuration:

- **Put a breakdown next to any aggregate over a mixed population.** A `terms` aggregation carrying
  the same metric, ordered by `metric_desc`, names the member responsible in one glance. The tile
  keeps the headline figure, and its `hint` points at the breakdown.
- **`percentiles` is multi-valued**, so ordering a `terms` by it needs the percentile in the path —
  `metric.50`, not `metric`. The compiler derives that, so no configuration can get it wrong.

The filter bar is the other half of the answer: once the breakdown names the culprit, filtering on
that model recomputes every widget, and "Slowest Steps" then shows only its own steps. The bar is
sticky and names the value chosen, so the context does not disappear when the reader scrolls.

### Tasks live only as long as their workflow

**A scheduled job deletes finished workflows every night, and every task they carry with them.**
This is stock Nuxeo behaviour, not a setting of this plugin, and it decides what the Tasks
dashboard can honestly show.

The scheduler `workflowInstancesCleanup` runs at **23:59 daily**. It selects the routes whose state
is `done` or `canceled`, deletes them, and `DocumentRouteOrphanedListener` then removes every task
carrying their `nt:processId` — **whatever its state**, `ended`, `cancelled` or even `opened`.

```
# nuxeo.conf — keep finished workflow instances, and their tasks, in the repository
nuxeo.routing.disable.cleanup.workflow.instances=true
```

The line is commented out in the shipped `nuxeo.conf`, so **the cleanup is active by default**.
Two related switches exist: `nuxeo.routing.cleanup.workflow.instances.orphan=true` widens the sweep
to every route, orphaned ones included, even while they are still running; and
`DELETE /api/v1/management/workflows/orphaned` triggers it on demand.

Three consequences, which the Tasks dashboard states in its own subtitle:

- **It counts open tasks only.** A "completed tasks" tile would read ten in the afternoon and zero
  the next morning, which is worse than showing nothing.
- **History belongs to the Workflows dashboard**, which reads the audit index. The audit keeps its
  entries when the repository loses its documents, so the two screens are complementary rather
  than redundant: Workflows tells what happened, Tasks shows what is waiting.
- **Nothing in a document says which regime is in force.** On a server where the property has been
  set, finished tasks accumulate and a repository-wide count means something quite different.

One more trap, unrelated to the cleanup: a workflow node with no due date expression produces a
task whose `nt:dueDate` is *the moment it was created*, so it counts as overdue a second later. The
two shipped models set the expression; a Studio model need not.

### A record cannot be unmade

**Putting a document under retention is close to irreversible, and it matters before anyone builds
or demonstrates the Governance dashboard.** `UnsetRetention` exists in `permissions-contrib.xml`
only *for flexible records*; on an ordinary record the retention date cannot be lowered and the
document cannot be deleted, administrator included, until that date has passed.

**`ecm:isRecord` never goes back to false.** There is no `unmakeRecord` anywhere in the tree, so
the only way to undo the flag is to delete the document. Being a record protects nothing by
itself, though: what blocks a deletion is a future `ecm:retainUntil` or a legal hold, and once
both are gone the document can be removed like any other. That is the whole basis on which a
throwaway fixture can be undone.

So a few documents created to give a Governance screen something to show will outlive the
experiment. Make them **flexible records**, or give them a retention of minutes rather than years,
and keep them in a container of their own.

Three traps sit in the operations themselves:

- **Only `Retention.AttachRule`, with a rule whose `retention_rule:flexibleRecords` is true, is
  reversible in one move.** It is also the only operation that sets the `Record` facet, and
  `Document.UnattachRetentionRule` refuses a document without it. `Document.Retain` writes a
  retention but no facet, so a document retained that way cannot be released at all.
- **`Document.Retain` with no `until` means `9999-01-01`, not "no retention".** That is a
  perpetual block. A date can still be brought back down from it, which is the one escape route.
- **`Document.Hold` turns its target into an *enforced* record**, and a flexible record loses that
  quality permanently the moment a legal hold touches it. `Document.Unhold` removes the hold and
  nothing else.

Leave `retention_def:endActions` empty on any rule written for a demonstration. The `retention_end`
vocabulary offers exactly two values, `Document.Delete` and `Document.Trash`, so a non-empty list
makes the documents disappear on their own at expiry, under the `system` identity.

**An "expired retention" widget is empty by construction.** The `findRetentionExpired` scheduler
runs hourly, selects everything whose `ecm:retainUntil` lies in the past and sets it back to null.
A retention is therefore visible as future or not visible at all, and a tile counting lapsed ones
holds a value for at most an hour. What survives is `record:retainUntil` on documents that carry
the `Record` facet.

### Indexing rules worth knowing

Taken from the LTS 2025 `opensearch1-doc-mapping.json`; getting these wrong produces empty results
rather than errors.

**And the server will not tell you.** The passthrough exposes `_search` and nothing else:
`_mapping`, `_field_caps` and `_count` all answer 404. Since an aggregation on a field absent from
the mapping returns an empty bucket list *without an error*, exactly like a mapped field nobody
has filled yet, no read-only call tells the two apart. Read the mapping file, or index one
document and look at what comes back.

- **Never append `.keyword`.** A dynamic template maps strings straight to `keyword`, so
  `ecm:primaryType.keyword` matches nothing.
- **`dc:title` is the exception**: it is `text` with `fielddata: true`. Read it from `_source`
  instead of aggregating on it. `dc:description` and `note:note` are `keyword` and aggregate fine.
- **`ignore_above`** is 256 on dynamically mapped keywords (32765 for `dc:description`). Longer
  values are stored but not indexed, so they vanish from aggregations.
- **Complex properties use a dot**: `file:content.length`, not `file:content/length`.
- **`thumb:thumbnail.*` and `picture:views.*` are mapped `index: false`.** They are present in
  `_source`, so a table can display them, but no filter clause can reach them.
- **A blob of unknown length is indexed as `-1`**, never as null: the writer always emits `length`.
  Guard a `sum` with a `range` on `{ "gt": 0 }`.
- **A proxy carries its target's blob.** Only `collectionMember` is proxy local, so summing
  `file:content.length` without `ecm:isProxy: false` counts every published document twice.
- **`extended_bounds` on a `date_histogram` must be epoch milliseconds**, never a date string: a
  string bound is parsed with the aggregation's own `format`, so a chart formatting its keys as
  `yyyy-MM-dd` rejects an ISO instant with a 400.
- **A `terms` aggregation is a top N.** Each shard ranks locally, so the compiler widens
  `shard_size` well past the OpenSearch default to make the merged ranking exact, and asks for a
  `cardinality` alongside so a truncated chart can say how many values it left out.
- **`ecm:retainUntil` is only written when non null**; combine it with an `exists` clause.
- **The index carries three retention fields and no more.** `DefaultIndexingJsonWriter` writes
  `ecm:isRecord`, `ecm:retainUntil` and `ecm:hasLegalHold`, which the mapping declares as
  `boolean`, `date` and `boolean`. **`ecm:isFlexibleRecord` is not among them.** It exists in the
  repository and `/api/v1/id/{uuid}` returns it, but no widget here can tell a flexible record
  from an enforced one.
- **`record:ruleIds` has no explicit mapping entry, and aggregates correctly all the same.** The
  `record` schema's two fields read `record:ruleIds` and `record:retainUntil`, and they enter the
  mapping through the `strings` dynamic template at the first document that carries one. Confirmed
  against a live index once records existed: `terms` and `cardinality` both answer. Before that
  first record they answer an empty list, indistinguishable from a field nobody has filled — see
  the warning above about the server not telling you which situation you are in.
- **The `Record` facet is the only thing that says how a record was made.** It reaches the index
  through `ecm:mixinType`, and only `Retention.AttachRule` sets it: `Document.Retain` and
  `Document.Hold` both produce a record without it. "Records governed by a rule" is therefore
  expressible, and "flexible records" is not.
- **`record:retainUntil` is written only once a retention has run out**, by the listener reacting
  to `retentionExpired`, in the very move that sets `ecm:retainUntil` back to null. The two fields
  never describe the same thing, and neither is in the static mapping.
- **`ecm:path.children` is `text` with a path analyser, so it cannot be aggregated at all** — the
  index answers "Text fields are not optimised for operations that require per-document field
  data". It exists for one purpose: a `term` on it matches a container
  **and everything below it, the container included**. That last part differs from NXQL, where
  `ecm:path STARTSWITH '/a'` leaves `/a` out. Scoping a dashboard to a workspace therefore counts
  the workspace itself, which is defensible — it is a document in that place — but one more
  than a reader counting folders would predict.
- **`ecm:path@depth` counts `pathAsString.split("/").length`**, and the leading slash leaves an
  empty first segment, so `/default-domain` is **2** rather than 1. Counting the segments instead
  is short by one, and a level of a container picker built on it lists the container rather than
  its children — plausible enough on screen to go unnoticed.
- **`ecm:ancestorId` counts a document once per ancestor.** Twenty-two records answered four
  buckets totalling eighty-eight, the domain and the workspaces root among them, so a "by
  location" chart reads four times the truth. There is no aggregatable field naming *the* place a
  document is in.
- **A retention duration is spread over three fields** — `retention_def:durationDays`,
  `durationMonths` and `durationYears` — so a two year rule reads `durationDays: 0`. A band chart
  on any one of them is wrong rather than partial: three rules of 5 days, 45 days and 2 years put
  two of them in "under a week". Adding the three needs arithmetic no aggregation here can do.
- **A version carries the path of the document it was cut from.** A path scope therefore includes
  versions unless something else excludes them. No shipped dashboard has a `baseFilter` any more:
  each widget states the population it describes, which is how Governance keeps excluding them and
  how Content's Versions tile keeps counting them, as it is meant to.
- **`extended.params` in the audit index is `"enabled": false`** and cannot be aggregated.
- **`comment` in the audit index is `text` with no keyword sub-field**: readable from `_source`,
  never aggregatable. Every other audit field is a `keyword` set by a dynamic template.
- **Read `eventDate`, never `logDate`.** The journal is written after commit, so `logDate` bunches
  entries onto transaction boundaries and invents spikes.
- **`documentCreated` is also fired by a check-in and by a publication**, so counting it per user
  includes versions and proxies.
- **`audit_wf` rewrites the payload even for administrators** (it injects
  `term: { category: "Routing" }`), so JSON key order is not preserved. Harmless, but do not rely
  on it.
- **`audit_wf` hides five of the thirteen audited workflow events.** That same injected category
  filter excludes `workflowTaskAssigned`, `workflowTaskReassigned`, `workflowTaskCompleted`,
  `workflowTaskDelegated` and `auditLogRoute`, which are fired with no explicit category. They sit
  in the index and this view will never return them, so a widget built on one stays empty forever
  with nothing on screen to explain why. `extended.directive` and `extended.dueDate` are declared
  only on those events, so no task directive and no due date can be read through this view.
- **A workflow has no state field.** State is derived from the event id: started is
  `afterWorkflowStarted`, completed `afterWorkflowFinish`, cancelled `beforeWorkflowCanceled`.
  Prefer that last one to `workflowCanceled`, which fires once per attached document and therefore
  multiplies a single cancellation. A trustworthy "currently running" figure cannot come from the
  audit at all: it needs `DocumentRoute` on the repository index, hence a second index.
- **`extended.timeSinceWfStarted` and `extended.timeSinceTaskStarted` are `long`, in
  milliseconds**, and absent rather than negative when the helper cannot find the start event.
  Neither is declared in the mapping, so the first document written fixes the type: a quoted
  number makes the field a `keyword` for good and every `avg` on it fails until the index is
  rebuilt.
- **`extended.actors` is a `keyword[]` on a reassignment but a single `"[bob, alice]"` string on a
  task creation**, a `LinkedHashSet` having fallen through to `toString()`. Never aggregate it
  across both events.
- **Non-administrators see only the workflow models they hold `DataVisualization` on.** An empty
  permission set compiles to an empty `terms`, so zero hits rather than an error.

### Who an action is credited to

Every per-user figure on the Users, Downloads and Workflows dashboards counts a principal the audit
fills with `getActingUser()` rather than `getName()` — `principalName` everywhere except
`top-workflow-initiators`, which reads `extended.workflowInitiator`, filled the same way:

```java
public String getActingUser() {
    return getOriginatingUser() == null ? getName() : getOriginatingUser();
}
```

The two differ in **exactly one living case**: a `SystemPrincipal`, whose name is invariably
`system` while its acting user names the human behind the action. That is what makes an
asynchronous Work, an `UnrestrictedSessionRunner` or a `CoreInstance.doPrivileged(repo, …)` count
for the person who triggered it, instead of piling every server-side action onto a technical
account. Without it the Users dashboard would be a chart of `system`.

**It is not a protection against impersonation**, and it is worth being precise, because a script
that writes demonstration data or integrates a third party system runs straight into this:

| Situation | Recorded as |
| --- | --- |
| `Auth.LoginAs("jdoe")` run by an administrator | **`jdoe`** — the administrator leaves no trace |
| `Auth.LoginAs()` with no argument | the **caller**, through `SystemPrincipal(caller)` |
| Asynchronous Work scheduled by `jdoe` | `jdoe` |
| `CoreInstance.doPrivileged(repository, …)` under `jdoe` | `jdoe` |
| `Framework.doPrivileged(…)` opening a fresh session | **`system`** |
| Bulk action launched by `jdoe` | `jdoe` |

The two branches of `Auth.LoginAs` therefore disagree: with a name it goes through
`Framework.loginUser`, which takes the principal from the directory and leaves `originatingUser`
null, so the assumed identity is credited; without one it builds `SystemPrincipal(caller)` and the
caller survives.

Two further facts. The admin centre's **"Login as" no longer exists** in LTS 2025: the mechanism
survives in `NuxeoAuthenticationFilter.switchUser()`, but it triggers on a request *attribute*
named `deputy` that nothing in the tree sets, and Web UI offers no equivalent. And `system` does
still appear in an audit index, through `Framework.doPrivileged` with no argument and through the
`documentCreated` entries `syncLogCreationEntries` rebuilds.

## Project layout

```
.
├── pom.xml                                     parent
├── nuxeo-labs-repository-dashboard-web/        Angular app + Nuxeo bundle resources
│   ├── nuxeo/                                  MANIFEST, OSGI-INF, Web UI resource
│   ├── nuxeo_build_tools/htmlToJsp.mjs         index.html -> index.jsp
│   └── src/
│       ├── app/
│       │   ├── config/                         widget model, composition compiler, dashboards/*.json
│       │   ├── core/                           HTTP, preflight, labels, formatting
│       │   ├── engine/                         agg and clause compilers, planner, mapper, runner, session
│       │   ├── layout/                         shell, sidebar, grid, date range picker
│       │   ├── library/                        the widget catalogue
│       │   │   ├── definition.ts                what a widget is; parameter shapes
│       │   │   ├── builders.ts                  countTile, topNChart, trendChart, bandChart, recordTable
│       │   │   ├── predicates.ts                the only clauses a definition may express
│       │   │   ├── populations.ts               named populations of the repository
│       │   │   ├── registry.ts                  every widget a composition may name
│       │   │   ├── content/                     13 definitions, repository
│       │   │   ├── users/                       5, audit index
│       │   │   ├── downloads/                   7, audit index
│       │   │   ├── workflows/                   18, audit_wf view
│       │   │   ├── tasks/                       9, repository
│       │   │   └── governance/                  17, repository — records, horizon, holds, rules
│       │   ├── pages/                          generic dashboard page, diagnostics
│       │   └── widgets/                        kpi, chart, ranked list, table, ECharts setup
│       └── testing/                            fetch stub, chart stub, async helpers
└── nuxeo-labs-repository-dashboard-package/    marketplace package
```

## Roadmap

| Phase | Content | Status |
| --- | --- | --- |
| 0 | Deployment chain, preflight diagnostics, Content headline tiles | done |
| 1 | Query compiler, widget kit, label resolution, date range, full Content dashboard | done |
| 1b | Filter groups: document types and facets, unioned, with persistence | done |
| 1c | Scopes and the repository composition row | done |
| 1d | Modification trend, range reminder, range driven layout | done |
| 1e | Period with explicit inclusive bounds, and the Users dashboard on the audit index | done |
| 2 | Cross filtering on bucket click, with active filter chips | done |
| 2b | Path scope | done |
| 2c | CSV and PNG export per widget, HTML and print for the page | done |
| 3 | Configuration editor, JSON and validated by the real planner | done |
| 3b | Field picker fed by `/api/v1/config/schemas` | |
| 4 | Workflows dashboard | done |
| 4b | Tasks dashboard, on open tasks and due dates | done |
| 4c | A median beside the mean, and a per model breakdown, where an aggregate mixes populations | done |
| 4d | Directory backed filtering for a field with as many values as there are people | done |
| 5 | Governance dashboard, on records, legal holds and retention | done |
| 6 | Reusable widget library; a dashboard composes rather than configures. Content migrated | done |
| 6b | One request per index, so a page can mix the repository and the audit | done |
| 6c | A widget placeable anywhere, so a page can be laid out by hand | done |
| 6d | The four remaining dashboards migrated onto the library | done |
| 6d2 | Governance enriched: retention horizon over time, and the rules themselves | done |
| 6e | Customisation guide: forking the plugin and changing it with an AI assistant, prompt by prompt, with a security checklist | done |
| 6f | Sections and tabs, so a layout can group its widgets without a component | done |
| 7 | Downloads dashboard, counting what a reader saved apart from what the interface fetched | done |

## Licence

[Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0)

## About Nuxeo

[Nuxeo](https://www.hyland.com/products/nuxeo-platform), part of Hyland, is a highly customizable
and extensible content management platform for building business applications.
