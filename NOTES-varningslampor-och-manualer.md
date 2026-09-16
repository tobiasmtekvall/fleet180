# Varningslampor och instruktionsböcker, 2026-09-16

Project memory was unreachable from the session that made this change, so the
note lives here instead. Move it into the project memory when convenient.

## The fleet, from the register

Every plate was looked up on biluppgifter.se / car.info — nothing here is
inferred from the fleet's shape.

| Model key | Vans | Register wording |
|---|---|---|
| `iveco-daily` | 12 | RBE26H, RPH54L, DHN13H, GJR88K, ODJ63H (2021), ELZ35L, SSB55B (2022), HJA34R (2024), BBR00N, WAT90D (2025), TTJ00A (2023), RAH84S (2024) |
| `toyota-proace-max` | 3 | RBE87T, XWA50L, BPM38R — 2.2 D4D 180, 2026 |
| `mb-vito` | 4 | MER05W, BZU92Z, RLX94A (2026), DTE97W (2025) |
| `mb-sprinter` | 1 | ODW03R — 315 CDI RWD, 2026 |
| `citroen-jumpy` | 1 | CDK93M — 2.0 BlueHDi, 2023 |
| `peugeot-expert` | 1 | WBH37M — 2.0 BlueHDi, 2024 |

**RLX94L never existed.** No register has it; the van is **RLX94A**. Corrected
in the seed, in `calendar/fleet-model.js`, and in the live tables by the
`seed-2026-09-16-fleet-models` migration, which renames the plate in vehicles,
submissions, assignments and incidents — each table asked for itself, because
fixing a plate by hand in /admin renames the vehicles row alone and would
otherwise strand the history. The calendar's checkpoint history is JSONB keyed
by plate, so whatever was recorded under the old key stays there.

Still wrong in `calendar/fleet-model.js`, pre-existing: it lists **ESJ01Y**
(that van is gone) and is missing **TTJ00A** and **RAH84S**.

## The lists (src/telltales.js)

Six real models plus `generic`; 66 lamps in the catalogue, 50 drawn icons.
IVECO 43, Toyota 46, Sprinter 37, Vito 37, Expert 30, Jumpy 27.

Each list was transcribed from that model's own Swedish manual:

- IVECO: "Förarplats", table VARNINGSLAMPOR placering 1–29 plus the display
  ideograms — the 23 photographed pages in `downloads/IMG_2026*.jpg` (pp. 113–129).
- Sprinter F907 0082 09 pp. 790–802 + display messages 753–783.
- Vito F447 0099 09 pp. 785–798 + 753–778.
- Toyota PZ49X-MAX24-SV V5 ch. 3.4: lamp table 119–126, display symbols 127–136.
- Jumpy eGuide jumpy3vp sv-SE pp. 11–22; Expert eGuide expert3vp sv-SE pp. 12–17.
  The chapter is NOT at pp. 48–66 in either, whatever the contents page says.

Left out on purpose: green and blue "system is on" lamps, comfort-electronics
faults (rain/dusk sensor, keyless, traffic-sign recognition, blind spot), and
every electric-van lamp in the Toyota and Peugeot books — this fleet is diesel.
`turtle` and `hvBattery` are therefore unused but kept.

Two rules worth keeping:

- **Two lamps in one list must not share a drawn symbol.** `retarder`, `pto`
  and `clutch` were drawn for exactly that reason. The pairs that do share one
  (brake/brakeFault, abs/ebd, tyre/tyreFault, glow/glowFault, the three
  `message` ones) share it because the real dashboards do.
- **A lamp name carries no colour.** `brakeFault` was "Fel i bromssystemet
  (gul)" and is red on the IVECO, so the word went; the button is already drawn
  in the right colour.

## The manual on every vehicle page

`MODELS[key].manual = {file, title, pages, full}`, resolved by
`telltales.manualFor(key, vehicles.manual_file)` and drawn by `manualPanel()`
in `views/form.js`, under the assignment line on `/v/<PLATE>`. Six PDFs in
`public/manualer/`, 30 MB in total:

- `iveco-daily-varningslampor.pdf` — the 23 photographed pages.
- `mb-sprinter-907-varningslampor.pdf`, `mb-vito-447-varningslampor.pdf` — the
  chapter cut out of Mercedes's own Swedish PDFs
  (`static.oneweb.mercedes-benz.com/css-oom-assets/sv-se/pdf/mercedes-benz-vans-<model>-<year>-maj-<c447|c907>-mbux-instruktionsbok-1.pdf`).
- `toyota-proace-max-varningslampor.pdf` — pp. 118–137 of PZ49X-MAX24-SV.
- `citroen-jumpy-instruktionsbok.pdf`, `peugeot-expert-instruktionsbok.pdf` —
  the whole books, from Stellantis's own CDN
  (`service.citroen.com/ACddb/…/9999_9999_268_sv-SE.pdf`,
  `public.servicebox.peugeot.com/APddb/…/9999_9999_328_sv-SE.pdf`).

Why extracts rather than whole books everywhere: the full Mercedes and Toyota
manuals are 52–68 MB each — a minute of 4G at the van and 250 MB in the repo.
Where the whole book is small, it is the whole book; `full` links the maker's
site for the rest. These are the manufacturers' own freely downloadable PDFs,
re-served internally; nothing came from a manual pirate site and nothing should.

A van can override its file: `vehicles.manual_file`, a box on Admin → Fordon,
validated to `/^[A-Za-z0-9._-]+\.pdf$/` so it cannot become a path or a URL.
Nothing checks that the file exists — a typo renders a link that 404s.

## The bug this uncovered

`formatAnswer` printed the **stored code** for a picked follow-up item wherever
the receipt's own `pickText` was not involved: the daily mail, the admin check
detail, `/admin/export.csv`, `/api/checks` (so the extension's FLEET180 tab)
and the description copied into an incident all read "Ja: brakeAssistOff".
Fixed by `fields.pickName()` — the question's own snapshot first,
`telltales.LAMPS` as the fallback, the raw value last. It predates this change
but only bit once every van had a model and the codes stopped being guessable.

## Tests

`tests/lights.test.js`, node only, no database: the shape of every list, that
the PDFs exist and are PDFs, that each model's page draws its own symbols and
links its own book, that the Sprinter and the Vito do not get each other's
list, and that a stored code reads back as a name in every reader.
