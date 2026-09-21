# Customising this dashboard with an AI assistant

## TL;DR

**What ships already answers a lot.** Seven screens — Content, Users, Downloads, Workflows, Tasks,
Governance and Diagnostics — built out of 69 reusable widgets, with a filter bar that remembers the
document kinds you picked, cross-filtering by clicking a chart, a CSV and a PNG per widget, an HTML
file and a print sheet for the whole page, and a **Configure** dialog that lets an administrator
re-lay a screen out without touching the code. For a good many repositories that is the end of the
story, and it is meant to be.

**But if you want something else, you absolutely can have it.** Reorganise the widgets, drop the
ones nobody looks at, add your own, build a screen about your own document types, remove a whole
section, or strip the plugin down to the single screen your customer asked for. None of that is
off-limits, and this guide is how you do it.

Three sizes of change. Knowing which one you are in saves most of the effort:

| What you want | Where it happens | What it costs |
| --- | --- | --- |
| Move, resize or rename a widget; change how it is drawn; restrict it to a few document types | The **Configure** dialog, live | Nothing. No code, no rebuild, no deployment |
| The same, but for everyone and permanently | The dashboard's JSON file in your own copy | `mvn clean install`, a new `.zip` |
| A new widget, a new screen, a screen removed, a figure that means something else | The code in your own copy | An AI assistant, the same build, and the checks below |

The Configure dialog is the one to try first, and its limit is worth knowing: **an edit made there
lives in that browser only**, so a colleague opening the same page still sees what ships. It is
ideal for working out what you want, and not a way to deliver it.

### When it is code, the loop is

1. **Copy or fork this repository.** It becomes your plugin. You own it.
2. **Point an AI coding assistant at your copy** and describe the change you want. The prompts in
   this guide are written to be pasted and edited.
3. **Build and verify.** `mvn clean install` produces a `.zip`; `npm test` and `npm run build` tell
   you whether the change holds.
4. **Read the diff against the security checklist** at the end of this guide. This step is not
   optional and no test replaces it.
5. **Rename the plugin** ([Shipping your own plugin](#shipping-your-own-plugin)) and deploy your
   `.zip`.

### Five things to know before you start

- **Most changes are smaller than they look.** Six settings are already exposed to the JSON a
  dashboard is described by, and a great many requests land there — no code, and often no rebuild
  either.
- **This is an Angular 22 + TypeScript application**, zoneless, standalone and signal based, with
  **no Java at all**. If your assistant proposes `@Input()`, `*ngIf`, RxJS or an `NgModule`, it is
  writing Angular 15 and it does not belong here. `AGENTS.md` names the dialect in a table; point
  your assistant at it.
- **The compilers are a safety boundary, not an obstacle.** The dashboard talks to Nuxeo through a
  passthrough that forwards an administrator's payload verbatim. `agg-compiler.ts` and
  `clause-compiler.ts` are what stop a configuration from running arbitrary OpenSearch. An
  assistant that "simplifies" them has removed the only thing standing between a JSON file and a
  Painless script.
- **`npm run build` ships nothing.** Only `mvn install` writes the Angular output into the jar. The
  symptom of forgetting is the *previous* screen, not an error.
- **A green test run is not a verification.** Two of the four recipes proven below change nothing
  the test suite can see. Read [Verifying](#verifying) before you trust a colour.

---

## Built to be changed this way

Three decisions were taken so that pointing an assistant at this repository produces something that
works, and they live in the code rather than in a README.

- **The widget library is its own catalogue.** A definition is a dozen lines carrying a semantic id
  and one sentence saying what it measures — `registry.ts` opens by saying exactly that. There is
  no generated inventory for an assistant to fall out of step with: it reads the definitions
  themselves, and `registry.spec.ts` holds every one of them to that contract.
- **A dashboard names widgets instead of writing queries.** The grammar an assistant has to get
  right is small and closed, and a composition cannot express an OpenSearch clause at all.
- **A parameter a widget never declared is refused, not ignored.** The reason is written down in
  `definition.ts`: a misspelt parameter that is silently accepted produces a widget that renders
  perfectly while describing something else.

`AGENTS.md` writes the dialect and the invariants down so that an assistant does not have to guess
them, and this guide turns them into prompts.

---

## The principle

Past what the Configure dialog can do, you are **editing an Angular application and rebuilding a
Nuxeo package from it**. The AI is there to do the editing; your job is to describe the change
precisely, then to check what came back.

### Make it yours first

```bash
git clone https://github.com/ThibArg/nuxeo-labs-repository-dashboard my-dashboard
cd my-dashboard
git remote rename origin upstream        # so `origin` is free for your own remote
git checkout -b main
```

Keeping `upstream` costs nothing and lets you pull later. If you never intend to, drop it — but
decide now, because it changes one answer further down: whether to *modify* a shipped widget or
*duplicate* it.

### Then describe the change

A prompt that works here has four parts, and the fourth is the one people leave out:

| Part | Why |
| --- | --- |
| **The context** | Which file, which screen, which widget. An assistant that has to guess will guess plausibly and wrongly |
| **The intent** | What the reader of the screen should learn. Not "add a chart" but "show which document types people actually download" |
| **The constraints** | The invariants of this codebase. The shortest useful form: *"read AGENTS.md and CUSTOMISING.md first, and follow the dialect table"* |
| **The verification** | What you will run, and what must be true afterwards. Ask for it in the same breath, or you will get code that compiles and figures nobody can account for |

### Two prompts to start from

The smallest useful one — no code at all, one key in a JSON file:

```text
In my-dashboard, the Content screen draws "Documents Created" as an area chart.
I want a bar chart instead.

Read AGENTS.md first. Find the widget in src/app/config/dashboards/content.json and
tell me whether this is a parameter of the existing widget or a change to its
definition — do not edit anything until you have said which.

Then make the change, run `npm test -- --watch=false` and `npm run build`, and show
me the diff.
```

The answer should be: `documents-created` declares `chart` as an enum parameter, so this is
`"with": { "chart": "bar" }` in the JSON and nothing else. Notice what the prompt did: it **forced
the assistant to name the layer before touching anything**. That single habit prevents most of the
damage an assistant does in this codebase.

A harder one, which is the worked example this guide is built around:

```text
In my-dashboard, I want a screen showing what people download.

Constraints, please verify each against the Nuxeo sources or the live index rather
than assuming:
  - the audit `download` event is fired both when a reader saves a file and when the
    interface fetches a thumbnail or a preview. Find how to tell them apart and show
    me the field and the values.
  - measure the two on my server before designing the screen. If one dwarfs the
    other, the screen must show both rather than presenting either as "downloads".
  - there is no upload event in Nuxeo. Confirm that, and do not invent one.

Follow the library idiom in src/app/library/: one definition per idea, populations in
a populations.ts, the five builders in builders.ts, the four predicates in
predicates.ts. A definition must never write an EsClause.

Then add the screen, wire the route and the navigation entry, write the specs, run
the suite, and run one throwaway spec against my live server to prove OpenSearch
accepts the requests — pointed at a dead port first, so a green run means something.
```

That prompt is what produced the Downloads screen that ships. The measurements it asked for are
the reason the screen has two tiles instead of one: **539 `download` entries, of which 524 were
renditions and 15 were files a reader actually saved.** A screen headed "Downloads: 539" would
have described browsing while claiming to describe reading.

---

## Which layer is my change?

Four layers. Naming the right one is most of the work, and it is what the first prompt above asks
the assistant to do before it edits anything.

| Layer | Where | Typical change | Rebuild? |
| --- | --- | --- | --- |
| **Composition** | `src/app/config/dashboards/*.json` | Place, rename, resize, set one of the six parameters | `mvn install` — or nothing at all, through the Configure dialog |
| **Definition** | `src/app/library/` | A new widget, a different field, a different population | `mvn install` |
| **Engine** | `src/app/core/`, `engine/`, `widgets/` | A new number format, a new label strategy, a new chart type | `mvn install`, under the invariants |
| **Platform** | `nuxeo/`, `pom.xml`, `package.xml` | The menu entry, the URL, the plugin's identity | `mvn install` and redeploy |

### What the composition layer already exposes

Six parameters, and nothing else. Measured over the 69 definitions:

| Parameter | Declared by | Values |
| --- | --- | --- |
| `chart` | 36 | `donut`, `pie`, `bar`, `hbar`, `ranked-list` on a breakdown; `area`, `line`, `bar` on a trend. **The two sets are disjoint** — `line` is unreachable on a donut widget and refused loudly |
| `size` | 28 | How many values a top N lists, 1 to 100 |
| `severity` | 19 | The colour a KPI tile carries |
| `types`, `facets` | 13 | Narrow a repository widget to document types or facets. An empty list means **no constraint**, never "no value" |
| `interval` | 8 | The bucket width of a trend |

Plus four keys the composition owns outright: `title`, `hint`, `span`, `spanByRange`.

Everything else — the field, the metric, the ordering, the label strategy, the **format**, the
bands of a distribution, the columns of a table — belongs to the definition. Nine definitions
expose no parameter at all.

---

## Recipes

Each one is a prompt to paste and edit, what the prompt must carry, and how to check the result.
Every file count and test delta below was **measured by performing the recipe**, not derived from
reading the code.

### 1. Change how an existing widget is drawn

```text
In my-dashboard, on the <SCREEN> screen, the widget <NAME> should be drawn as a
<CHART TYPE> instead.

Before editing: tell me whether that chart type is in the enum the widget declares.
If it is not, stop and tell me — do not widen the enum, and do not switch the widget
for a different one.
```

**Why the second paragraph matters.** The two chart sets are disjoint by intent: a breakdown is not
a trend. Asking a donut widget for `line` is refused by `resolveParams`, and
`compileComposition` then refuses **the whole dashboard**, not just that cell — "the compiler
compiles everything or nothing". An assistant that "fixes" this by widening the enum has made a
top N of `ecm:primaryType` renderable as a time series.

**Verify:** `npm test`, then look at the diff. It should be one line in one `.json` file.

### 2. Modify a widget, duplicate it, or promote a knob to a parameter

This is the question people ask most, and the answer is a decision, not a preference.

```text
In my-dashboard, "Average Duration by Model" on the Workflows screen shows values
like "32.6 days". I want whole numbers — "33 days".

Work out which layer this belongs to before editing, and tell me the blast radius:
which other widgets would change if you edit the shared code, and what it would cost
to change only this one. Then propose the three options and let me choose.
```

The honest answer, on this server: that widget renders `32.6 days`, `10.0 days`, `9.0 days`,
`34.7 h`, `3.1 h`. The decimal comes from `formatDuration` in `src/app/core/format.ts` — **not from
the widget**, because `format` is a parameter of no definition anywhere. Three options:

| Option | Blast radius | When it is right |
| --- | --- | --- |
| Edit `formatDuration` | **Every duration widget on every screen** | You want coarse durations everywhere. Say so |
| Add a `ValueFormat` member, e.g. `durationCoarse`, and use it in this definition | The closed union widens by one; `core/format.ts` gains a branch | You want this figure coarse and the others precise |
| Make `format` a parameter of this definition | One widget, settable from the JSON | Rarely right. See below |

**The rule for the third option, and for duplicating.** A parameter is for *how much* and *how it
is drawn*, never for *what it means*. That is the line `AGENTS.md` already draws for the bands of a
distribution and the columns of a table: "under an hour, up to a day, up to a week, beyond" **is**
what `workflow-duration-distribution` means, and a different split is a different widget. A mean
workflow duration **is** a duration; its format is not a display setting.

And modify versus duplicate:

- **Modify in place** is the default for a fork. You own the product, and 63 of the 64 widgets on
  the shipped screens are placed exactly once.
- **Duplicate under a new id** when the original must survive somewhere else — today only
  `live-documents` is shared, between Content and Governance — or when you intend to keep pulling
  from `upstream` and want that file to stay mergeable.
- Duplicating costs one entry in `registry.ts` and nothing else. There is no drift risk:
  `registry.spec.ts` walks the folder with `import.meta.glob` and fails on a definition that is not
  registered.

**Verify:** `npm test`. If you edited `core/format.ts`, also open two other screens and look at
their durations — that is the blast radius you accepted.

### 3. Add a widget

```text
In my-dashboard, add a widget to <SCREEN> that shows <WHAT THE READER SHOULD LEARN>.

Before writing anything:
  - find the field on the <nuxeo|audit|audit_wf> index that answers this, and tell me
    whether it is aggregatable. Read README.md, section "Indexing rules worth knowing".
  - if the question cannot be answered by a single aggregation, say so instead of
    approximating silently.

Then follow the library idiom exactly: a definition in src/app/library/<domain>/,
built from one of the five builders in builders.ts and the four predicates in
predicates.ts, with the population in that domain's populations.ts. The definition
must never write an EsClause.

Register it in registry.ts, place it in the dashboard JSON, and make the spans of
its row sum to a multiple of twelve.

Then: `npm test -- --watch=false`, `npm run build`, and one throwaway spec that plans
with the real planner and sends the request to my server, pointed at a dead port
first. Delete the harness afterwards.
```

**What the prompt has to carry, and why each line is there.**

- *"tell me whether it is aggregatable"* — `dc:title` is readable and not aggregatable.
  `thumb:thumbnail.*` and `picture:views.*` are mapped `index: false`. A `.keyword` suffix matches
  nothing on a Nuxeo index and `agg-compiler.ts` refuses it outright.
- *"say so instead of approximating"* — this is what "uploads per day" is. **There is no upload
  event in Nuxeo**: not in `BatchManager`, not in `BatchUploadObject`, and `blobUpdated` does not
  exist. An assistant asked for that chart will happily build one on `documentModified`, which says
  nothing about *what* changed. A widget that renders perfectly while describing something else is
  the worst outcome available here.
- *"must never write an EsClause"* — see the security checklist.
- *"spans sum to a multiple of twelve"* — asserted per row and per date range by every page spec.
- *"throwaway spec… dead port first"* — a fixture proves you built what you meant to build, never
  that OpenSearch accepts it. A harness reaching a wrong URL passes without touching anything.

**Files touched:** the definition, `registry.ts`, the dashboard JSON. Nothing else. If your
assistant edits `agg-compiler.ts`, `clause-compiler.ts`, `query-planner.ts` or
`dashboard-config.model.ts` to make a widget work, **that is the signal the widget has left the
grammar** — which is deliberate, and worth a conversation rather than a patch.

**Verify:** `npm test` — `registry.spec.ts` will hold the new definition to four checks on its own
(a summary over twenty characters ending in a full stop, a `describe` per parameter, defaults it
accepts, and that it plans alone in exactly one request). `clause-compiler.spec.ts` will demand
that whatever it emits survives a rebuild unchanged.

### 4. Add a screen

```text
In my-dashboard, add a screen called <NAME> showing <WHAT>, reading the <INDEX> index.

Follow what the Downloads screen does, end to end: the definitions under
src/app/library/<domain>/ with their populations and a populations spec, the
composition in src/app/config/dashboards/<id>.json, the route in app.routes.ts
through the `dashboard()` helper, the navigation entry in layout/navigation.ts, and
a page spec modelled on src/app/pages/downloads-dashboard.spec.ts.

If the screen needs a server prerequisite, declare it with `requires:` on the route
so the page names what is missing instead of rendering empty.
```

`shipped-dashboards.spec.ts` finds the new JSON on its own — it globs the folder — and holds it to
every rule the others obey, including the `validateConfig` an administrator's edit goes through.
`navigation.spec.ts` will fail if you add the route and forget the menu entry, or the reverse.

### 5. Remove a screen

**Proven on Governance.** 8 files deleted, 3 edited, or 6 if you also drop its preflight check.

```text
In my-dashboard, remove the <NAME> screen completely — not hidden, removed.

Delete its library folder, its dashboard JSON and its page spec, then purge
registry.ts, app.routes.ts and layout/navigation.ts.

Then tell me the test count before and after. A green suite means nothing here: the
specs are discovered by glob, so removing a screen makes its tests disappear silently.

Finally, grep for the screen's name across README.md, AGENTS.md and package.xml, and
for any preflight check that now exists for nobody.
```

**What the tooling catches, in the order you will meet it:**

| Signal | Quality |
| --- | --- |
| `registry.ts` — four `TS2307` | Clean. The first thing to fail |
| Route removed, menu entry kept — `navigation.spec.ts` fails naming the screen | Clean. **Without this test the reader clicks the entry and silently lands on Content**, because the router ends in a catch-all |
| Preflight feature removed, route kept — `TS2322` naming the `requires:` line | Clean, by design |
| The now-orphan check method — `TS6133` under `noUnusedLocals` | Clean. Cannot be forgotten |
| `preflight.service.spec.ts` — `TS2339` | **Misleading.** A type error in a spec makes the *whole suite refuse to build*, so it reads as a broken environment rather than a stale assertion |

**What nothing catches:** the test count dropped from 932 to 835 with the suite green. Compare the
number, never the colour. Also silent: a `fetch-stub` route for a prerequisite nobody checks any
more, the package description shipped to installers, and — if you keep the route — a stored
`localStorage` override that keeps rendering a working page for whoever holds it.

### 6. Remove the Web UI menu entry

**Proven.** 4 files deleted, 3 edited. **Test count: 932 before, 932 after.** Not one of the 932
tests touches `nuxeo/`. The jar is the only verification there is.

```text
In my-dashboard, remove the Web UI Administration menu entry. The administrator will
reach the dashboard by URL.

Delete the html resource, the webresources contrib and both messages*.json, then edit
the MANIFEST and the deployment fragment.

Two things to be careful with in MANIFEST.MF: the trailing comma on the remaining
Nuxeo-Component line must go, and the file must keep its final newline. Show me
`xxd` of the last bytes to prove it.

Then `mvn clean install` and list the jar. There must be no `web/` entry and exactly
one Nuxeo-Component.
```

The newline is not a style point: without it the last header is silently dropped, and the header
you would lose is the one registering the authentication filter.

### 7. Remove a date range preset

**Proven.** One line, one test. 932 → 931.

```text
In my-dashboard, remove the "<LABEL>" entry from DATE_RANGE_SHORTCUTS.

Then check two things I expect to be left behind:
  - whether that entry was the only one exercising some branch of resolveShortcut,
    which would now be unreachable without anything flagging it
  - which page specs still iterate its id in their "fills complete grid lines" loop,
    and fix them — they stay green while testing a range that no longer exists
```

Both happen. `12m` was the only entry carrying `months`, so its branch became dead code that
`noUnusedLocals` does not flag; and seven page specs kept iterating `'12m'`, silently losing one
range of coverage each.

The red you get first is real but its message lies: `TypeError: Cannot read properties of undefined
(reading 'days')`, three frames from the cause, because the spec helper ends in a `!`.

### 8. A dashboard on your own business data

```text
In my-dashboard, I want a screen about our <TYPE> documents only.
[describe the figures you want]

Start by telling me how many of these I can get with widgets that already exist plus
`"with": { "types": ["<TYPE>"] }`, and which ones genuinely need a new definition
because they read a field of our own schema.
```

That first question is worth asking every time. Thirteen definitions already accept `types` and
`facets`, so a whole screen about one document type is often a composition and nothing more. What
needs a definition is only what reads *your* fields — and those go through the same check as any
other field: aggregatable, no `.keyword`, a dot rather than a slash inside a complex property.

---

## Requests that are not what they look like

Every one of these was asked for, investigated, and set aside. Each is a day you do not have to
spend. The full argument for each lives in `AGENTS.md`.

| Request | Why it is not a recipe |
| --- | --- |
| **The dashboard emailed every week** | Needs a Java module — this plugin has none — a scheduler, and a way to render server-side. The HTML export clones the *live DOM*, which does not exist on a server. The three ways out are a headless browser, a second description of the dashboard in Java that will drift, or an email carrying a link. This is a design conversation, not a prompt |
| **"Total size" / blob volumetry** | A plain sum answers a different question: a document versioned ten times is counted eleven. The community method breaks past `search.max_buckets`. The only sound route is the bulk `blobs/orphaned?dryRun=true` action, which ignores the date range and the type filter entirely |
| **Group tasks by workflow model** | `nt:processName` holds the node's *notification template*, not the model. It needs a join the planner cannot express |
| **"Documents entering a workflow"** | In `audit_wf`, `docType` and `docUUID` name the route or the task, never the business document |
| **A table of audit entries linking back to Web UI** | The planner always adds `ecm:uuid` to `_source`, which the audit does not carry |
| **"Overdue, but the workflow is finished"** | Empty by construction: the done listener cancels the remaining tasks in the same transaction |
| **List the documents under a tile** | Twenty rows under a badge reading ten thousand describe nothing, and no sort makes the other 9,980 reachable. It needs paging first |
| **"Uploads per day"** | There is no upload event in Nuxeo, at all |

If your assistant produces something for one of these anyway, it has approximated. Ask it what it
measured, and compare with the row above.

---

## Verifying

### The sequence

```bash
cd my-dashboard-web
export PATH="$PWD/node:$PATH"

npm test -- --watch=false      # `ng test` defaults --watch to true in a TTY. It will never return
npm run build                  # this is the typecheck. There is no separate one
npm run format                 # prettier. Nothing in the Maven build checks it

cd .. && mvn clean install     # the only thing that produces something deployable
unzip -l my-dashboard-web/target/*.jar | grep assets/dashboards
```

### Four things a green run does not tell you

1. **The test count.** Specs are discovered by glob, so deleting things makes tests vanish
   silently. Record the number before and after, every time.
2. **Anything under `nuxeo/`.** Zero of the 932 tests reach the MANIFEST, the deployment fragment
   or the Web UI resources. Inspect the jar.
3. **That OpenSearch accepts your request.** A fixture proves you built what you meant to. For a
   newly shaped request, write a throwaway spec that plans with the real planner and `fetch`es the
   result — and **point it at a dead port first**. A harness reaching a wrong URL passes without
   touching anything.
4. **That what is deployed is what you built.** See below.

### Deploying onto a running server

The README's install sequence covers a first installation. The second one — the one you perform all
day while iterating — hits two things it does not mention.

```bash
# mp-install refuses to reinstall a package that is already `started`:
#   Cannot execute command. A server is running with process ID …
docker exec <container> nuxeoctl stop          # leaves the container alive, so exec still works
docker cp my-dashboard-package/target/*.zip <container>:/tmp/d.zip
docker exec <container> nuxeoctl mp-install /tmp/d.zip --accept=true
docker restart <container>
```

And then **confirm on three things rather than on the screen**:

```bash
docker exec <container> grep my-dashboard /opt/nuxeo/server/packages/.packages   # must read `started`
docker exec <container> ls /opt/nuxeo/server/nxserver/bundles/ | grep my-dashboard  # a real jar
curl -su user:pass http://host/nuxeo/dashboard/ | grep -o 'main-[A-Z0-9]*\.js'   # matches target/
```

The reason is worth knowing, because it cost a day here. `nuxeo.war/dashboard/` is unzipped at
server start and **Tomcat keeps serving those files whether or not any bundle is loaded**. So a
failed install looks exactly like a working plugin: every screen answers, every URL resolves, and
the code running is whatever was built two versions ago. The only visible symptom is that your
change is not there.

If an install fails with `Parameter 'destFile' is not a file: …jar.tmp`, a previous interrupted
deployment left a *directory* where the package manager writes its staging file. Clear it with
`rmdir` — never `rm -rf`, so that a directory holding anything refuses to go and says so.

---

## Shipping your own plugin

**Proven end to end**, down to a working `.zip`. Do this before you deploy anywhere the original is
installed: they collide on the bundle symbolic name, on two component names, on the URL path, on
the `localStorage` keys, and on the package id — and that last one means **installing your fork
uninstalls the original**.

### The method: two global string replaces, not a hand-picked file list

```bash
git mv nuxeo-labs-repository-dashboard-web     my-dashboard-web
git mv nuxeo-labs-repository-dashboard-package my-dashboard-package
# then, over every pom.xml, *.xml, *.json, *.mjs, *.ts, *.html and MANIFEST.MF:
#   org.nuxeo.labs.dashboard        -> com.example.mydashboard
#   nuxeo-labs-repository-dashboard -> my-dashboard
```

**Replace the strings everywhere; do not pick files.** Three couplings that look like traps are in
fact kept in step by a global replace, precisely because all three spell the artifactId the same
way: the `angular.json` project key and the `dist/<name>/browser` path in both `pom.xml` and
`htmlToJsp.mjs`; and the `<artifact groupId="…*"/>` globs in `assembly.xml`, which decide whether
your jar lands in `install/bundles/` or silently in `lib/`. Hand-picking is what desynchronises
them.

### Seven things the replaces do not cover

1. **The Web UI resource file name.** `git mv` it. The contrib inside was renamed, the file was not.
   **Measured: `mvn clean install` is green and ships a contrib pointing at a file that is not in
   the jar.** Nothing in the build compares the two; the menu entry simply never renders.
2. **The URL path**, six places, because the segment is the word `dashboard` and not your
   artifactId: the deployment fragment (url-pattern, RewriteCond, RewriteRule), the auth contrib's
   `<pattern>`, the html `link=`, `htmlToJsp.mjs`, the `outputDirectory` in `pom.xml`, and
   `src/app/core/nuxeo-http.service.ts`, which strips a literal `dashboard` segment off
   `<base href>` to find the server root and falls back to `/nuxeo` when it does not match — right
   by accident on a default deployment, wrong behind a reverse proxy.
3. **The i18n key** `repositoryDashboard.menu`, in the html and both `messages*.json`.
4. **The slot content name** and the **menu item name**, both in the html. Two plugins contributing
   the same slot content at the same order collide.
5. **The `localStorage` prefixes** `nxd.config` and `nxd.filters`. Without this your fork shares
   saved dashboard overrides and filter selections with the original, same origin, same keys.
   *Caught loudly*: three specs hard-code them and fail naming the values.
6. **The package title, description and vendor** in `package.xml`. Prose, spaced and title-cased,
   so no replace of the hyphenated id reaches it — your fork would ship displaying the original's
   name in the Admin Center.
7. **The component selector prefix** `nxd`: 146 occurrences, purely internal, no collision. Leave
   it alone.

---

## The security checklist

Run this on the diff, every time, before you build. It takes a minute and nothing else does it for
you.

```bash
git diff --stat upstream/main   # or whatever you are comparing against

# 1. Did the assistant touch the boundary?
git diff upstream/main -- \
  '*/engine/agg-compiler.ts' '*/engine/clause-compiler.ts' \
  '*/config/dashboard-config.model.ts' '*/core/nuxeo-http.service.ts'

# 2. Did anything raw leak into a definition or a dashboard file?
git diff upstream/main -- '*/library/*' '*/config/dashboards/*' \
  | grep -nE 'script|runtime_mappings|\.keyword|EsClause|terms.*index.*path'
```

**Both must come back empty for an ordinary change.** If the first is not empty, read every line
and ask why. Here is what those files are for.

| Invariant | What it stops | What breaking it costs |
| --- | --- | --- |
| **`AggConfig` is a closed union and `agg-compiler.ts` its only compiler** | Raw OpenSearch DSL reaching the passthrough | The passthrough forwards an administrator's payload **verbatim**. Accepting arbitrary DSL means accepting `script` — Painless, per document, under the administrator's identity — and `runtime_mappings` |
| **`clause-compiler.ts` *rebuilds* every clause instead of relaying it** | A key nobody thought to refuse riding along beside one that was accepted | Rebuilding is the guarantee: a clause that passes leaves nothing behind it. Two of its own tests say so out loud |
| **A `terms` clause must be a list** | A *terms lookup* — `{"terms": {"f": {"index": …, "id": …, "path": …}}}` reads values out of a document on another index, wearing the clothes of an ordinary filter | This is the least obvious of the shapes refused. An assistant "generalising" the clause type reopens it |
| **A definition uses the four predicates, never an `EsClause`** | Intent instead of DSL, one layer above the compiler | Two guarantees rather than one, which is why both are worth having |
| **A composition cannot express a clause at all** | Anything an administrator types in the Configure dialog | This is why the composition form is the safe one, and why the editor opens on the source rather than the compilation |
| **No `.keyword` suffix** | A filter that silently matches nothing on a Nuxeo index | Refused by construction, and asserted over every shipped file |
| **A shared filter names the indices it constrains** | An audit request carrying `ecm:path.children` | Measured: status 200, no error, **zero hits**. Not unfiltered — empty. `validateConfig` refuses a mixed page that leaves it implicit |

Two more, about the deployment rather than the queries:

- **Never add `<require>org.nuxeo.web.ui</require>` to a `<component>` file.** Inside a component,
  `require` names a *component*, and no component bears that name — it is a bundle symbolic name.
  The component would stay pending and, `nuxeo.start.strict` defaulting to true, the server would
  refuse to start. It is legitimate in the deployment *fragment*, where `require` does name a
  bundle.
- **The dashboard asks for an administrator session, and client-side code cannot enforce that.**
  What protects you is the platform: the passthrough refuses `audit` and `audit_wf` to a
  non-administrator outright, and injects an ACL filter into every repository query. That stops
  being true the day a widget reads something other than the passthrough — which is the reason to
  say it here rather than to discover it then.

---

## This will drift

Two things will date this guide, and you should expect both.

**The codebase moves.** Every count here — 69 definitions, 65 placements, 932 tests, six
parameters — is a photograph. Re-measure rather than quote. The commands are in
[Verifying](#verifying), and `AGENTS.md` carries the same warning about its own figures.

**Your assistant is not the one this was written with.** These prompts were exercised with a
particular model in a particular tool, and models differ in what they need spelled out. Some need
the dialect table quoted; some will read `AGENTS.md` if you name it and ignore it if you do not;
some invent a plausible Nuxeo API when asked for a field they cannot find. Adapt the prompts —
and when a phrasing turns out to be load bearing, write it down in your own fork rather than
rediscovering it.

The parts that will *not* drift are the ones about why the boundaries exist. A model that argues
its way past `clause-compiler.ts` is making a case that was already considered and refused; the
reason is in the table above, and it has not changed.
