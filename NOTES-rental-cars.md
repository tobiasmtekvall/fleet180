# Expenses → Rental cars, 2026-09-16

Project memory was unreachable from the session that built this, so the note
lives here. Move it into project memory when convenient.

## Shape

A fourth **scope** beside Vehicles / Tools / Misc, not a category inside
Vehicles: a hire car's registration is not one of our 22 vans, so the Vehicles
section's plate dropdown could not hold it, and a hire has a firm, a period and
an agreement that a repair does not.

New columns on `incidents`: `rental_firm`, `rented_to`, `for_plate`.
New column on `incident_files`: `taken_at`.
Plain `ADD COLUMN IF NOT EXISTS` inside SCHEMA — no migration needed, existing
rows already carry `scope='vehicle'`.

**On a rental row `plate` is the HIRE CAR's registration** (free text,
normalised the same way as ours) and `for_plate` is the van of ours it stands
in for, optional. Nothing in the app joins `incidents` to `vehicles`, and every
`incidents` query that means "our vans" is already scoped to `scope='vehicle'`
(`incidentCounts`), so a rental row corrupts nothing. **If anyone ever adds a
per-van cost roll-up, note that a naive `SUM(cost_sek) GROUP BY plate` would
book a hire against the hire car and show nothing against the van it covered.**

## The four firms

`RENTAL_FIRM_LABEL` in `views/incidents.js`, fixed on Tobias's instruction:
OKQ8 Jordbron, OKQ8 Vårstarondellen, Circle K Österängen, Skeppsbrons. The
**key** is stored, so a name can be reworded without touching a row, and a new
firm is one line. The server validates against the same list.

## Dates, and "still out"

`occurred_on` is the pick-up, `rented_to` the hand-back; the Days column counts
both ends like the workshop days. Leave the return empty while the car is out.
**A return date in the future is a booking, not a hand-back** — the line and the
section header both treat it as still out (`totals.outNow` uses `>` today, so a
car handed back this morning is back). Those two disagreed in the first cut.

## Photo timestamps (`src/exif.js`, new)

Reads DateTimeOriginal + OffsetTimeOriginal out of an uploaded JPEG, so a
hand-back photo uploaded the next morning still dates itself to the hand-back.
Hand-rolled (no dependency), ~150 lines, and it **cannot throw or hang** — a
review agent fuzzed it with 300k adversarial buffers. Null is a truthful answer
and the usual one; the chip then says "Uploaded" instead of "Taken", and the
two are styled differently on purpose: one is evidence, the other is not.

- No time zone in the file → Swedish local, CET/CEST worked out per date.
- A rolled-over impossible date (2026:02:30) is rejected, not shown as evidence.
- 0xFF padding before a marker is skipped (some encoders write it).
- **JPEG only.** HEIC/HEIF/PNG/WebP fall back to the upload time. iOS normally
  transcodes to JPEG for `accept="image/*"`, but that is the first thing to
  check if a photo shows "Uploaded" when it should not.

## Two silent-loss traps the review caught

1. `forSelect` blanked `for_plate` when that van had left the fleet — the select
   showed the placeholder and the next Save posted ''. It now keeps the value as
   its own option, labelled "(not in the fleet)".
2. A file over 12 MB (or a 25th file) threw away **the whole edit** with a
   Swedish 500 page. The incident routes now use `softUpload`: the row saves and
   the message says which file did not fit. `/v/:plate` is unchanged — there a
   failed upload IS the submission.

## Tested

`tests/rental.test.js` (node only) plus a full run against a real local
Postgres: posting a hire with an agreement and two photos, editing it, the SM
sign-off and its reset on a cost change, the CSV, the validation refusals, the
oversized upload, and three boots on the same database.

Not committed or deployed as of 2026-09-16 — the working tree carries it.
