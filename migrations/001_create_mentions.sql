-- Mentions ingested from external media sources.
--
-- Design notes (expanded in README.md):
--   * `fingerprint` is the duplicate-detection key. UNIQUE on it is what makes
--     POST /internal/mentions/bulk idempotent under retries and concurrency --
--     the guarantee lives in the database, not in application logic.
--   * Normalized columns hold the values the API queries; the untouched input
--     record is kept in `raw` so no field is ever lost to normalization.
--   * `published_at` is nullable on purpose: a missing publication date is
--     recorded as NULL and never invented.

CREATE TABLE mentions (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- sha256 of the canonical identity string, stored as raw bytes (32B)
    -- rather than 64 hex characters.
    fingerprint       bytea       NOT NULL,

    -- Normalized grouping/filter key, e.g. "kompas". `source_raw` keeps the
    -- string exactly as received so a normalization mistake stays diagnosable.
    source            text        NOT NULL,
    source_raw        text        NOT NULL,

    title             text,

    -- Plain text: HTML tags stripped and entities decoded. The original markup
    -- survives inside `raw`, so no separate content_html column is justified.
    content           text,

    -- Canonical URL (tracking parameters removed, host lowercased).
    url               text,
    url_raw           text,

    -- Always UTC. NULL when the source supplied no parsable publication date.
    published_at      timestamptz,
    -- The original date string, kept only when it could not be parsed, so that
    -- unparsable formats can be found and supported later.
    published_at_raw  text,

    author            text,

    -- Numeric strings are converted here; non-numeric values stay NULL rather
    -- than being coerced to 0.
    engagement        integer,

    raw               jsonb       NOT NULL,

    created_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT mentions_fingerprint_length CHECK (octet_length(fingerprint) = 32),
    CONSTRAINT mentions_source_not_blank   CHECK (length(btrim(source)) > 0),
    CONSTRAINT mentions_engagement_natural CHECK (engagement IS NULL OR engagement >= 0)
);

-- Idempotency guarantee. Also the index backing the ON CONFLICT clause used by
-- the bulk upsert.
CREATE UNIQUE INDEX mentions_fingerprint_key
    ON mentions (fingerprint);

-- Serves the default listing order and GET /mentions?from=&to=, and lets
-- group_by=day aggregate without a full sort. NULLS LAST matches the ORDER BY
-- the API issues -- without it PostgreSQL would sort NULLs first on DESC and
-- could not use this index.
CREATE INDEX mentions_published_at_id_idx
    ON mentions (published_at DESC NULLS LAST, id DESC);

-- Serves ?source=<key> on its own and, as a prefix, GET /mentions/stats
-- ?group_by=source. The trailing published_at column covers the common
-- "one source over a date range" query without a second index.
CREATE INDEX mentions_source_published_at_idx
    ON mentions (source, published_at DESC NULLS LAST);

-- Deliberately NOT indexed: `title` and `content`. Keyword search uses ILIKE
-- '%q%', which no B-tree can serve. At this dataset size a sequential scan is
-- the correct trade-off; README documents the pg_trgm / tsvector migration
-- that would replace it once the table grows.
