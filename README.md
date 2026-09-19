# Nuxeo Labs Repository Dashboard

> **This is WORK IN PROGRESS, using GitHub as backup for now.**
> It will be forked into `nuxeo-sandbox` once it is ready, and this warning will go away then.

An administrator facing analytics dashboard for a Nuxeo repository, served by the platform at
`/nuxeo/dashboard/` and reachable from the Web UI Administration menu.

The dashboard is a standalone Angular application packaged as a Nuxeo bundle. Charts and figures
are described by configuration rather than hard coded, and every widget of a page is batched into
a single OpenSearch aggregation request.

> **Status: five screens live.** Content, Users, Workflows and Tasks are complete and
> configuration driven, alongside Diagnostics. Governance is still a placeholder naming its
> prerequisite. The configuration editor and cross filtering land next, see [Roadmap](#roadmap).

## Screens

| Screen | Data source |
| --- | --- |
| **Content** | Repository index: repository composition (live, trashed, versions, proxies), `ecm:primaryType`, `ecm:currentLifeCycleState`, `dc:created`, `dc:modified`, `dc:creator`, `dc:expired` |
| **Users** | Audit index: `loginSuccess`, `loginFailed`, `documentCreated` and `documentModified`, grouped by `principalName` over `eventDate` |
| **Workflows** | `audit_wf` passthrough view: workflow state derived from `eventId`, `extended.modelName`, `extended.workflowInitiator`, `extended.taskName`, `extended.action`, and durations from `extended.timeSinceWfStarted` and `extended.timeSinceTaskStarted` |
| **Tasks** | Repository index: open tasks only, through the `Task` facet — `nt:dueDate`, `nt:actors`, `nt:name`, `nt:directive` |
| **Governance** | `ecm:isRecord`, `ecm:hasLegalHold`, `ecm:retainUntil`, and `record:ruleIds` resolved against the `RetentionRule` documents |
| **Diagnostics** | The preflight report, always available |

## Configuring a dashboard

A dashboard is one JSON file under
`nuxeo-labs-repository-dashboard-web/src/app/config/dashboards/`, shipped as
`assets/dashboards/<id>.json`. Adding a chart means editing that file, not writing a component.

```jsonc
{
  "id": "content",
  "label": "Content Dashboard",
  "index": "nuxeo",
  "dateField": "dc:created",
  "baseFilter": [{ "term": { "ecm:isVersion": false } }],
  "layout": [{ "cells": ["byType", "storageByType"] }],
  "widgets": {
    "byType": {
      "type": "donut",
      "label": "By Document Type",
      "span": 6,
      "labels": "doctype",
      "agg": { "terms": { "field": "ecm:primaryType", "size": 10 } }
    },
    "storageByType": {
      "type": "ranked-list",
      "label": "Storage by Document Type",
      "span": 6,
      "format": "bytes",
      "metric": { "sum": "file:content.length" },
      "agg": { "terms": { "field": "ecm:primaryType", "order": "metric_desc" } }
    }
  }
}
```

| Key | Values |
| --- | --- |
| `type` | `kpi`, `donut`, `pie`, `bar`, `hbar`, `line`, `area`, `ranked-list`, `table` |
| `agg` | `terms`, `date_histogram`, `range`, `date_range`, `filters` |
| `agg.date_histogram.time_zone` | IANA zone the buckets are cut in; defaults to the reader's own |
| `metric` | `count`, `cardinality`, `sum`, `avg`, `min`, `max`, `percentile` — nested under the aggregation |
| `scope` | Named population this widget describes, see below |
| `labels` | `raw`, `doctype`, `lifecycle`, `user`, `boolean`, `message`, `workflowModel` |
| `lookup` | `user` on a filter member: ranks values by volume and searches the directory as the reader types |
| `format` | `integer`, `decimal`, `bytes`, `percent`, `duration`, `date`, `daysUntil`, `text` |
| `filter` | Extra OpenSearch clauses for this widget only, compiled into a `filter` aggregation |
| `secondary` | A second figure under a KPI, counted within the tile's own population |
| `span` | Width in the 12 column grid; omitted spans share the row evenly |
| `spanByRange` | Overrides `span` for a given date range id |
| `hint` | Secondary line under the title; `{range}` is replaced by the active date range |

Aggregations are a **closed whitelist**, not raw OpenSearch DSL. The passthrough forwards an
administrator's payload verbatim, so accepting arbitrary DSL from a configuration file would also
accept `script` and `runtime_mappings`. `agg-compiler.ts` is the only code that emits aggregation
JSON, and it rejects anything else — including a `.keyword` suffix, which would silently match
nothing on a Nuxeo index.

## Scopes

A widget can only ever narrow the shared query, never widen it. Putting "exclude versions and
proxies" in `baseFilter` would therefore make it impossible to also show how many versions exist.
Scopes solve that: the distinction lives on the widget, not on the dashboard.

```jsonc
"baseFilter": [],
"defaultScope": "liveNotTrashed",
"scopes": {
  "all":            [],
  "liveNotTrashed": [{"term":{"ecm:isVersion":false}},{"term":{"ecm:isProxy":false}},{"term":{"ecm:isTrashed":false}}],
  "trashed":        [{"term":{"ecm:isVersion":false}},{"term":{"ecm:isProxy":false}},{"term":{"ecm:isTrashed":true}}],
  "versions":       [{"term":{"ecm:isVersion":true}},{"term":{"ecm:isProxy":false}}],
  "proxies":        [{"term":{"ecm:isProxy":true}}]
}
```

The four non-empty scopes partition the repository exactly, so the composition row adds up:

```
liveNotTrashed + trashed + versions + proxies = all
```

Every chart and table uses `liveNotTrashed`, which is what the "Live" tile counts — the dashboard
states its own scope rather than leaving it to be guessed. Scope clauses are added to the `filter`
aggregation the planner already emits per widget, so this costs **no extra request**.

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
On a real repository this is not marginal: 105 of 1909 versions on the test instance. The tile
therefore keeps the figure, and only hides it when it really is zero.

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

### Reminding the reader of the active range

A chart sitting below the fold loses sight of the date range picker, so its hint can carry the
range itself:

```jsonc
"createdTrend":  { "hint": "Number of documents created per day ({range})" },
"modifiedTrend": { "hint": "Number of documents modified per day (Based on {range} creation)" }
```

The second wording is not cosmetic. The global range filters `dc:created`, while that chart
buckets on `dc:modified`: it shows modifications made to the documents *created* in the window,
not modifications made during the window.

Interpolation happens once, in `WidgetOutletComponent`, which returns the original configuration
untouched when there is no placeholder, so a widget without one never re-renders for nothing.

### Laying out by range

`spanByRange` lets a widget change width with the selected period:

```jsonc
"createdTrend": { "span": 12, "spanByRange": { "7d": 6, "30d": 6 } }
```

Two widgets declared in the same layout row both spanning 12 wrap onto separate lines; both
spanning 6 sit side by side. The trend pair therefore stacks over a long period, where daily bars
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
| Initial load | 2 |
| Date range change | 2 |
| First opening of a filter dialog | 1 extra, then cached |
| Selection change | 2 |

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

### Persistence

Selections are stored in `localStorage`, per dashboard, under `nxd.filters.<dashboard>.<group>`.
The field of each member is recorded so that a configuration later pointed at another field
discards the stale value rather than filtering on the wrong dimension. `all` is stored as such, so
a document type created later is included automatically instead of being excluded by a snapshot of
today's list.

## Requirements

- Nuxeo LTS 2025
- JDK 21 or later, Maven 3.8 or later, to build
- A Nuxeo server using **OpenSearch as its search client**
- An **administrator** session

On a standard LTS 2025 server running OpenSearch there is usually **nothing to configure**: the
required properties are already set by the packages listed below. The dashboard checks everything
at startup and its **Diagnostics** page names any missing prerequisite together with its fix, so
start there rather than with this table.

| Requirement | Provided by | Without it |
| --- | --- | --- |
| `nuxeo.passthrough.elasticsearch.enabled=true` | The `nuxeo-search-client-opensearch1` package, through its `opensearch1-search-client` template | Nothing works |
| `nuxeo.search.client.default.name=opensearch` | Same package | Nothing works |
| Administrator session | — | Nothing works |
| `nuxeo.passthrough.elasticsearch.audit.enabled=true` | The `nuxeo-audit-opensearch1` package, through its `opensearch1-audit` template | Users and Workflows dashboards reduced to a notice naming the prerequisite |
| `RetentionRule` document type | The `nuxeo-retention` package | Governance dashboard reduced to a notice naming the package |
| Web UI | The `nuxeo-web-ui` package, declared as a dependency | No Administration menu entry; the dashboard stays reachable by URL |

Why administrators only: for a non administrator the passthrough rewrites the query to inject an
`ecm:acl` filter, which silently changes every figure, and the `audit` index is refused outright.
Rather than displaying numbers that mean something different per user, the dashboard requires an
administrator session.

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
3. **Diagnostics** — the six checks, ideally all green
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
npm run build        # production bundle
npm test             # unit tests (vitest + jsdom)
npm run format       # prettier
```

## How it works

### Deployment

Four contributions, no Java:

| File | Role |
| --- | --- |
| `nuxeo/OSGI-INF/deployment-fragment.xml` | Unzips the app into `nuxeo.war/dashboard/`, maps `NuxeoAuthenticationFilter` onto `/dashboard/*`, and adds a rewrite rule so Angular deep links survive a refresh |
| `nuxeo/OSGI-INF/dashboard-auth-contrib.xml` | Declares `dashboard/` as a valid start URL, so a login redirect returns to the requested page |
| `nuxeo/OSGI-INF/dashboard-webresources-contrib.xml` | Registers the Web UI menu entry with the `web-ui` resource bundle |
| `nuxeo/web/nuxeo.war/ui/nuxeo-labs-repository-dashboard.html` | The `nuxeo-slot-content` itself, a plain HTML file needing no build step |

Authentication relies entirely on the existing `JSESSIONID` cookie. Web UI remains the default UI
after login: no `startupPage` is contributed.

`nuxeo_build_tools/htmlToJsp.mjs` turns the built `index.html` into an `index.jsp` whose
`<base href>` reads the `app.base.url` property, so the deployment path stays configurable behind
a reverse proxy.

### Querying

The Nuxeo passthrough exposes neither `_msearch` nor `_mapping`. Issuing one request per widget
would mean a dozen round trips per screen, so `query-planner.ts` folds every widget backed by an
aggregation into a single request: each widget owns a named aggregation, and one carrying its own
predicate is wrapped in a `filter` aggregation. Table widgets need `hits` and keep a request of
their own.

The Content dashboard, thirteen widgets, therefore costs **one request**:

```jsonc
POST /nuxeo/site/es/nuxeo/_search        // Content-Type: application/json is mandatory
{
  "size": 0,
  "track_total_hits": true,
  "query": { "bool": { "filter": [
    { "term": { "ecm:isVersion": false } },
    { "term": { "ecm:isProxy": false } },
    { "term": { "ecm:isTrashed": false } }
  ] } },
  "aggs": {
    "expiringWeek":    { "filter": { "range": { "dc:expired": { "gte": "now", "lte": "now+7d" } } } },
    "expired":         { "filter": { "range": { "dc:expired": { "lt": "now" } } } },
    "byType":          { "terms": { "field": "ecm:primaryType", "size": 10 } },
    "topContributors": { "terms": { "field": "dc:creator", "size": 10 } }
  }
}
```

A widget with neither predicate nor metric emits no aggregation at all: it reads `hits.total`.

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

### Indexing rules worth knowing

Taken from the LTS 2025 `opensearch1-doc-mapping.json`; getting these wrong produces empty results
rather than errors.

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

Every per-user figure on the Users and Workflows dashboards counts `principalName`, which the audit
fills with `getActingUser()` rather than `getName()`:

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
│       │   ├── config/                         widget model, loader, dashboards/*.json
│       │   ├── core/                           HTTP, preflight, labels, formatting
│       │   ├── engine/                         agg compiler, query planner, result mapper, runner
│       │   ├── layout/                         shell, sidebar, grid, date range picker
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
| 2 | Cross filtering on bucket click, active filter chips, path scope, CSV and PNG export | |
| 3 | Configuration editor, with a field picker fed by `/api/v1/config/schemas` | |
| 4 | Workflows dashboard | done |
| 4b | Tasks dashboard, on open tasks and due dates | done |
| 4c | A median beside the mean, and a per model breakdown, where an aggregate mixes populations | done |
| 4d | Directory backed filtering for a field with as many values as there are people | done |
| 5 | Governance dashboard, on records, legal holds and retention | next |

## Licence

[Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0)

## About Nuxeo

[Nuxeo](https://www.hyland.com/products/nuxeo-platform), part of Hyland, is a highly customizable
and extensible content management platform for building business applications.
