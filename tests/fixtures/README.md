# Test fixtures

`messy-mentions.json` is a **test fixture written for this repository**. It is
*not* the assessment's `seed_mentions.json` and does not claim to be.

It exists because the real seed file was not available while the service was
built (see "Assumptions" in the root README). Each record reproduces one of the
messiness categories the brief enumerates in §7 -- repeated articles,
inconsistent source naming, several date formats, missing dates, raw HTML, and
numbers stored as strings -- so the normalization and duplicate rules are
exercised against every category the brief promises.

When the real `seed_mentions.json` is added to the project root,
`npm run inspect:seed` profiles it and the ingestion tests can be pointed at it
to confirm the same guarantees hold on the real data.
