'use strict';

/**
 * The four language flags, drawn rather than typed.
 *
 * They used to be emoji (🇸🇪 🇬🇧 🇸🇦 🇮🇳). Emoji flags are a pair of
 * "regional indicator" letters that only become a flag if the device has a
 * font for them: Windows has none at all and shows the bare letters, and
 * several Android WebViews show two empty boxes. A driver looking for a flag
 * saw nothing to press, which is the whole reason the row exists.
 *
 * So each flag is a small inline SVG — no font, no network, no image file,
 * and legible at 22×15 on a phone. The language's own name sits beside it,
 * because that is what somebody actually looking for their language reads.
 */

/** The Ashoka chakra: 24 spokes, built once rather than typed out. */
const SPOKES = Array.from({ length: 24 }, (_, i) => {
  const a = (i * Math.PI) / 12;
  const x1 = 12 + Math.sin(a) * 0.55, y1 = 8 - Math.cos(a) * 0.55;
  const x2 = 12 + Math.sin(a) * 2.05, y2 = 8 - Math.cos(a) * 2.05;
  return `M${x1.toFixed(2)},${y1.toFixed(2)}L${x2.toFixed(2)},${y2.toFixed(2)}`;
}).join('');

const FLAGS = {
  // Sweden: the cross sits left of centre, as it does on the real flag.
  sv: `<svg viewBox="0 0 24 16" role="img" aria-hidden="true" focusable="false">
      <rect width="24" height="16" fill="#006AA7"/>
      <rect x="7" width="3" height="16" fill="#FECC00"/>
      <rect y="6.5" width="24" height="3" fill="#FECC00"/>
    </svg>`,

  // United Kingdom: white saltire under red, then the white and red cross.
  en: `<svg viewBox="0 0 24 16" role="img" aria-hidden="true" focusable="false">
      <clipPath id="f180-uk"><rect width="24" height="16"/></clipPath>
      <g clip-path="url(#f180-uk)">
        <rect width="24" height="16" fill="#012169"/>
        <path d="M0,0L24,16M24,0L0,16" stroke="#fff" stroke-width="3.4"/>
        <path d="M0,0L24,16M24,0L0,16" stroke="#C8102E" stroke-width="1.8"/>
        <path d="M12,0V16M0,8H24" stroke="#fff" stroke-width="5.4"/>
        <path d="M12,0V16M0,8H24" stroke="#C8102E" stroke-width="3.2"/>
      </g>
    </svg>`,

  // Saudi Arabia: the shahada above the sword. The inscription is set as real
  // Arabic text, squeezed to the flag's width -- at this size it reads as the
  // white script line it is, and nothing about it is invented.
  ar: `<svg viewBox="0 0 24 16" role="img" aria-hidden="true" focusable="false">
      <rect width="24" height="16" fill="#006C35"/>
      <text x="12" y="7.8" text-anchor="middle" fill="#fff" font-size="4.6"
            textLength="19" lengthAdjust="spacingAndGlyphs"
            font-family="'Noto Naskh Arabic','Segoe UI','Traditional Arabic',serif"
            >لا إله إلا الله محمد رسول الله</text>
      <path d="M4.6,11.9H19.4M6.4,10.6L4.6,11.9L6.4,13.2" stroke="#fff" stroke-width=".85"
            fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

  // India: saffron, white, green, with the chakra built above.
  hi: `<svg viewBox="0 0 24 16" role="img" aria-hidden="true" focusable="false">
      <rect width="24" height="5.34" fill="#FF9933"/>
      <rect y="5.34" width="24" height="5.33" fill="#fff"/>
      <rect y="10.67" width="24" height="5.33" fill="#138808"/>
      <circle cx="12" cy="8" r="2.1" fill="none" stroke="#000080" stroke-width=".45"/>
      <path d="${SPOKES}" stroke="#000080" stroke-width=".22"/>
      <circle cx="12" cy="8" r=".5" fill="#000080"/>
    </svg>`
};

function flagSvg(code) {
  return FLAGS[code] || '';
}

module.exports = { flagSvg };
