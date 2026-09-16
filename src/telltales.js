'use strict';

/**
 * Dashboard telltales: the symbols, and which vans have which.
 *
 * A driver standing at a van at half past five sees a symbol, not a sentence.
 * So the question "is a warning light on?" is answered by picking the symbol
 * off a list that belongs to THAT vehicle — an IVECO Daily does not have the
 * Sprinter's tachograph lamp, and a Sprinter does not have the Daily's air
 * suspension lamp. What is stored is a code, and the Swedish name is what the
 * workshop reads.
 *
 * Where the lists come from — every one read out of that model's own Swedish
 * manual, never from a general list of car symbols (rebuilt 2026-09-16, after
 * the registry told us what the fleet actually is):
 *  - IVECO Daily (12 vans): instruktionsboken, "Förarplats", table
 *    VARNINGSLAMPOR placering 1–29 (pages 113–122) plus the display
 *    ideograms (123–129). Photographed pages.
 *  - Mercedes-Benz Sprinter 907 (1): instruktionsbok F907 0082 09,
 *    "Varnings- och kontrollampor" 790–802 and the display messages 753–783.
 *  - Mercedes-Benz Vito 447 (4): instruktionsbok F447 0099 09, 785–798 and
 *    753–778.
 *    NOTE for both Mercedes: AdBlue, particulate filter and engine oil are
 *    DISPLAY MESSAGES on those vans, not telltales, so they are offered as
 *    messages and labelled as such.
 *  - Toyota Proace MAX (3): instruktionsbok PZ49X-MAX24-SV V5, chapter 3.4,
 *    lamp table 119–126 and display symbols 127–136.
 *  - Citroën Jumpy (1): eGuide jumpy3vp sv-SE, "Kontrollampor och
 *    varningslampor" 11–22.
 *  - Peugeot Expert (1): eGuide expert3vp sv-SE, same chapter 12–17.
 *
 * What is left out, deliberately: green and blue telltales (a system is on,
 * not a fault), the comfort-electronics faults nobody acts on at the van
 * (rain sensor, dusk sensor, keyless, traffic-sign recognition, blind spot),
 * and the electric-van lamps in the Toyota and Peugeot books — this fleet is
 * diesel. A driver who sees something not on the list picks "Annan lampa".
 *
 * Only the lamps a driver would REPORT are listed: red and amber. Green and
 * blue telltales say a system is on, not that something is wrong, and putting
 * eighty of them in a dropdown would bury the ten that matter.
 *
 * The symbols are drawn here rather than copied out of the manuals: one
 * consistent stroke weight, legible at 22 px on a phone, no image files, and
 * nothing lifted from a copyrighted page.
 */

/* Each icon is a 100×100 viewBox, stroked in currentColor so the colour comes
   from the class the page puts on it (red or amber). Same idiom as the
   vehicle-lighting symbol set in the suite's own reference. */
const S = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" ' +
  'stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"';

const ICONS = {
  // Engine block seen from the side — the check-engine lamp.
  engine: `<svg ${S}><path d="M18 62V44h8v-8h12l8-8h16v8h10v8h10v10h-8v18H26v-10z" /><path d="M34 36V28" /><path d="M46 36V28" /></svg>`,

  // Oil can with a falling drop.
  oil: `<svg ${S}><path d="M20 68V48h30l10-8h12v8h16" /><path d="M20 48h40v20H20z" fill="currentColor" stroke="none"/><path d="M20 68h40" /><path d="M78 54c0 4-3 6-3 9a3 3 0 006 0c0-3-3-5-3-9z" fill="currentColor" stroke="none"/></svg>`,

  // Oil can over a level line.
  oilLevel: `<svg ${S}><path d="M18 58V42h28l10-7h12v7h14" /><path d="M18 42h38v16H18z" fill="currentColor" stroke="none"/><path d="M20 72q8-6 16 0t16 0 16 0 12 0" /></svg>`,

  // Thermometer standing in liquid.
  temp: `<svg ${S}><path d="M50 20a7 7 0 00-7 7v27a12 12 0 1014 0V27a7 7 0 00-7-7z" /><path d="M50 34v24" /><path d="M14 76q9-7 18 0t18 0 18 0 18 0" /><path d="M14 88q9-7 18 0t18 0 18 0 18 0" /></svg>`,

  // Battery with its two terminals.
  battery: `<svg ${S}><rect x="16" y="34" width="68" height="38" rx="4" /><path d="M30 26h12v8H30zM58 26h12v8H58z" /><path d="M32 53h12M62 47v12M56 53h12" /></svg>`,

  // (!) between two brackets — the brake warning.
  brake: `<svg ${S}><circle cx="50" cy="50" r="20" /><path d="M50 38v16M50 60v.5" stroke-width="7" /><path d="M22 30a30 30 0 000 40M78 30a30 30 0 010 40" /></svg>`,

  // ABS between the same brackets.
  abs: `<svg ${S}><circle cx="50" cy="50" r="20" /><text x="50" y="56" text-anchor="middle" font-size="17" font-family="Arial, sans-serif" font-weight="700" fill="currentColor" stroke="none">ABS</text><path d="M22 30a30 30 0 000 40M78 30a30 30 0 010 40" /></svg>`,

  // P between the brackets — parking brake.
  parkBrake: `<svg ${S}><circle cx="50" cy="50" r="20" /><text x="50" y="58" text-anchor="middle" font-size="24" font-family="Arial, sans-serif" font-weight="700" fill="currentColor" stroke="none">P</text><path d="M22 30a30 30 0 000 40M78 30a30 30 0 010 40" /></svg>`,

  // A car above two skidding tracks — stability control.
  esp: `<svg ${S}><path d="M28 44l6-12h32l6 12v14H28z" /><circle cx="37" cy="58" r="5" /><circle cx="63" cy="58" r="5" /><path d="M24 76q8-8 16 0t16 0" /><path d="M44 88q8-8 16 0t16 0" /></svg>`,

  espOff: `<svg ${S}><path d="M24 40l6-12h30l6 12v13H24z" /><circle cx="33" cy="53" r="4" /><circle cx="57" cy="53" r="4" /><path d="M18 70q7-7 14 0t14 0" /><text x="62" y="88" text-anchor="middle" font-size="20" font-family="Arial, sans-serif" font-weight="700" fill="currentColor" stroke="none">OFF</text></svg>`,

  // Seated person in front of an inflated bag.
  airbag: `<svg ${S}><circle cx="34" cy="30" r="9" /><path d="M22 76V58a12 12 0 0112-12h6v20" /><path d="M22 76h26" /><circle cx="68" cy="58" r="16" /><path d="M44 66h8" /></svg>`,

  // Seated person with the belt across the chest.
  seatbelt: `<svg ${S}><circle cx="40" cy="26" r="9" /><path d="M26 80V60a14 14 0 0114-14h8v34" /><path d="M26 80h28" /><path d="M62 22L38 70" stroke-width="7" /></svg>`,

  // Tyre cross-section with an exclamation mark inside.
  tyre: `<svg ${S}><path d="M24 72V48a26 26 0 0152 0v24" /><path d="M16 72h68" /><path d="M30 80v6M44 80v6M56 80v6M70 80v6" stroke-width="6" /><path d="M50 40v16M50 62v.5" stroke-width="7" /></svg>`,

  // Two glow-plug coils.
  glow: `<svg ${S}><path d="M22 26v48" /><path d="M22 30h18a9 9 0 010 18H22" /><path d="M22 48h18a9 9 0 010 18H22" /><path d="M62 26v48" /><path d="M62 30h18a9 9 0 010 18H62" /><path d="M62 48h18a9 9 0 010 18H62" /></svg>`,

  // A drop falling into liquid with an exhaust curl — AdBlue.
  adblue: `<svg ${S}><path d="M50 22c0 10-9 14-9 22a9 9 0 0018 0c0-8-9-12-9-22z" /><path d="M18 70q8-7 16 0t16 0 16 0 16 0" /><path d="M18 84q8-7 16 0t16 0 16 0 16 0" /><path d="M74 30q8 4 0 10t0 10" /></svg>`,

  // Filter box with soot and an exhaust flow — particulate filter.
  dpf: `<svg ${S}><rect x="26" y="34" width="48" height="32" rx="4" /><path d="M36 44h4M48 44h4M60 44h4M36 56h4M48 56h4M60 56h4" stroke-width="6" /><path d="M18 50h8M74 50h8" /><path d="M30 78q8-6 16 0t16 0 12 0" /></svg>`,

  // Fuel pump.
  fuel: `<svg ${S}><path d="M24 80V30a8 8 0 018-8h20a8 8 0 018 8v50" /><path d="M20 80h48" /><path d="M32 34h20v14H32z" fill="currentColor" stroke="none"/><path d="M60 44h10a6 6 0 016 6v18a6 6 0 0012 0V40l-8-10" /></svg>`,

  fuelCut: `<svg ${S}><path d="M24 78V32a8 8 0 018-8h18a8 8 0 018 8v46" /><path d="M20 78h46" /><path d="M32 36h18v12H32z" fill="currentColor" stroke="none"/><path d="M58 44h9a6 6 0 016 6v16a6 6 0 0011 0V40l-7-9" /><path d="M18 84L84 20" stroke-width="7" /></svg>`,

  waterFuel: `<svg ${S}><path d="M24 72V28a8 8 0 018-8h18a8 8 0 018 8v44" /><path d="M20 72h46" /><path d="M32 32h18v12H32z" fill="currentColor" stroke="none"/><path d="M58 40h9a6 6 0 016 6v14a6 6 0 0011 0V36l-7-9" /><path d="M34 84c0 4-4 6-4 9a4 4 0 008 0c0-3-4-5-4-9zM56 84c0 4-4 6-4 9a4 4 0 008 0c0-3-4-5-4-9z" fill="currentColor" stroke="none"/></svg>`,

  // Steering wheel with an exclamation mark.
  steering: `<svg ${S}><circle cx="46" cy="50" r="26" /><circle cx="46" cy="50" r="8" /><path d="M46 24v18M24 62l14-8M68 62l-14-8" /><path d="M84 34v18M84 58v.5" stroke-width="7" /></svg>`,

  // Van seen from above with the doors open.
  door: `<svg ${S}><rect x="40" y="18" width="20" height="64" rx="8" /><path d="M40 32L14 24v22l26-4" /><path d="M60 32l26-8v22l-26-4" /></svg>`,

  // Van in profile with the bonnet up.
  bonnet: `<svg ${S}><path d="M20 70h60" /><path d="M24 70V50h18l10-10h24v30" /><path d="M42 50L18 34" /></svg>`,

  // Two crossed spanners — scheduled service.
  service: `<svg ${S}><path d="M30 24a12 12 0 0014 16l28 28a7 7 0 01-10 10L34 50a12 12 0 01-16-14l10 10 8-8-6-14z" /><path d="M70 24l-16 16" /></svg>`,

  // A radiating bulb with an exclamation mark — exterior lamp failure.
  lampFault: `<svg ${S}><path d="M44 24C24 24 14 36 14 50s10 26 30 26z" fill="currentColor" stroke="none"/><path d="M50 34h20M50 50h20M50 66h20" /><path d="M84 38v16M84 60v.5" stroke-width="7" /></svg>`,

  // Exclamation mark in a triangle — the general fault lamp.
  triangle: `<svg ${S}><path d="M50 20L86 80H14z" /><path d="M50 44v18M50 68v.5" stroke-width="7" /></svg>`,

  // Car with a padlock — immobiliser.
  immobiliser: `<svg ${S}><path d="M16 56l6-14h30l6 14v12H16z" /><circle cx="25" cy="68" r="5" /><circle cx="51" cy="68" r="5" /><rect x="66" y="46" width="24" height="20" rx="3" /><path d="M72 46v-6a6 6 0 0112 0v6" /></svg>`,

  // Brake disc with pads — worn linings.
  brakePad: `<svg ${S}><circle cx="50" cy="50" r="20" stroke-dasharray="7 7" /><path d="M22 32v36M78 32v36" stroke-width="7" /></svg>`,

  brakeHot: `<svg ${S}><circle cx="46" cy="50" r="18" stroke-dasharray="7 7" /><path d="M20 34v32M72 34v32" stroke-width="7" /><path d="M86 28v22" stroke-width="6" /><circle cx="86" cy="60" r="7" /></svg>`,

  // Cog with an exclamation mark — gearbox.
  gearbox: `<svg ${S}><circle cx="50" cy="50" r="20" /><path d="M44 18h12v10H44zM44 72h12v10H44zM18 44h10v12H18zM72 44h10v12H72z" /><path d="M27 27l8 8M65 65l8 8M27 73l8-8M65 35l8-8" stroke-width="7" /><path d="M50 40v10M50 56v.5" stroke-width="6" /></svg>`,

  // Chassis over an axle with level marks — air suspension.
  airSuspension: `<svg ${S}><path d="M18 44h64" /><circle cx="34" cy="70" r="10" /><circle cx="70" cy="70" r="10" /><path d="M18 56h8M34 56h8M50 56h8M66 56h8" stroke-width="6" /></svg>`,

  // Axle with a wheel at each end — differential.
  diff: `<svg ${S}><path d="M26 50h48" /><rect x="14" y="34" width="12" height="32" rx="3" /><rect x="74" y="34" width="12" height="32" rx="3" /><circle cx="50" cy="50" r="10" /><path d="M50 74v6" stroke-width="6" /></svg>`,

  // Car drifting between lane markings.
  lane: `<svg ${S}><path d="M36 44l5-12h18l5 12v14H36z" /><circle cx="44" cy="58" r="4" /><circle cx="56" cy="58" r="4" /><path d="M20 20v14M20 44v14M20 68v14M80 20v14M80 44v14M80 68v14" stroke-width="6" /></svg>`,

  // Car with an impact burst in front of it.
  collision: `<svg ${S}><path d="M30 64l5-14h24l5 14v12H30z" /><circle cx="38" cy="76" r="4" /><circle cx="62" cy="76" r="4" /><path d="M50 14v14M32 20l8 10M68 20l-8 10M20 34l12 6M80 34l-12 6" stroke-width="6" /></svg>`,

  // TCO in a frame — the tachograph lamp.
  tacho: `<svg ${S}><rect x="16" y="34" width="68" height="34" rx="5" /><text x="50" y="58" text-anchor="middle" font-size="20" font-family="Arial, sans-serif" font-weight="700" fill="currentColor" stroke="none">TCO</text></svg>`,

  // A tortoise — reduced performance.
  turtle: `<svg ${S}><path d="M24 62a26 16 0 0152 0z" /><path d="M40 62v10M62 62v10M24 62h-8l-4 8M76 58l10-6 2 8" /><circle cx="88" cy="52" r="5" /></svg>`,

  // Battery with a bolt — the high-voltage battery.
  hvBattery: `<svg ${S}><rect x="16" y="34" width="68" height="38" rx="4" /><path d="M30 26h12v8H30zM58 26h12v8H58z" /><path d="M54 40L40 56h12l-6 14 16-18H50z" fill="currentColor" stroke="none"/></svg>`,

  // A screen with lines — the Sprinter's display messages.
  message: `<svg ${S}><rect x="14" y="26" width="72" height="44" rx="6" /><path d="M28 42h44M28 54h30" /><path d="M40 70l-6 12 16-12" /></svg>`,

  /* --- added 2026-09-16, with the per-model lists ------------------- */

  // (!) in a circle with the word under it — the Stellantis STOP lamp.
  stop: `<svg ${S}><circle cx="50" cy="38" r="20" /><path d="M50 26v14M50 46v.5" stroke-width="7" /><text x="50" y="84" text-anchor="middle" font-size="22" font-family="Arial, sans-serif" font-weight="700" fill="currentColor" stroke="none">STOP</text></svg>`,

  // Catalyst body with exhaust flowing out — the SCR / emission lamp.
  scr: `<svg ${S}><rect x="22" y="38" width="42" height="24" rx="6" /><path d="M32 46v8M42 46v8M52 46v8" stroke-width="6" /><path d="M64 44h10M64 56h14M78 50q6 4 0 8" /></svg>`,

  // Car with the braking burst ahead of it — active brake assist.
  brakeAssist: `<svg ${S}><path d="M22 66l5-14h22l5 14v12H22z" /><circle cx="30" cy="78" r="4" /><circle cx="50" cy="78" r="4" /><path d="M66 30a26 26 0 010 40M78 20a38 38 0 010 60" /><path d="M64 50h.5" stroke-width="7" /></svg>`,

  // A bolt inside a circle — a fault in the electrical system.
  electrical: `<svg ${S}><circle cx="50" cy="50" r="28" /><path d="M56 26L38 54h12l-6 22 20-30H50z" fill="currentColor" stroke="none"/></svg>`,

  // Car on a slope with the hill behind it — hill-start assist.
  hill: `<svg ${S}><path d="M14 78h72" /><path d="M20 70L62 26" /><path d="M36 62l6-12h18l8 10v10H36z" transform="rotate(-20 50 55)" /><circle cx="42" cy="70" r="5" /><circle cx="66" cy="54" r="5" /></svg>`,

  // Van tail with the platform and its two arrows — the tail lift.
  tailLift: `<svg ${S}><path d="M18 22h40v46H18z" /><path d="M58 52h26" stroke-width="7" /><path d="M72 36v10M72 58v10M66 42l6-6 6 6M66 62l6 6 6-6" /></svg>`,

  // Van with a trailer box behind it — trailer or coupling fault.
  trailer: `<svg ${S}><path d="M12 44l6-12h20l6 12v18H12z" /><circle cx="22" cy="66" r="6" /><circle cx="38" cy="66" r="6" /><path d="M50 56h6" /><rect x="56" y="34" width="32" height="28" rx="3" /><circle cx="72" cy="68" r="6" /></svg>`,

  // Pleated filter element with air arrows — a clogged air filter.
  airFilter: `<svg ${S}><rect x="26" y="30" width="48" height="40" rx="6" /><path d="M38 30v40M50 30v40M62 30v40" stroke-width="6" /><path d="M14 40h8M14 60h8M80 40h8M80 60h8" stroke-width="6" /></svg>`,

  // Cup with steam — the fatigue warning.
  coffee: `<svg ${S}><path d="M24 44h44v18a16 16 0 01-16 16H40a16 16 0 01-16-16z" /><path d="M68 48h8a8 8 0 010 16h-8" /><path d="M38 20q6 6 0 12M52 20q6 6 0 12" /><path d="M20 86h56" /></svg>`,

  // Snowflake — risk of ice.
  ice: `<svg ${S}><path d="M50 16v68M20 33l60 34M80 33L20 67" /><path d="M42 24l8 8 8-8M42 76l8-8 8 8" /><path d="M22 44l2 11 11 2M78 44l-2 11-11 2M22 56l2-11 11-2M78 56l-2-11-11-2" /></svg>`,

  // A key — the battery in the key, and the key-system lamps.
  key: `<svg ${S}><circle cx="34" cy="50" r="14" /><path d="M48 50h36" /><path d="M70 50v12M82 50v10" /><path d="M34 50h.5" stroke-width="8" /></svg>`,

  // Car seen from above with three arcs behind it — the parking sensors.
  parkSensor: `<svg ${S}><rect x="32" y="30" width="36" height="34" rx="5" /><path d="M36 30l4-8h20l4 8" /><path d="M30 74q20-10 40 0M26 84q24-14 48 0" /></svg>`,

  /* Three that would otherwise share a symbol with a lamp sitting a few rows
     above them in the same list: two identical pictures with different words
     under them is exactly what this picker exists to avoid. */

  // Brake disc with an R — the retarder.
  retarder: `<svg ${S}><circle cx="50" cy="50" r="26" /><circle cx="50" cy="50" r="10" /><text x="50" y="40" text-anchor="middle" font-size="18" font-family="Arial, sans-serif" font-weight="700" fill="currentColor" stroke="none">R</text><path d="M24 74h52" /></svg>`,

  // Gear on a shaft — the power take-off.
  pto: `<svg ${S}><circle cx="62" cy="50" r="18" /><path d="M56 26h12M56 74h12M38 44h10M38 56h10M76 44h10M76 56h10" stroke-width="6" /><circle cx="62" cy="50" r="6" /><path d="M14 50h20" stroke-width="7" /></svg>`,

  // Two discs pressed together — the clutch.
  clutch: `<svg ${S}><circle cx="38" cy="50" r="22" /><path d="M62 28v44" /><path d="M72 34v32M82 40v20" /><circle cx="38" cy="50" r="7" /></svg>`,

  // A question mark in a circle — "something else".
  other: `<svg ${S}><circle cx="50" cy="50" r="30" /><path d="M40 40a10 10 0 0117 7c0 7-7 7-7 13" /><path d="M50 68v.5" stroke-width="7" /></svg>`
};


/* ------------------------------------------------------------------ *
 * The lamps themselves                                                *
 * ------------------------------------------------------------------ *
 *
 * One entry per telltale, with the Swedish name a Swedish workshop uses and
 * the same thing in the three other languages the form is read in. The CODE
 * is what gets stored on the check -- names can be reworded, a stored value
 * cannot -- and it is deliberately language-free.
 */

const LAMPS = {
  brake:        { icon: 'brake',        sv: 'Bromsvarning / bromsvätska',        en: 'Brake warning / brake fluid',      ar: 'تحذير الفرامل / سائل الفرامل',        hi: 'ब्रेक चेतावनी / ब्रेक फ़्लूइड' },
  /* No colour in the name: the same fault is a red lamp on the IVECO ("Fel på
     bromsar", placering 7) and an amber one on the Mercedes and the Peugeot,
     and the button the driver taps is already drawn in the right colour. */
  brakeFault:   { icon: 'brake',        sv: 'Fel i bromssystemet',               en: 'Brake system fault',               ar: 'عطل في نظام الفرامل',                 hi: 'ब्रेक सिस्टम में ख़राबी' },
  abs:          { icon: 'abs',          sv: 'ABS',                               en: 'ABS',                              ar: 'نظام ABS',                            hi: 'ABS' },
  parkBrake:    { icon: 'parkBrake',    sv: 'Parkeringsbroms – fel',             en: 'Parking brake fault',              ar: 'عطل في فرملة الانتظار',               hi: 'पार्किंग ब्रेक ख़राबी' },
  engine:       { icon: 'engine',       sv: 'Motorlampa (motorfel / EOBD)',      en: 'Engine light (engine fault / EOBD)', ar: 'لمبة المحرك (عطل / EOBD)',          hi: 'इंजन लाइट (इंजन ख़राबी / EOBD)' },
  oilPressure:  { icon: 'oil',          sv: 'Lågt motoroljetryck',               en: 'Low engine oil pressure',          ar: 'ضغط زيت المحرك منخفض',                hi: 'इंजन ऑयल प्रेशर कम' },
  oilLevel:     { icon: 'oilLevel',     sv: 'Motoroljenivå',                     en: 'Engine oil level',                 ar: 'مستوى زيت المحرك',                    hi: 'इंजन ऑयल स्तर' },
  coolant:      { icon: 'temp',         sv: 'Kylvätska – temperatur eller nivå', en: 'Coolant temperature or level',     ar: 'حرارة أو مستوى سائل التبريد',         hi: 'कूलेंट तापमान या स्तर' },
  battery:      { icon: 'battery',      sv: 'Laddning / generator',              en: 'Charging / alternator',            ar: 'الشحن / الدينامو',                    hi: 'चार्जिंग / अल्टरनेटर' },
  airbag:       { icon: 'airbag',       sv: 'Krockkudde',                        en: 'Airbag',                           ar: 'الوسادة الهوائية',                    hi: 'एयरबैग' },
  seatbelt:     { icon: 'seatbelt',     sv: 'Bälte ej fastspänt',                en: 'Seat belt not fastened',           ar: 'حزام الأمان غير مربوط',               hi: 'सीट बेल्ट नहीं बंधी' },
  steering:     { icon: 'steering',     sv: 'Servostyrning',                     en: 'Power steering',                   ar: 'مقود بمساعدة (باور)',                 hi: 'पावर स्टीयरिंग' },
  esp:          { icon: 'esp',          sv: 'Antisladd (ESP / ESC)',             en: 'Stability control (ESP / ESC)',    ar: 'نظام الثبات (ESP / ESC)',             hi: 'स्टेबिलिटी कंट्रोल (ESP / ESC)' },
  espOff:       { icon: 'espOff',       sv: 'Antisladd avstängd',                en: 'Stability control switched off',   ar: 'نظام الثبات متوقف',                   hi: 'स्टेबिलिटी कंट्रोल बंद' },
  tyre:         { icon: 'tyre',         sv: 'Däcktryck (TPMS)',                  en: 'Tyre pressure (TPMS)',             ar: 'ضغط الإطارات (TPMS)',                 hi: 'टायर प्रेशर (TPMS)' },
  glow:         { icon: 'glow',         sv: 'Förglödning / glödstift',           en: 'Preheating / glow plugs',          ar: 'التسخين المسبق / شمعات الإحماء',      hi: 'प्रीहीटिंग / ग्लो प्लग' },
  adblue:       { icon: 'adblue',       sv: 'AdBlue – låg nivå',                 en: 'AdBlue – low level',               ar: 'AdBlue – المستوى منخفض',              hi: 'AdBlue – स्तर कम' },
  dpf:          { icon: 'dpf',          sv: 'Partikelfilter (DPF)',              en: 'Particulate filter (DPF)',         ar: 'مرشّح الجسيمات (DPF)',                hi: 'पार्टिकुलेट फ़िल्टर (DPF)' },
  fuel:         { icon: 'fuel',         sv: 'Bränslereserv',                     en: 'Low fuel',                         ar: 'احتياطي الوقود',                      hi: 'ईंधन रिज़र्व' },
  fuelCut:      { icon: 'fuelCut',      sv: 'Bränsleavstängning utlöst',         en: 'Fuel cut-off tripped',             ar: 'تفعيل قاطع الوقود',                   hi: 'फ़्यूल कट-ऑफ़ सक्रिय' },
  waterFuel:    { icon: 'waterFuel',    sv: 'Vatten i dieselfiltret',            en: 'Water in the diesel filter',       ar: 'ماء في مرشّح الديزل',                 hi: 'डीज़ल फ़िल्टर में पानी' },
  door:         { icon: 'door',         sv: 'Dörr eller lastutrymme ej stängt',  en: 'Door or load area not closed',     ar: 'باب أو صندوق الشحن غير مغلق',         hi: 'दरवाज़ा या लोड एरिया खुला' },
  bonnet:       { icon: 'bonnet',       sv: 'Motorhuven ej stängd',              en: 'Bonnet not closed',                ar: 'غطاء المحرك غير مغلق',                hi: 'बोनट बंद नहीं' },
  service:      { icon: 'service',      sv: 'Service / underhåll',               en: 'Service due',                      ar: 'موعد الصيانة',                        hi: 'सर्विस ड्यू' },
  lampFault:    { icon: 'lampFault',    sv: 'Fel på ytterbelysningen',           en: 'Exterior light fault',             ar: 'عطل في الإضاءة الخارجية',             hi: 'बाहरी लाइट ख़राबी' },
  triangle:     { icon: 'triangle',     sv: 'Allmän varning (triangel)',         en: 'General warning (triangle)',       ar: 'تحذير عام (مثلث)',                    hi: 'सामान्य चेतावनी (त्रिकोण)' },
  immobiliser:  { icon: 'immobiliser',  sv: 'Startspärr / immobilizer',          en: 'Immobiliser',                      ar: 'مانع الحركة (إيموبيلايزر)',           hi: 'इमोबिलाइज़र' },
  brakePad:     { icon: 'brakePad',     sv: 'Slitna bromsbelägg',                en: 'Worn brake pads',                  ar: 'تآكل تيل الفرامل',                    hi: 'ब्रेक पैड घिसे' },
  brakeHot:     { icon: 'brakeHot',     sv: 'Bromsarna överhettade',             en: 'Brakes overheating',               ar: 'ارتفاع حرارة الفرامل',                hi: 'ब्रेक ज़्यादा गरम' },
  gearbox:      { icon: 'gearbox',      sv: 'Automatväxellåda',                  en: 'Automatic gearbox',                ar: 'ناقل الحركة الأوتوماتيكي',            hi: 'ऑटोमैटिक गियरबॉक्स' },
  airSuspension:{ icon: 'airSuspension',sv: 'Luftfjädring',                      en: 'Air suspension',                   ar: 'تعليق هوائي',                         hi: 'एयर सस्पेंशन' },
  diff:         { icon: 'diff',         sv: 'Differential',                      en: 'Differential',                     ar: 'الترس التفاضلي',                      hi: 'डिफरेंशियल' },
  lane:         { icon: 'lane',         sv: 'Körfilsvarning',                    en: 'Lane departure warning',           ar: 'تحذير مغادرة المسار',                 hi: 'लेन डिपार्चर वॉर्निंग' },
  collision:    { icon: 'collision',    sv: 'Kollisionsvarning / nödbroms',      en: 'Collision warning / emergency braking', ar: 'تحذير التصادم / الفرملة الطارئة', hi: 'टक्कर चेतावनी / इमरजेंसी ब्रेकिंग' },
  tacho:        { icon: 'tacho',        sv: 'Färdskrivare (TCO)',                en: 'Tachograph (TCO)',                 ar: 'جهاز التاكوغراف (TCO)',               hi: 'टैकोग्राफ़ (TCO)' },
  turtle:       { icon: 'turtle',       sv: 'Reducerad effekt (sköldpaddan)',    en: 'Reduced power (turtle)',           ar: 'أداء محدود (السلحفاة)',               hi: 'घटी हुई पावर (कछुआ)' },
  hvBattery:    { icon: 'hvBattery',    sv: 'Högspänningsbatteri',               en: 'High-voltage battery',             ar: 'بطارية الجهد العالي',                 hi: 'हाई-वोल्टेज बैटरी' },
  msgAdblue:    { icon: 'message',      sv: 'Meddelande på displayen: AdBlue',   en: 'Display message: AdBlue',          ar: 'رسالة على الشاشة: AdBlue',            hi: 'डिस्प्ले संदेश: AdBlue' },
  msgDpf:       { icon: 'message',      sv: 'Meddelande på displayen: partikelfilter', en: 'Display message: particulate filter', ar: 'رسالة على الشاشة: مرشّح الجسيمات', hi: 'डिस्प्ले संदेश: पार्टिकुलेट फ़िल्टर' },
  msgOil:       { icon: 'message',      sv: 'Meddelande på displayen: motorolja', en: 'Display message: engine oil',     ar: 'رسالة على الشاشة: زيت المحرك',        hi: 'डिस्प्ले संदेश: इंजन ऑयल' },
  /* --- added 2026-09-16, from the six manuals (see MODELS below) ---- */
  stop:         { icon: 'stop',         sv: 'STOP – stanna bilen omgående',      en: 'STOP – stop the vehicle at once',  ar: 'STOP – أوقف المركبة فوراً',           hi: 'STOP – वाहन तुरंत रोकें' },
  ebd:          { icon: 'abs',          sv: 'Bromskraftfördelning (EBD) – fel',  en: 'Brake force distribution (EBD) fault', ar: 'عطل في توزيع قوة الفرملة (EBD)',  hi: 'ब्रेक फ़ोर्स वितरण (EBD) ख़राबी' },
  scr:          { icon: 'scr',          sv: 'Avgasrening (SCR) – fel',           en: 'Exhaust after-treatment (SCR) fault', ar: 'عطل في نظام معالجة العادم (SCR)', hi: 'एग्ज़ॉस्ट सिस्टम (SCR) ख़राबी' },
  tyreFault:    { icon: 'tyre',         sv: 'Däcktryckskontrollen ur funktion',  en: 'Tyre pressure monitoring out of order', ar: 'نظام مراقبة ضغط الإطارات متوقف', hi: 'टायर प्रेशर मॉनिटरिंग बंद' },
  brakeAssist:  { icon: 'brakeAssist',  sv: 'Aktiv bromsassistent – fel eller ej tillgänglig', en: 'Active brake assist – fault or unavailable', ar: 'مساعد الفرملة النشط – عطل أو غير متاح', hi: 'एक्टिव ब्रेक असिस्ट – ख़राबी या अनुपलब्ध' },
  brakeAssistOff:{ icon: 'brakeAssist', sv: 'Aktiv bromsassistent avstängd',     en: 'Active brake assist switched off',  ar: 'مساعد الفرملة النشط متوقف',          hi: 'एक्टिव ब्रेक असिस्ट बंद' },
  electrical:   { icon: 'electrical',   sv: 'Fel i elsystemet',                  en: 'Electrical system fault',          ar: 'عطل في النظام الكهربائي',             hi: 'इलेक्ट्रिकल सिस्टम ख़राबी' },
  hillHold:     { icon: 'hill',         sv: 'Backstartshjälp (Hill Holder) – fel', en: 'Hill start assist fault',        ar: 'عطل في مساعد الانطلاق على المنحدر',   hi: 'हिल स्टार्ट असिस्ट ख़राबी' },
  tailLift:     { icon: 'tailLift',     sv: 'Bakgavellyft / ramp',               en: 'Tail lift / ramp',                 ar: 'رافعة خلفية / منحدر',                 hi: 'टेल लिफ्ट / रैंप' },
  pto:          { icon: 'pto',          sv: 'Kraftuttag (PTO) inkopplat',        en: 'Power take-off (PTO) engaged',     ar: 'مأخذ القدرة (PTO) مفعّل',             hi: 'पावर टेक-ऑफ़ (PTO) चालू' },
  retarder:     { icon: 'retarder',     sv: 'Retarder – inkopplad eller blockerad', en: 'Retarder engaged or blocked',   ar: 'المبطئ (Retarder) مفعّل أو محجوب',    hi: 'रिटार्डर चालू या अवरुद्ध' },
  trailer:      { icon: 'trailer',      sv: 'Släp eller kopplingsanordning – fel', en: 'Trailer or coupling fault',      ar: 'عطل في المقطورة أو وصلة القطر',       hi: 'ट्रेलर या कपलिंग ख़राबी' },
  glowFault:    { icon: 'glow',         sv: 'Fel i förglödningssystemet',        en: 'Preheating system fault',          ar: 'عطل في نظام التسخين المسبق',          hi: 'प्रीहीटिंग सिस्टम ख़राबी' },
  oilSensor:    { icon: 'oilLevel',     sv: 'Fel på motoroljegivaren',           en: 'Engine oil sensor fault',          ar: 'عطل في حساس زيت المحرك',              hi: 'इंजन ऑयल सेंसर ख़राबी' },
  fuelSensor:   { icon: 'fuel',         sv: 'Fel på bränslenivågivaren',         en: 'Fuel level sender fault',          ar: 'عطل في حساس مستوى الوقود',            hi: 'ईंधन स्तर सेंसर ख़राबी' },
  airFilter:    { icon: 'airFilter',    sv: 'Luftfiltret igensatt',              en: 'Air filter clogged',               ar: 'مرشّح الهواء مسدود',                  hi: 'एयर फ़िल्टर जाम' },
  gearboxHot:   { icon: 'gearbox',      sv: 'Växellådsoljan överhettad',         en: 'Gearbox oil overheating',          ar: 'ارتفاع حرارة زيت ناقل الحركة',        hi: 'गियरबॉक्स ऑयल ज़्यादा गरम' },
  driverAttention:{ icon: 'coffee',     sv: 'Trötthetsvarning – ta en paus',     en: 'Fatigue warning – take a break',   ar: 'تحذير الإرهاق – خذ استراحة',          hi: 'थकान चेतावनी – ब्रेक लें' },
  ice:          { icon: 'ice',          sv: 'Risk för is på vägen',              en: 'Risk of ice on the road',          ar: 'خطر وجود جليد على الطريق',            hi: 'सड़क पर बर्फ़ का ख़तरा' },
  clutchOverheat:{ icon: 'clutch',      sv: 'Kopplingen överhettas',             en: 'Clutch overheating',               ar: 'ارتفاع حرارة القابض (الدبرياج)',      hi: 'क्लच ज़्यादा गरम' },
  keyBattery:   { icon: 'key',          sv: 'Byt batteri i nyckeln',             en: 'Replace the key battery',          ar: 'استبدل بطارية المفتاح',               hi: 'चाबी की बैटरी बदलें' },
  sos:          { icon: 'message',      sv: 'Nödanropssystemet (SOS) – fel',     en: 'Emergency call system (SOS) fault', ar: 'عطل في نظام نداء الطوارئ (SOS)',     hi: 'आपातकालीन कॉल सिस्टम (SOS) ख़राबी' },
  parkSensor:   { icon: 'parkSensor',   sv: 'Parkerings- eller backsensorer – fel', en: 'Parking or reversing sensor fault', ar: 'عطل في حساسات الركن أو الرجوع',   hi: 'पार्किंग या रिवर्स सेंसर ख़राबी' },
  crossWind:    { icon: 'esp',          sv: 'Sidvindsassistans (Cross Wind Assist)', en: 'Cross Wind Assist',            ar: 'مساعد الرياح الجانبية',               hi: 'क्रॉस विंड असिस्ट' },
  forwardCross: { icon: 'collision',    sv: 'Varning för korsande trafik framför', en: 'Forward crossing alert',         ar: 'تحذير من عبور أمام المركبة',          hi: 'आगे क्रॉसिंग चेतावनी' },

  other:        { icon: 'other',        sv: 'Annan lampa – beskriv nedan',       en: 'Another light – describe below',   ar: 'لمبة أخرى – صِفها أدناه',             hi: 'कोई और लाइट – नीचे बताएं' }
};

/* Red first, then amber: the order a driver should be reading them in, and
   the order the list is drawn in. `r` = red, `a` = amber. */
const MODELS = {
  'iveco-daily': {
    brand: 'IVECO', name: 'Daily',
    source: 'Instruktionsbok, "Förarplats", tabell VARNINGSLAMPOR (placering 1–29, ' +
            's. 113–122) och ideogramförteckningen för huvuddisplayen (s. 123–129)',
    manual: {
      file: 'iveco-daily-varningslampor.pdf',
      title: 'IVECO Daily – Förarplats: varningslampor',
      pages: 's. 113–129 ur instruktionsboken'
    },
    lights: [
      ['coolant', 'r'], ['brake', 'r'], ['brakeFault', 'r'], ['seatbelt', 'r'],
      ['steering', 'r'], ['airbag', 'r'], ['battery', 'r'], ['oilPressure', 'r'],
      ['oilLevel', 'r'], ['airSuspension', 'r'], ['diff', 'r'], ['tailLift', 'r'],
      ['engine', 'a'], ['abs', 'a'], ['ebd', 'a'], ['esp', 'a'], ['espOff', 'a'],
      ['glow', 'a'], ['glowFault', 'a'], ['dpf', 'a'], ['adblue', 'a'],
      ['fuel', 'a'], ['fuelCut', 'a'], ['lampFault', 'a'], ['immobiliser', 'a'],
      ['collision', 'a'], ['lane', 'a'], ['retarder', 'a'], ['triangle', 'a'],
      ['door', 'a'], ['brakePad', 'a'], ['brakeHot', 'a'], ['gearbox', 'a'],
      ['tyre', 'a'], ['waterFuel', 'a'], ['service', 'a'], ['tacho', 'a'],
      ['parkSensor', 'a'], ['trailer', 'a'], ['pto', 'a'], ['oilSensor', 'a'],
      ['ice', 'a'], ['other', 'a']
    ]
  },
  'mb-sprinter': {
    brand: 'Mercedes-Benz', name: 'Sprinter (907)',
    source: 'Instruktionsbok F907 0082 09, "Varnings- och kontrollampor" s. 790–802 ' +
            'och displaymeddelandena s. 753–783. AdBlue, partikelfilter och motorolja ' +
            'visas som displaymeddelanden på den här bilen, inte som lampor',
    manual: {
      file: 'mb-sprinter-907-varningslampor.pdf',
      title: 'Sprinter 907 – Displaymeddelanden och varnings-/kontrollampor',
      pages: 's. 737–802 ur instruktionsboken (maj 2026)',
      full: 'https://www.mercedes-benz.se/vans/services/manuals.html'
    },
    lights: [
      ['brake', 'r'], ['seatbelt', 'r'], ['airbag', 'r'], ['steering', 'r'],
      ['electrical', 'r'], ['coolant', 'r'], ['collision', 'r'],
      ['oilPressure', 'r'], ['oilLevel', 'r'], ['bonnet', 'r'],
      ['engine', 'a'], ['abs', 'a'], ['ebd', 'a'], ['brakeFault', 'a'],
      ['esp', 'a'], ['espOff', 'a'], ['parkBrake', 'a'], ['glow', 'a'],
      ['glowFault', 'a'], ['tyre', 'a'], ['tyreFault', 'a'], ['fuel', 'a'],
      ['door', 'a'], ['tacho', 'a'], ['brakeAssist', 'a'], ['brakeAssistOff', 'a'],
      ['brakePad', 'a'], ['waterFuel', 'a'], ['battery', 'a'], ['airFilter', 'a'],
      ['keyBattery', 'a'], ['gearbox', 'a'], ['diff', 'a'],
      ['msgAdblue', 'a'], ['msgDpf', 'a'], ['msgOil', 'a'], ['other', 'a']
    ]
  },
  'mb-vito': {
    brand: 'Mercedes-Benz', name: 'Vito (447)',
    source: 'Instruktionsbok F447 0099 09, "Varnings- och kontrollampor" s. 785–798 ' +
            'och displaymeddelandena s. 753–778. Som på Sprintern är AdBlue, ' +
            'partikelfilter och motorolja displaymeddelanden. Chassilampan (gul/röd) ' +
            'är AIRMATIC-luftfjädringen, som Sprintern saknar',
    manual: {
      file: 'mb-vito-447-varningslampor.pdf',
      title: 'Vito 447 – Displaymeddelanden och varnings-/kontrollampor',
      pages: 's. 729–798 ur instruktionsboken (maj 2026)',
      full: 'https://www.mercedes-benz.se/vans/services/manuals.html'
    },
    lights: [
      ['brake', 'r'], ['seatbelt', 'r'], ['airbag', 'r'], ['steering', 'r'],
      ['electrical', 'r'], ['coolant', 'r'], ['collision', 'r'],
      ['airSuspension', 'r'], ['oilPressure', 'r'], ['oilLevel', 'r'], ['bonnet', 'r'],
      ['engine', 'a'], ['abs', 'a'], ['ebd', 'a'], ['brakeFault', 'a'],
      ['esp', 'a'], ['espOff', 'a'], ['parkBrake', 'a'], ['glow', 'a'],
      ['tyre', 'a'], ['tyreFault', 'a'], ['fuel', 'a'], ['door', 'a'],
      ['tacho', 'a'], ['brakeAssist', 'a'], ['brakeAssistOff', 'a'],
      ['brakePad', 'a'], ['waterFuel', 'a'], ['battery', 'a'], ['airFilter', 'a'],
      ['keyBattery', 'a'], ['gearbox', 'a'], ['gearboxHot', 'a'],
      ['msgAdblue', 'a'], ['msgDpf', 'a'], ['msgOil', 'a'], ['other', 'a']
    ]
  },
  'toyota-proace-max': {
    brand: 'Toyota', name: 'Proace Max',
    source: 'Instruktionsbok PZ49X-MAX24-SV V5, kapitel 3.4 "Varningslampor och ' +
            'meddelanden": lamptabellen s. 119–126 och displaysymbolerna s. 127–136. ' +
            'De rent eldrivna versionernas lampor är utelämnade – våra bilar är diesel',
    manual: {
      file: 'toyota-proace-max-varningslampor.pdf',
      title: 'Toyota Proace MAX – Varningslampor och meddelanden',
      pages: 's. 119–137 ur instruktionsboken PZ49X-MAX24-SV'
    },
    lights: [
      ['brake', 'r'], ['ebd', 'r'], ['airbag', 'r'], ['seatbelt', 'r'],
      ['coolant', 'r'], ['steering', 'r'], ['immobiliser', 'r'],
      ['oilPressure', 'r'], ['oilLevel', 'r'], ['battery', 'r'], ['door', 'r'],
      ['bonnet', 'r'], ['gearbox', 'r'], ['driverAttention', 'r'], ['sos', 'r'],
      ['forwardCross', 'r'], ['triangle', 'r'],
      ['engine', 'a'], ['abs', 'a'], ['adblue', 'a'], ['fuel', 'a'],
      ['glow', 'a'], ['glowFault', 'a'], ['esp', 'a'], ['espOff', 'a'],
      ['crossWind', 'a'], ['hillHold', 'a'], ['lane', 'a'], ['tyre', 'a'],
      ['tyreFault', 'a'], ['collision', 'a'], ['brakePad', 'a'], ['brakeHot', 'a'],
      ['oilSensor', 'a'], ['fuelCut', 'a'], ['fuelSensor', 'a'], ['waterFuel', 'a'],
      ['ice', 'a'], ['lampFault', 'a'], ['gearboxHot', 'a'], ['service', 'a'],
      ['dpf', 'a'], ['msgOil', 'a'], ['parkSensor', 'a'], ['trailer', 'a'],
      ['other', 'a']
    ]
  },
  'citroen-jumpy': {
    brand: 'Citroën', name: 'Jumpy',
    source: 'Instruktionsbok (eGuide jumpy3vp, sv-SE), kapitlet "Kontrollampor och ' +
            'varningslampor", s. 11–22: röda s. 11–12, orange s. 13–20. Gröna och blå ' +
            'kontrollampor säger att ett system är på och är utelämnade',
    manual: {
      file: 'citroen-jumpy-instruktionsbok.pdf',
      title: 'Citroën Jumpy – Instruktionsbok (hela boken)',
      pages: '324 sidor; varningslamporna s. 11–22',
      full: 'https://service.citroen.com/ACddb/'
    },
    lights: [
      ['stop', 'r'], ['oilPressure', 'r'], ['brake', 'r'], ['ebd', 'r'],
      ['coolant', 'r'], ['battery', 'r'], ['seatbelt', 'r'], ['door', 'r'],
      ['abs', 'a'], ['service', 'a'], ['adblue', 'a'], ['scr', 'a'],
      ['fuelCut', 'a'], ['engine', 'a'], ['collision', 'a'], ['esp', 'a'],
      ['espOff', 'a'], ['tyre', 'a'], ['tyreFault', 'a'], ['glow', 'a'],
      ['airbag', 'a'], ['fuel', 'a'], ['waterFuel', 'a'], ['dpf', 'a'],
      ['steering', 'a'], ['clutchOverheat', 'a'], ['other', 'a']
    ]
  },
  'peugeot-expert': {
    brand: 'Peugeot', name: 'Expert',
    source: 'Instruktionsbok (eGuide expert3vp, sv-SE), kapitlet "Kontrollampor och ' +
            'varningslampor", s. 12–17: röda s. 12–13, orange s. 13–17. Lamporna för ' +
            'e-Expert är utelämnade – vår bil är diesel',
    manual: {
      file: 'peugeot-expert-instruktionsbok.pdf',
      title: 'Peugeot Expert – Instruktionsbok (hela boken)',
      pages: '324 sidor; varningslamporna s. 12–17',
      full: 'https://public.servicebox.peugeot.com/APddb/'
    },
    lights: [
      ['stop', 'r'], ['oilPressure', 'r'], ['brake', 'r'], ['ebd', 'r'],
      ['coolant', 'r'], ['battery', 'r'], ['seatbelt', 'r'], ['door', 'r'],
      ['abs', 'a'], ['brakeFault', 'a'], ['parkBrake', 'a'], ['service', 'a'],
      ['adblue', 'a'], ['scr', 'a'], ['fuelCut', 'a'], ['engine', 'a'],
      ['collision', 'a'], ['brakeAssist', 'a'], ['esp', 'a'], ['espOff', 'a'],
      ['hillHold', 'a'], ['tyre', 'a'], ['tyreFault', 'a'], ['glow', 'a'],
      ['airbag', 'a'], ['fuel', 'a'], ['waterFuel', 'a'], ['dpf', 'a'],
      ['steering', 'a'], ['other', 'a']
    ]
  },
  /* A van whose model nobody has set yet. The lamps every van in this fleet
     has, so the question still works rather than offering nothing. */
  'generic': {
    brand: '', name: 'Okänd modell',
    source: 'Gemensamma lampor – sätt fordonets modell under Admin → Fordon för rätt lista',
    lights: [
      ['brake', 'r'], ['coolant', 'r'], ['oilPressure', 'r'], ['battery', 'r'],
      ['airbag', 'r'], ['seatbelt', 'r'], ['steering', 'r'],
      ['engine', 'a'], ['abs', 'a'], ['esp', 'a'], ['tyre', 'a'], ['glow', 'a'],
      ['adblue', 'a'], ['dpf', 'a'], ['fuel', 'a'], ['service', 'a'],
      ['triangle', 'a'], ['other', 'a']
    ]
  }
};

const MODEL_KEYS = Object.keys(MODELS);

/** The model a vehicle is, falling back to the shared list. */
function modelOf(key) {
  return MODELS[key] || MODELS.generic;
}

/**
 * One vehicle's telltales, ready to render:
 * [{ code, colour: 'red'|'amber', icon, sv, en, ar, hi }]
 * A code with no entry in LAMPS is skipped rather than drawn blank.
 */
function lightsFor(key) {
  return modelOf(key).lights.map(([code, c]) => {
    const lamp = LAMPS[code];
    if (!lamp) return null;
    return { code, colour: c === 'r' ? 'red' : 'amber', icon: lamp.icon,
             sv: lamp.sv, en: lamp.en, ar: lamp.ar, hi: lamp.hi };
  }).filter(Boolean);
}

/**
 * The manual a vehicle's page should link to, or null.
 *
 * `file` is a PDF served from /manualer/, `full` an official page at the
 * maker's own site for the whole book where only an extract is hosted here.
 * A vehicle may override the file (vehicles.manual_file) when its own van
 * differs from the model's default — a different model year, say.
 */
function manualFor(key, override) {
  const own = String(override || '').trim();
  const model = modelOf(key);
  const man = model.manual;
  if (!man && !own) return null;
  /* An override is a different book, so it does not keep the model's
     subtitle: "annat.pdf" under "s. 113–129 ur instruktionsboken" would be a
     caption describing a document nobody is looking at. */
  const modelName = `${model.brand} ${model.name}`.trim() || 'Instruktionsbok';
  if (own && (!man || own !== man.file)) {
    return { file: own, title: modelName, pages: own, full: (man && man.full) || '' };
  }
  return {
    file: own || man.file,
    title: man.title || modelName,
    pages: man.pages || '',
    full: man.full || ''
  };
}

/** The name of a lamp in one language, for reading a check back. */
function lampText(code, lang) {
  const lamp = LAMPS[code];
  if (!lamp) return code;
  return lamp[lang] || lamp.sv;
}

function icon(code) {
  return ICONS[code] || ICONS.other;
}

/**
 * The little question above the list of symbols.
 *
 * "Which one is not working?" -- the general phrasing -- is wrong here: the
 * driver has just said a light is ON, not that something is broken, and the
 * two readings send them to different symbols.
 */
const PICK_LABEL = {
  sv: 'Vilken lampa lyser?',
  en: 'Which light is lit?',
  ar: 'أي لمبة مضيئة؟',
  hi: 'कौन सी लाइट जल रही है?'
};

module.exports = { ICONS, icon, LAMPS, MODELS, MODEL_KEYS, modelOf, lightsFor, lampText,
  manualFor, PICK_LABEL };
