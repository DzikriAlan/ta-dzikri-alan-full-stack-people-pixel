CREATE TABLE mentions (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    fingerprint       bytea       NOT NULL,

    source            text        NOT NULL,
    source_raw        text        NOT NULL,

    title             text,

    content           text,

    url               text,
    url_raw           text,

    published_at      timestamptz,
    published_at_raw  text,

    author            text,

    engagement        integer,

    raw               jsonb       NOT NULL,

    created_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT mentions_fingerprint_length CHECK (octet_length(fingerprint) = 32),
    CONSTRAINT mentions_source_not_blank   CHECK (length(btrim(source)) > 0),
    CONSTRAINT mentions_engagement_natural CHECK (engagement IS NULL OR engagement >= 0)
);

CREATE UNIQUE INDEX mentions_fingerprint_key
    ON mentions (fingerprint);

CREATE INDEX mentions_published_at_id_idx
    ON mentions (published_at DESC NULLS LAST, id DESC);

CREATE INDEX mentions_source_published_at_idx
    ON mentions (source, published_at DESC NULLS LAST);
