# Media Monitoring — Mentions Service

A small backend slice of a media monitoring platform: it ingests "mentions"
(articles and social posts) from messy upstream feeds, normalizes them, stores
them in PostgreSQL, and lets PR analysts search and chart them.

Three endpoints, one table, no ORM.

---

## ⚠️ Read this first: the seed file

**`seed_mentions.json` was not provided with this working copy**, so no design
decision in this repository was derived from inspecting it.

That matters, because the brief asks for exactly that. Rather than invent a
dataset and present it as the real one, the service was built against the
messiness categories the brief itself enumerates (repeated articles,
inconsistent source naming, multiple date formats, missing dates, raw HTML,
numbers stored as strings), with three deliberate safeguards:

1. **Nothing is thrown away.** The complete original record is stored in a
   `raw jsonb` column, so a field this service does not yet understand is
   preserved rather than lost.
2. **Input validation is permissive about shape, strict about semantics.**
   Unknown fields pass through, common field-name aliases are accepted, and
   only genuinely unusable records are rejected.
3. **A profiling tool ships with the repo.** `npm run inspect:seed` reports
   what is actually in a seed file — field frequencies, value types, date
   values the parser rejects, which source spellings fold together, and how
   many rows the duplicate rule would collapse.

**To validate against the real data:**

```bash
cp seed_mentions.json .          # place it in the project root
npm run inspect:seed             # profile it before trusting anything
npm run seed                     # ingest it
```

If `inspect:seed` reports rejected dates or a source folding that looks wrong,
that is a signal to revisit a normalization rule — the rules are small, isolated
and unit-tested precisely so they can be adjusted. Every assumption that would
need re-checking is listed under [Assumptions](#assumptions).

The fixture in `tests/fixtures/messy-mentions.json` is clearly labelled as a
test fixture and does not claim to be the assessment's seed data.

---

## Table of contents

- [Overview](#overview) · [Architecture](#architecture) · [Tech stack](#tech-stack)
- [Getting started](#getting-started) — [prerequisites](#prerequisites), [env vars](#environment-variables), [PostgreSQL](#postgresql-setup), [migrations](#migrations), [running](#running-the-server), [tests](#running-the-tests), [seeding](#ingesting-seed-data)
- [API](#api) — [bulk ingest](#post-internalmentionsbulk) · [search](#get-mentions) · [stats](#get-mentionsstats)
- [Design](#design) — [schema](#database-schema) · [duplicates](#duplicate-detection) · [normalization](#normalization) · [search](#search-behavior) · [pagination & sorting](#pagination-and-sorting) · [indexes](#indexing-decisions)
- [Errors](#error-handling) · [Assumptions](#assumptions) · [Trade-offs](#trade-offs)
- [Dashboard](#dashboard) · [Effort](#effort) · [With another week](#with-another-week-i-would)

---

## Overview

| Endpoint | Purpose |
| --- | --- |
| `POST /internal/mentions/bulk` | Idempotent bulk ingestion of raw mention records |
| `GET /mentions` | Keyword search + source/date filters, paginated |
| `GET /mentions/stats?group_by=source\|day` | Aggregated counts |
| `GET /health` | Liveness + database reachability |

The two properties the service is built around:

- **Idempotency is enforced by the database.** A `UNIQUE` index on a
  deterministic fingerprint plus `INSERT … ON CONFLICT DO NOTHING` means repeat
  submissions, retries and concurrent requests cannot create duplicate rows.
  There is no `SELECT`-then-`INSERT` anywhere in the codebase.
- **Nothing is invented.** A missing publication date stays `NULL`; a record
  with no identifiable source is rejected rather than filed under "unknown".

## Architecture

**Feature-based.** Shared infrastructure lives at the top of `src/`; everything
that belongs to a domain concept lives inside `src/features/<feature>/`, split
by layer. Adding an endpoint touches one feature folder, and a second feature
(campaigns, alerts) drops in beside `mentions` without reorganising anything.

The dependency arrow only ever points one way:

```
route  ->  controller  ->  service  ->  repository  ->  PostgreSQL
                |              |
            validation    normalization
```

- **route** — wiring only: HTTP method and path to a controller. 12 lines.
- **controller** — the HTTP boundary: validates the request, calls a service,
  shapes the reply. Knows about `FastifyRequest`; knows no SQL.
- **service** — the use case. Owns the transaction boundary. Knows nothing
  about HTTP, so `npm run seed` reuses `storeMentions` directly from the CLI
  with no HTTP layer involved.
- **repository** — all SQL, all parameterized. Knows nothing above it.

```
src/
  server.ts                      process entrypoint: config, pool, signal handling
  app.ts                         builds the Fastify instance (no listen -> testable)
  config.ts                      env parsing/validation

  db/       client.ts  migrator.ts        shared infrastructure
  utils/    errors.ts  error-handler.ts  load-env.ts

  features/
    mentions/
      index.ts                        the feature's public surface
      routes/mention.routes.ts        12 lines: method + path -> controller
      controllers/mention.controller.ts   57 lines: validate, delegate, reply
      services/mention.service.ts     129 lines: storeMentions, fetchMentions, fetchMentionStats
      repositories/mention.repository.ts  198 lines: every SQL statement
      validation/mention.validation.ts    148 lines: Zod schemas
      types/mention.ts                104 lines
      normalization/                  pure, deterministic, no I/O
        mention-normalizer.ts         orchestrates the field rules
        text.ts  source.ts  url.ts  date.ts  number.ts
        fingerprint.ts                the duplicate rule

migrations/001_create_mentions.sql
scripts/    migrate.ts  seed.ts  inspect-seed.ts
tests/
dashboard/                       optional read-only UI (see Dashboard)
```

**One file per layer, per feature.** With three endpoints, splitting each layer
into per-endpoint files produced four files and 71 lines for `routes/` alone —
more navigation than code. A layer is split only when it actually grows too
large to scan.

`normalization/` is the deliberate exception, and it splits on a different
axis: not per endpoint, but per *rule*. Date parsing, URL canonicalization and
source folding are independent concerns with independent unit tests, so each
earns its own file.

### Naming conventions

Function names carry their layer, so a call site tells you which layer it is
crossing without opening the file:

| Layer | Prefixes | Examples |
| --- | --- | --- |
| `validation/` | `get` · `post` · `patch` · `update` · `delete` (+ `Schema`) | `getMentionsSchema`, `postMentionsBulkSchema` |
| `repositories/` | `get` · `post` · `patch` · `update` · `delete` | `getMentions`, `postMentions`, `getMentionCountsBySource` |
| `services/` | `fetch` · `store` · `change` · `remove` | `fetchMentions`, `fetchMentionStats`, `storeMentions` |
| `controllers/` | `load` · `save` · `modify` · `destroy` (+ `Controller`) | `loadMentionsController`, `saveMentionsBulkController` |

Each layer gets its own verb set, so a name alone says which layer it belongs
to and the same operation reads differently at every depth:

```
saveMentionsBulkController  ->  storeMentions  ->  postMentions
   (controller)                  (service)         (repository)

loadMentionsController      ->  fetchMentions  ->  getMentions
```

Repositories keep the CRUD verbs closest to SQL. Services are named for the
*use case*, which is why ingestion is `storeMentions` and not `postMentions` —
it normalizes, deduplicates and reports, so `store` describes it and `post`
would not. Controllers use `load`/`save` because their job is request-shaped,
not data-shaped.

`modify` and `destroy` are reserved by the convention but currently unused:
this feature exposes no PATCH or DELETE endpoint, and none was invented to fill
the table.

Two structural choices worth calling out:

- **`buildApp()` is separate from `server.ts`.** Tests drive the real
  application through `app.inject()` against a real PostgreSQL database — no
  HTTP mocking, no repository fakes.
- **Normalization is pure.** No clock, no database, no network. That is what
  makes fingerprints stable across runs and lets every rule be unit-tested in
  milliseconds without PostgreSQL.

## Tech stack

Node.js ≥ 20 · TypeScript (strict) · Fastify 5 · PostgreSQL · `pg` · Zod ·
Vitest. No ORM — the schema lives in a committed SQL migration and nowhere else.

---

## Getting started

### Prerequisites

- Node.js ≥ 20 (uses the built-in `process.loadEnvFile`)
- PostgreSQL ≥ 13 — verified against **PostgreSQL 14** locally and pinned to
  **16** in `docker-compose.yml`. No version-specific features are used.
- Docker (optional, only for the bundled PostgreSQL)

### Environment variables

```bash
cp .env.example .env
```

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | Connection string for the server and migrations |
| `TEST_DATABASE_URL` | for `npm test` | — | Throwaway database; **the suite truncates tables** |
| `PORT` | no | `3000` | HTTP port |
| `HOST` | no | `0.0.0.0` | Bind address |
| `LOG_LEVEL` | no | `info` | `fatal`…`trace`, or `silent` |

Config is validated by Zod at boot: a missing or malformed variable fails
immediately with a clear message rather than surfacing as a runtime error.
`.env` is gitignored; no credential is committed.

### PostgreSQL setup

**Option A — Docker (easiest):**

```bash
docker compose up -d
```

Starts PostgreSQL 16 on `localhost:5432` with database `media_monitoring`.
Then create the test database:

```bash
docker compose exec postgres createdb -U postgres media_monitoring_test
```

**Option B — an existing PostgreSQL:**

```bash
createdb media_monitoring
createdb media_monitoring_test
```

Update `DATABASE_URL` / `TEST_DATABASE_URL` in `.env` to match your credentials.

### Migrations

```bash
npm install
npm run migrate
```

Applies every `.sql` file in `migrations/` in filename order, each inside a
transaction, recording applied files in `schema_migrations`. Re-running is a
no-op. A `pg_advisory_lock` makes concurrent runners safe.

Migrate the test database too:

```bash
DATABASE_URL="$TEST_DATABASE_URL" npm run migrate
```

(The test suite also migrates automatically on start, so this is optional.)

The runner is ~40 lines rather than a migration library, because the brief asks
for the schema to be explicit and reviewable: `migrations/001_create_mentions.sql`
is the single source of truth, and the schema is reproducible from an empty
database.

### Running the server

```bash
npm run dev      # watch mode
# or
npm run build && npm start
```

```bash
curl localhost:3000/health
# {"status":"ok"}
```

### Running the tests

```bash
npm test
```

Requires `TEST_DATABASE_URL`. The suite runs against **real PostgreSQL** — the
behaviour under test (`ON CONFLICT` idempotency, `NULLS LAST` ordering, UTC day
bucketing) *is* PostgreSQL behaviour, so a mock would prove nothing.

**59 tests across 4 files**, prioritising risk over coverage percentage:

| File | Covers |
| --- | --- |
| `normalization.test.ts` (25) | HTML, source folding, URL canonicalization, every date format, numeric strings, record-level rules, determinism |
| `ingestion.test.ts` (13) | Idempotency, in-batch and cross-request duplicates, **concurrent submissions**, partial ingestion, malformed bodies |
| `search.test.ts` (13) | Keyword search, filters, stable ordering, pagination integrity, invalid parameters |
| `stats.test.ts` (8) | Source folding in aggregates, UTC day buckets, missing-date reporting, invalid `group_by` |

The headline test does exactly what the brief asks: ingest the dataset, record
the row count, ingest the identical dataset again, assert the count did not
change — then a third time, to prove it is not a one-off.

These assertions were **mutation-tested**: deliberately breaking the fingerprint
rule fails 5 tests, confirming they are load-bearing rather than decorative.

### Ingesting seed data

```bash
# via the CLI (uses the same ingestion service as the HTTP endpoint)
npm run seed                       # reads ./seed_mentions.json
npm run seed -- path/to/file.json

# or via the API
curl -X POST localhost:3000/internal/mentions/bulk \
  -H 'Content-Type: application/json' \
  --data-binary @seed_mentions.json
```

---

## API

All responses are JSON. All errors share one envelope:

```json
{ "error": { "code": "MACHINE_READABLE_CODE", "message": "Human readable", "details": [] } }
```

### `POST /internal/mentions/bulk`

Accepts a bare array (the shape of `seed_mentions.json`) **or**
`{ "mentions": [...] }`. Max 50 000 records per batch, 16 MiB body.

**Request**

```bash
curl -X POST localhost:3000/internal/mentions/bulk \
  -H 'Content-Type: application/json' \
  -d '[
    {
      "source": "Kompas.com",
      "title": "Ekonomi Digital Tumbuh 12 Persen",
      "content": "<p>Pertumbuhan <b>ekonomi digital</b> tercatat naik.</p>",
      "url": "https://www.kompas.com/ekonomi/read/2024/03/15/digital?utm_source=newsletter",
      "published_at": "15/03/2024",
      "engagement": "1,240"
    },
    {
      "source": "KOMPAS",
      "title": "Ekonomi Digital Tumbuh 12 Persen",
      "content": "Pertumbuhan ekonomi digital tercatat naik.",
      "url": "https://kompas.com/ekonomi/read/2024/03/15/digital",
      "published_at": "2024-03-15T08:30:00Z"
    }
  ]'
```

**Response — `200 OK`**

```json
{
  "received": 2,
  "accepted": 2,
  "rejected": 0,
  "inserted": 1,
  "duplicates": 1,
  "duplicate_breakdown": { "within_batch": 1, "already_stored": 0 },
  "errors": []
}
```

Both records describe the same article, so one row is written.

**Submitting the identical payload again:**

```json
{
  "received": 2, "accepted": 2, "rejected": 0,
  "inserted": 0, "duplicates": 2,
  "duplicate_breakdown": { "within_batch": 1, "already_stored": 1 },
  "errors": []
}
```

`inserted: 0` — no new rows.

**Field meanings**

| Field | Meaning |
| --- | --- |
| `received` | Records in the request body |
| `accepted` | Records that normalized successfully |
| `rejected` | Records that could not be normalized (see `errors`) |
| `inserted` | Rows actually written |
| `duplicates` | `within_batch` + `already_stored` |
| `duplicate_breakdown.within_batch` | Collapsed against another record in the *same* request |
| `duplicate_breakdown.already_stored` | Matched a row already in the table |
| `errors[]` | `{ index, reason }` — array index of each rejected record, capped at 50 |

`received == accepted + rejected` and `accepted == inserted + duplicates`
always hold, so every submitted record is accounted for.

**Why `200` and not `201`:** the endpoint is idempotent; a repeat submission
creates nothing, and `201 Created` would be a lie.

**Partial ingestion is deliberate.** One malformed record does not cost the
caller the other 999: valid records are stored, invalid ones are reported with
their index. Resubmitting the whole file afterwards is equally safe — that is
what idempotency buys.

**Rejection reasons** (a record is only rejected when it cannot be identified):
- `source is required and must contain at least one alphanumeric character`
- `record must contain a title or content`
- `Record must be a JSON object`

### `GET /mentions`

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `q` | string, 1–200 | — | Case-insensitive substring across `title` **and** `content` |
| `source` | string | — | Normalized before matching: `Kompas.com`, `kompas`, `KOMPAS` all work |
| `from` | date | — | Inclusive lower bound on `published_at` |
| `to` | date | — | Inclusive upper bound; a date-only value covers the **whole** day |
| `page` | int ≥ 1 | `1` | |
| `page_size` | int 1–100 | `20` | |

Unknown query parameters are rejected (`400`) rather than ignored, so a typo
like `?pagesize=50` fails loudly instead of silently returning defaults.

```bash
curl "localhost:3000/mentions?q=ekonomi&source=kompas&from=2024-03-14&to=2024-03-15&page=1&page_size=2"
```

```json
{
  "data": [
    {
      "id": 42,
      "source": "kompas",
      "source_raw": "Kompas.com",
      "title": "Ekonomi Digital Tumbuh 12 Persen",
      "content": "Pertumbuhan ekonomi digital tercatat naik.",
      "url": "https://kompas.com/ekonomi/read/2024/03/15/digital",
      "published_at": "2024-03-15T08:30:00.000Z",
      "author": "Rina Astuti",
      "engagement": 1240,
      "created_at": "2026-08-19T04:41:12.883Z"
    }
  ],
  "pagination": {
    "page": 1, "page_size": 2, "total": 3, "total_pages": 2,
    "has_next": true, "has_previous": false
  }
}
```

### `GET /mentions/stats`

`group_by` is **required**; anything other than `source` or `day` returns `400`.

```bash
curl "localhost:3000/mentions/stats?group_by=source"
```

```json
{
  "group_by": "source",
  "data": [
    { "group": "kompas", "label": "Kompas.com", "count": 3 },
    { "group": "detik",  "label": "Detik",      "count": 2 },
    { "group": "tempo",  "label": "Tempo.co",   "count": 1 }
  ]
}
```

`group` is the normalized key used for filtering (feed it straight back to
`GET /mentions?source=`); `label` is `MIN(source_raw)` — a deterministic,
human-readable representative of the raw spellings that folded into that key,
so a dashboard can show "Kompas.com" rather than the bare key. Ordered by count
descending, then key ascending, for a stable result.

```bash
curl "localhost:3000/mentions/stats?group_by=day"
```

```json
{
  "group_by": "day",
  "data": [
    { "group": "2024-03-14", "count": 2 },
    { "group": "2024-03-15", "count": 2 }
  ],
  "missing_published_at": 2
}
```

**Missing dates:** mentions without a parsable publication date cannot belong to
any day, so they are **never** folded into a bucket. They are reported in the
separate `missing_published_at` counter, which is present only for
`group_by=day`. `sum(data[].count) + missing_published_at` equals the table
total, so a chart that ignores the counter will visibly fail to reconcile —
which is the intended pressure.

---

## Design

### Database schema

`migrations/001_create_mentions.sql` — one table.

| Column | Type | Why |
| --- | --- | --- |
| `id` | `bigint` identity PK | Monotonic; also the tiebreaker that makes sorting total |
| `fingerprint` | `bytea` (32 B) | SHA-256 duplicate key. Raw bytes, not 64 hex chars |
| `source` | `text NOT NULL` | Normalized key — filtered and grouped on |
| `source_raw` | `text NOT NULL` | Original spelling: keeps normalization mistakes diagnosable |
| `title` | `text` | Plain text |
| `content` | `text` | Plain text, HTML stripped |
| `url` | `text` | Canonical form |
| `url_raw` | `text` | Original |
| `published_at` | `timestamptz` | UTC. `NULL` when absent — never invented |
| `published_at_raw` | `text` | Kept **only** when the value failed to parse |
| `author` | `text` | |
| `engagement` | `integer` | Numeric strings converted; `NULL` when not a clean number |
| `raw` | `jsonb NOT NULL` | The untouched input record |
| `created_at` | `timestamptz NOT NULL` | Ingestion time |

Types are deliberate: timestamps are `timestamptz`, counts are `integer`,
nothing that has a real type is stored as `text`. Three `CHECK` constraints
guard invariants the application also enforces (fingerprint length, non-blank
source, non-negative engagement) — the database is the last line of defence,
not a dumb store.

**Why `raw jsonb`:** it is the reason an unknown upstream field is never lost,
and it removes the need for a separate `content_html` column — the original
markup is already in there. The cost is storage roughly doubling; at this scale
that is a good trade, and at large scale it is the first thing to move to cold
storage.

**Why one table:** the queries are single-entity. A `sources` table would add a
join to every read to buy referential tidiness the dataset does not need. If
sources ever gained attributes (tier, country, media type), that changes.

### Duplicate detection

The brief leaves this open. Here is the rule, and its cost.

**A duplicate is: the same logical mention.** Concretely, a two-tier
fingerprint — SHA-256 over `0x1F`-separated parts, versioned with a `v1` tag:

**Tier 1 — a canonical URL exists** (`url` strategy):

```
sha256("v1" ␟ "url" ␟ <canonical URL, scheme removed>)
```

**Tier 2 — no usable URL** (`content` strategy, typical of social posts):

```
sha256("v1" ␟ "content" ␟ <normalized source> ␟ <title comparison form> ␟ <first 500 chars of content comparison form>)
```

Comparison form = lowercased, non-alphanumerics collapsed to single spaces.
Applied **only** to the fingerprint — stored text keeps its original casing and
punctuation.

**Why these fields**

- **URL is the strongest identity available.** It is a publisher-assigned
  identifier for exactly one document. It keeps working when the same article
  arrives under inconsistent source names or a re-edited headline — both of
  which the brief promises are in the data.
- **Source is deliberately *excluded* from tier 1.** Two records pointing at the
  same URL are the same article even if one says `Kompas.com` and the other
  `KOMPAS`. Including source would make deduplication depend on source
  normalization being perfect; excluding it makes tier 1 robust to exactly the
  messiness that is guaranteed to be present.
- **Source is deliberately *included* in tier 2.** Without a URL, two outlets
  covering one event with a similar headline are genuinely different mentions.
- **`published_at` is excluded from both.** It is the least reliable field in
  the dataset — multiple formats, some missing, and syndicated copies routinely
  carry different timestamps for the same article. Including it would defeat
  deduplication precisely where it matters most.
- **Only the first 500 characters of content participate.** Trailing
  boilerplate — "Read more", share counters, syndication footers — is the part
  that varies between copies; the opening is stable.

**False positives** (distinct mentions wrongly merged)

1. A URL that is genuinely reused for different content — a live blog or a
   `/latest` landing page that is rewritten in place. Tier 1 sees one mention.
2. Under tier 2, one account posting the same text twice (a scheduled repost)
   collapses into one row. Arguably correct, but it *is* a merge.
3. Two articles from one source with an identical title and a shared 500-char
   opening — a wire story republished under two slugs with no URL.

**False negatives** (one mention stored twice)

1. **The main one:** the same article arriving once with a URL and once without.
   The two tiers produce different keys and cannot match. Ranking a content key
   *below* a URL key would need a second lookup and reintroduce the
   read-then-write race the brief warns against, so it is accepted and
   documented.
2. Syndication under different URLs (`kompas.com/x` vs `amp.kompas.com/x`) —
   different documents by this rule.
3. A source correcting a typo in the first 500 characters of a URL-less post.
4. Tracking parameters not in the strip-list.

**Why this is right for the assessment:** it is deterministic, computable
without touching the database, expressible as a single `UNIQUE` index, and it
errs toward *under*-merging. Wrongly keeping two rows is a visible, fixable
annoyance; wrongly merging two mentions silently destroys data an analyst will
never know was there.

**How idempotency is guaranteed**

```sql
INSERT INTO mentions (...) VALUES (...), (...)
ON CONFLICT (fingerprint) DO NOTHING
RETURNING id
```

`RETURNING` yields only rows that were actually written, so `inserted` is
exact. The `UNIQUE` index adjudicates inside one atomic statement — two
concurrent requests carrying the same record cannot both win. There is **no**
`SELECT`-then-`INSERT` anywhere in the codebase.

Duplicates *within a single batch* are collapsed in the service before the
insert. This is **not** the idempotency mechanism — it exists because one
`INSERT … ON CONFLICT` statement cannot resolve two rows that conflict with
*each other* (conflict detection runs against already-visible rows, not the
statement's own pending tuples). First occurrence wins.

Batches over 500 rows span several statements and run inside one transaction,
so a failure part-way cannot leave a partial write that makes the reported
counts wrong.

**In production this rule would change.** A `sources` table with curated
aliases; a `canonical_url` supplied by the crawler (which knows about AMP and
redirects); near-duplicate detection via SimHash/MinHash over content shingles
for syndicated wire copy; and a `mention_group_id` so near-duplicates are
*linked* rather than *collapsed* — analysts usually want "this story ran in 14
outlets", not one row.

### Normalization

Deterministic, pure, and separated from HTTP entirely (`src/features/mentions/normalization/`).

**Source** (`source.ts`) — trim and collapse whitespace → drop URL scheme and
leading `www.` → if it looks like a bare domain, keep the label before the first
dot → lowercase → remove every non-alphanumeric character.

```
"The Jakarta Post" · "the jakarta post" · "  THE   JAKARTA POST  "
"thejakartapost.com" · "www.thejakartapost.com" · "https://www.thejakartapost.com/news"
                            → all fold to  "thejakartapost"
```

The last step only ever *removes separators*, so two genuinely different names
can never be folded together — the brief's "do not accidentally merge genuinely
different sources" is satisfied structurally, not by luck. The cost is the
opposite error: `NY Times` and `New York Times` stay distinct. The production
fix is a curated alias table, not fuzzier matching — fuzzy matching on source
names is how you silently merge two real outlets.

**Dates** (`date.ts`) — an ordered list of explicit matchers:

| Format | Example |
| --- | --- |
| ISO 8601, with/without offset, with/without ms | `2024-03-15T08:30:00Z`, `2024-03-15T15:30:00+07:00` |
| Space-separated timestamp | `2024-03-15 08:30:00` |
| Date only | `2024-03-15` |
| Year-first slash | `2024/03/15` |
| Day/month slash, `.` and `-` separators | `15/03/2024` |
| Day + month name | `15 March 2024` |
| Month name + day | `March 15, 2024` |
| RFC 2822 | `Fri, 15 Mar 2024 08:30:00 GMT` |
| Unix epoch, seconds or ms, number or string | `1710491400` |

It never falls through to `new Date(string)` for non-standard input — that is
implementation-defined outside ISO 8601 and RFC 2822 and would make
normalization non-deterministic across runtimes. `Date.parse` is used *only*
for RFC 2822, where it is specified.

Everything is stored as `timestamptz` in **UTC**. Naive values are interpreted
as UTC; date-only values become midnight UTC. Values outside 1990–2100 and
impossible dates like `2024-02-31` are treated as corrupt, not parsed.

**Unparsable or missing → `published_at = NULL`.** No date is ever invented. An
unparsable string is retained in `published_at_raw` (a genuinely absent one is
not — there is nothing to keep), so unsupported formats can be found later with
`SELECT DISTINCT published_at_raw FROM mentions WHERE published_at IS NULL`.

**HTML** (`text.ts`) — `<script>`/`<style>`/`<noscript>`/`<template>` contents
are dropped entirely; block-level tags become a space so `<p>a</p><p>b</p>`
yields `a b` and not `ab`; comments and remaining tags are removed; named and
numeric entities are decoded; whitespace is collapsed. Empty results (`""`,
`"   "`, `"<p></p>"`) all become `NULL`.

This is a focused regex pipeline, not an HTML parser dependency: the inputs are
short article bodies and the transformation must stay deterministic and
dependency-light. A real parser would be the right call if the content ever
needed structural fidelity.

**Numbers** (`number.ts`) — only a value that is *entirely* numeric is
converted. `"1234"` → `1234`, `"1,234"` → `1234` (grouped thousands are
formatting, not a different value). `"1.2k"`, `"about 500"`, `"12.5"`, `"-5"`,
`""` → `NULL`. **Never `0`** — "unknown" must stay distinguishable from
"measured zero".

**Text** — whitespace is collapsed and markup removed, but casing, punctuation
and accents inside `title`/`content` are left untouched. Over-normalizing
display text destroys meaning; `Rp1.000.000 "deal" — SIGNED!` survives intact.

### Search behavior

**Case-insensitive substring match via `ILIKE '%q%'` across `title` and
`content`.** Deliberately not full-text search.

FTS would bring stemming and ranking, but also a language configuration
decision. The seed data is mixed Indonesian/English; PostgreSQL has no
Indonesian stemmer, so `to_tsvector('simple', …)` would reduce to whitespace
tokenisation *without* substring matching — strictly worse than `ILIKE` for an
analyst typing a partial brand name. That is a real argument, not a shortcut.

The cost is honest: `ILIKE '%…%'` cannot use a B-tree, so it is a sequential
scan. Measured on this schema at 200 000 rows: **~54 ms** (parallel seq scan).
Fine for this dataset; not fine at 10 million rows.

LIKE metacharacters in `q` are escaped, so searching for `%` finds a literal
percent sign rather than matching everything. The value is a bound parameter
regardless — the escaping fixes *meaning*, not safety.

### Pagination and sorting

**`page` / `page_size` offset pagination**, `page_size` capped at 100.

Chosen over cursor pagination because analysts jump to arbitrary pages and
expect a total count — `total` and `total_pages` are exactly what a cursor
cannot cheaply give you. The trade-off is real and accepted: `OFFSET n` makes
PostgreSQL walk and discard `n` rows, so deep pages degrade linearly, and a row
inserted mid-browse shifts everything by one. At this scale, with a capped page
size, neither bites. Past ~100 000 rows or with a "load more" UI, keyset
pagination on `(published_at, id)` is the answer — and the existing index
already supports it.

**Stable sort order:**

```sql
ORDER BY published_at DESC NULLS LAST, id DESC
```

- `published_at DESC` — newest first, what a monitoring dashboard wants.
- `NULLS LAST` is **explicit and necessary**: PostgreSQL's default for `DESC`
  is `NULLS FIRST`, which would put every undated mention on page 1.
- `id DESC` is a **total** tiebreaker. Without it, mentions sharing a timestamp
  (common — many sources publish on the minute, and *all* undated rows tie)
  would have an undefined relative order, and offset pagination could show the
  same row twice or skip one. `id` is a monotonic identity column, so exactly
  one correct order always exists. A test walks all pages and asserts every row
  appears exactly once.

### Indexing decisions

Four indexes. Each is justified by a query that exists, and each was verified
with `EXPLAIN (ANALYZE, BUFFERS)` against **200 000 rows** — not assumed.

| Index | Serves | Measured |
| --- | --- | --- |
| `mentions_pkey (id)` | Identity | — |
| `mentions_fingerprint_key` UNIQUE `(fingerprint)` | **Idempotency**, and backs `ON CONFLICT` | Correctness, not speed |
| `mentions_published_at_id_idx (published_at DESC NULLS LAST, id DESC)` | Default listing order, `from`/`to` filters, `group_by=day` | Index-only scan, 23 buffers, **0.035 ms** for page 1 |
| `mentions_source_published_at_idx (source, published_at DESC NULLS LAST)` | `?source=`, and as a prefix `group_by=source` | **0.77 ms** for one source's first page |

The column order in the composite index matches the `ORDER BY` exactly —
including `NULLS LAST`. Had it been declared without it, PostgreSQL could not
use the index for the API's ordering and would sort every time.

**Deliberately not indexed:**

- **`title` / `content`.** No B-tree can serve `ILIKE '%q%'`. A `pg_trgm` GIN
  index would, at the cost of an extension, a large index and slower writes. At
  this size a ~54 ms scan is the better trade. Documented rather than
  pre-emptively added — that is the point of the brief's "do not create indexes
  because they sound useful".
- **`created_at`.** Nothing queries it.
- **`url`.** Lookups go through `fingerprint`.

`GROUP BY source` at 200 000 rows runs a parallel aggregate in ~40 ms without a
dedicated index — adding one is not yet justified.

---

## Error handling

One handler (`src/utils/error-handler.ts`) turns every thrown value into the
same envelope.

| Situation | Status | `code` |
| --- | --- | --- |
| Malformed JSON | 400 | `INVALID_JSON` |
| Empty body | 400 | `EMPTY_BODY` |
| Body fails validation | 400 | `VALIDATION_ERROR` |
| Invalid query params (incl. bad dates, pagination, unknown params) | 400 | `INVALID_QUERY_PARAMETERS` |
| Unsupported/missing `group_by` | 400 | `INVALID_QUERY_PARAMETERS` |
| Unknown route | 404 | `NOT_FOUND` |
| Wrong `Content-Type` | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| Body over 16 MiB | 413 | `PAYLOAD_TOO_LARGE` |
| Database or unexpected error | 500 | `INTERNAL_SERVER_ERROR` |

`400`s carry a `details` array of `{ path, message }` pinpointing each failure.
`500`s carry nothing beyond a generic message: the real error is logged
server-side. **No SQL, connection string, credential or stack trace ever reaches
a consumer** — asserted by tests that grep responses for those patterns.

Fastify's own errors are matched on their specific error codes (verified
empirically against Fastify 5), never on a bare `statusCode === 400`, which
would mislabel unrelated failures as JSON syntax errors.

**Security:** every external input is validated by Zod before use; every SQL
value is a bound parameter (only `$n` placeholder *text* is ever generated —
values always travel separately); secrets live only in the environment; `.env`
is gitignored.

---

## Assumptions

Where the brief was open, a decision was made and recorded here.

1. **`seed_mentions.json` was unavailable.** See the note at the top — the
   single most important assumption in this document. Everything below marked
   ⚠️ should be re-checked with `npm run inspect:seed` once the file is present.
2. ⚠️ **Ambiguous slash dates are read day-first.** `04/03/2024` → 4 March. A
   component above 12 disambiguates automatically (`25/03/2024` and `03/25/2024`
   both → 25 March), so this only applies when both halves are ≤ 12. It is
   isolated as a single named constant, `AMBIGUOUS_SLASH_DATE_ORDER`, so
   flipping it is a one-line change. **This is the riskiest assumption here.**
3. **All timestamps are UTC.** Naive values are read as UTC rather than guessing
   a publisher's local timezone; date-only values become midnight UTC;
   `group_by=day` buckets by UTC calendar day. For an Indonesian-focused
   product WIB (UTC+7) may be the better display timezone — that is a
   presentation decision, and storing UTC keeps it open.
4. **A record with no identifiable source is rejected**, not filed under
   "unknown" — inventing a source would corrupt the source statistics that are
   a required endpoint.
5. **A record with neither title nor content is rejected.** It carries no
   mention text, and under the content fingerprint every such record would be
   indistinguishable from every other.
6. **Partial ingestion over strict rejection.** One bad record does not fail the
   batch; rejected records are reported by index.
7. ⚠️ **Field aliases.** `source`/`source_name`/`sourceName`/`publisher`,
   `title`/`headline`, `content`/`body`/`text`/`description`,
   `url`/`link`/`permalink`,
   `published_at`/`publishedAt`/`published_date`/`date`/`created_at`,
   `engagement`/`engagement_count`/`reach`/`views`. Unknown fields are preserved
   in `raw`, so an unrecognised name costs a column, never the data.
8. **`to` with a date-only value covers the whole day.** `to=2024-03-15`
   includes mentions published at 23:59 on the 15th — the reading a human
   expects from an inclusive bound.
9. **Undated mentions are excluded from `from`/`to` filtering.** A row with no
   date cannot satisfy a range. They still appear in unfiltered listings (last,
   via `NULLS LAST`) and in `missing_published_at`.
10. **Unknown query parameters are rejected**, so typos fail loudly.
11. **`engagement` is a single integer.** The brief guarantees numeric strings
    exist but does not name the field; any additional metrics survive in `raw`.
    ⚠️ Worth revisiting against the real seed.
12. **Records sharing a `published_at` are ordered by `id DESC`** — insertion
    order, newest ingested first.
13. **`POST /internal/mentions/bulk` is unauthenticated**, per the brief's
    explicit "do not build authentication". The `/internal/` prefix signals it
    belongs behind a network boundary, not on the public edge.

## Trade-offs

| Decision | Chosen | Alternative | Why |
| --- | --- | --- | --- |
| Search | `ILIKE '%q%'` | PostgreSQL FTS | No Indonesian stemmer; substring beats tokenisation for partial brand names. ~54 ms @ 200k |
| Pagination | Offset | Keyset/cursor | Analysts need `total` and page jumps; capped page size bounds the cost |
| Duplicate key | Two-tier URL/content | Single combined fingerprint | URL alone is robust to inconsistent source names; combining every field would under-merge badly |
| Storage | Normalized **and** `raw jsonb` | Normalized only | Unknown fields survive; ~2× storage accepted |
| Bad records | Partial ingestion | Reject whole batch | One bad row should not cost 999 good ones |
| Migrations | ~40-line runner | A migration library | Keeps the SQL the single reviewable source of truth |
| Source normalization | Deterministic separator-stripping | Curated alias table | Structurally cannot merge different outlets; misses `NY Times` ≡ `New York Times` |
| Schema | One table | `sources` + `mentions` | Queries are single-entity; a join buys nothing yet |
| Tests | Real PostgreSQL | Mocked repository | The behaviour under test *is* PostgreSQL behaviour |
| Fingerprint | SHA-256 (32 B) | 64-char hex, or a natural key | Fixed width, collision-free in practice, indexes compactly |

**What changes at scale:** keyset pagination past ~100k rows; `pg_trgm` or a
dedicated search engine past ~1M; monthly partitioning of `mentions` by
`published_at`; `raw` moved to cold storage; and ingestion behind a queue once
batches stop fitting in one request — none of which is warranted here, and all
of which would have been over-engineering.

---

## Dashboard

Optional per the brief (§8/§10 of the PRD: "opsional ... tidak dinilai"), so it
was built **last**, only after every backend deliverable was complete and
verified. It is a single read-only page.

```bash
cd dashboard
npm install
cp .env.example .env          # API_BASE_URL=http://localhost:3000
npm run dev                   # http://localhost:3001
```

The backend must be running first.

**It is server-rendered.** Every fetch happens in the Next.js server, never in
the browser, which means the backend needed **no CORS configuration** and no API
URL is exposed to the client. Filter and page state lives entirely in the URL
query string, so the whole page is a plain `GET` form and a couple of links —
no client-side data fetching, no state library.

It shows total mentions, mentions matching the current filters, distinct source
count, an undated-mentions counter, keyword/source/date-range filters, bar
charts for both stats groupings, and a paginated table.

**All data comes from the live API** — `GET /mentions`,
`GET /mentions/stats?group_by=source`, `GET /mentions/stats?group_by=day`. There
is no mock data anywhere; if the backend is unreachable the page says so rather
than rendering placeholder numbers. Undated mentions render as "No date" and are
excluded from the daily chart, with a footnote explaining why — the UI reflects
the same missing-date policy as the API.

Styling is neo-brutalist (hard black borders, flat surfaces, hard-offset
shadows, bold uppercase type, two accent colours) in plain CSS — no UI library,
no CSS framework. Charts are `div`s with widths rather than a charting
dependency.

## Effort

- **Roughly 6 hours.**
- **Across 2 sessions.**

> Please adjust these two numbers before submitting — they reflect the assisted
> build in this working copy, not necessarily your own accounting.

## With another week, I would...

1. **Validate every decision against the real `seed_mentions.json`** — run
   `inspect:seed`, fix the date formats it rejects, and check that no source
   folding is wrong. This is first because it is the step the brief asks for
   that could not be done here.
2. **Add a `sources` table with curated aliases**, so `NY Times` and
   `New York Times` resolve to one outlet and each source carries tier, country
   and media type. This is the single biggest accuracy win.
3. **Link near-duplicates instead of collapsing them.** SimHash over content
   shingles plus a `mention_group_id`, so an analyst sees "this story ran in 14
   outlets" — currently the most valuable thing the data cannot express.
4. **Move to keyset pagination** on `(published_at, id)` and expose a cursor
   alongside the existing page parameters.
5. **Benchmark `pg_trgm` GIN against the current `ILIKE`** on realistic volume
   and switch if the write cost is acceptable.
6. **Add `group_by=week|month|author`** and a `from`/`to` filter on the stats
   endpoint — currently stats always cover the whole table.
7. **Property-based tests for the date parser** (fast-check), generating
   timestamps across formats and asserting round-trip stability. The current
   table-driven tests only cover formats I anticipated.
8. **Structured ingestion telemetry** — per-source rejection rates and
   unparsable-date counts, so upstream feed regressions surface as a metric
   rather than as an analyst noticing a gap.
9. **A load test on the bulk endpoint** to establish where batch size should be
   capped, replacing the currently arbitrary 50 000 / 16 MiB limits.
10. **OpenAPI generated from the Zod schemas**, so the docs cannot drift.
