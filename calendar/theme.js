/* Same colour tokens and panel settings as Route Suite lib/theme.js.
 * Loads the live theme from /api/theme (pushed by the extension) and
 * keeps a localStorage copy for when the helper is offline. */

(function () {
  const KEY = 'route-suite-calendar-theme';
  const TOKENS = [
    { key: 'brand',  cssVar: '--brand',   label: 'Brand / accent',  def: '#e6746e', group: 'site' },
    { key: 'bg',     cssVar: '--bg',      label: 'Page background',  def: '#fad5d2', group: 'site' },
    { key: 'card',   cssVar: '--card',    label: 'Panel background', def: '#ffffff', group: 'site' },
    { key: 'line',   cssVar: '--line',    label: 'Panel border',     def: '#e5e7eb', group: 'site' },
    { key: 'ink',    cssVar: '--ink',     label: 'Text',             def: '#111827', group: 'site' },
    { key: 'muted',  cssVar: '--muted',   label: 'Muted text',       def: '#6b7280', group: 'site' },
    { key: 'kpiBg',  cssVar: '--kpi-bg',  label: 'KPI box',          def: '#e6746e', group: 'site' },
    { key: 'kpiInk', cssVar: '--kpi-ink', label: 'KPI text',         def: '#ffffff', group: 'site' },

    { key: 'termText',     cssVar: '--term-text',          label: 'Normal output · full terminal', def: '#111827', group: 'terminal' },
    { key: 'termDropText', cssVar: '--term-dropdown-text', label: 'Normal output · drop-down',     def: '#d6f5d6', group: 'terminal' },
    { key: 'termUser',     cssVar: '--term-user',          label: 'User / IBX',                    def: '#ff3d9a', group: 'terminal' },
    { key: 'termAndre',     cssVar: '--term-andre',      label: 'Andre name [ANDRE]',            def: '#7c3aed', group: 'terminal' },
    { key: 'termAndreText', cssVar: '--term-andre-text', label: 'Andre output',                  def: '#7c3aed', group: 'terminal' },
    { key: 'termSystem',   cssVar: '--term-system',        label: 'System / RAG',                  def: '#8b5cf6', group: 'terminal' },
    { key: 'termSms',      cssVar: '--term-sms',           label: 'SMS bridge',                    def: '#0891b2', group: 'terminal' },
    { key: 'termInfo',     cssVar: '--term-info',          label: 'Information',                   def: '#2f6fed', group: 'terminal' },
    { key: 'termOk',       cssVar: '--term-ok',            label: 'Success',                       def: '#16a34a', group: 'terminal' },
    { key: 'termWarn',     cssVar: '--term-warn',          label: 'Warning',                       def: '#e5533d', group: 'terminal' },
    { key: 'termError',    cssVar: '--term-error',         label: 'Error',                         def: '#e5150f', group: 'terminal' },
    { key: 'termFix',      cssVar: '--term-fix',           label: 'Suggested fix / command',       def: '#0f766e', group: 'terminal' },
    { key: 'termPrompt',   cssVar: '--term-prompt',        label: 'Prompt',                        def: '#16a34a', group: 'terminal' }
  ];
  const DEFAULT_ALPHA = 1;
  const DEFAULT_TERM_ALPHA = 0.9;
  const DEFAULT_BORDER = 1;

  function hexToRgb(v) {
    if (!v) return null;
    v = String(v).trim();
    let m = /^#?([0-9a-f]{3})$/i.exec(v);
    if (m) {
      const s = m[1];
      return [parseInt(s[0] + s[0], 16), parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16)];
    }
    m = /^#?([0-9a-f]{6})$/i.exec(v);
    if (m) {
      const s = m[1];
      return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
    }
    m = /rgba?\(([^)]+)\)/i.exec(v);
    if (m) {
      const p = m[1].split(',').map((x) => parseFloat(x));
      return [p[0] | 0, p[1] | 0, p[2] | 0];
    }
    return null;
  }

  function rgba(hex, a) {
    const c = hexToRgb(hex) || [255, 255, 255];
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  function defaults() {
    const colors = {};
    TOKENS.forEach((t) => { colors[t.key] = t.def; });
    return { colors: colors, panelAlpha: DEFAULT_ALPHA, termAlpha: DEFAULT_TERM_ALPHA, panelBorder: DEFAULT_BORDER };
  }

  function normalize(theme) {
    const d = defaults();
    if (!theme || typeof theme !== 'object') return d;
    const colors = Object.assign({}, d.colors, theme.colors || {});
    let a = (typeof theme.panelAlpha === 'number' && isFinite(theme.panelAlpha)) ? theme.panelAlpha : d.panelAlpha;
    a = Math.max(0.2, Math.min(1, a));
    let ta = (typeof theme.termAlpha === 'number' && isFinite(theme.termAlpha)) ? theme.termAlpha : d.termAlpha;
    ta = Math.max(0.15, Math.min(1, ta));
    let b = (typeof theme.panelBorder === 'number' && isFinite(theme.panelBorder)) ? theme.panelBorder : d.panelBorder;
    b = Math.max(0, Math.min(8, Math.round(b)));
    return { colors: colors, panelAlpha: a, termAlpha: ta, panelBorder: b };
  }

  function css(theme) {
    const t = normalize(theme);
    const c = t.colors;
    const brandRgb = hexToRgb(c.brand) || [230, 116, 110];
    const cardRgb = hexToRgb(c.card) || [255, 255, 255];
    const vars = TOKENS.map((tok) => '  ' + tok.cssVar + ': ' + c[tok.key] + ';').join('\n');
    const cardA = rgba(c.card, t.panelAlpha);
    const brandSoft = 'rgba(' + brandRgb[0] + ',' + brandRgb[1] + ',' + brandRgb[2] + ',0.14)';
    const brandSofter = 'rgba(' + brandRgb[0] + ',' + brandRgb[1] + ',' + brandRgb[2] + ',0.08)';
    const headBg = 'rgba(' + cardRgb[0] + ',' + cardRgb[1] + ',' + cardRgb[2] + ',' + Math.max(0.4, t.panelAlpha * 0.62) + ')';
    const kpiInk = c.kpiInk || '#ffffff';
    return ':root {\n' + vars +
      '\n  --panel-border: ' + t.panelBorder + 'px;\n  --card-fill: ' + cardA + ';\n' +
      '  --brand-soft: ' + brandSoft + ';\n  --brand-softer: ' + brandSofter + ';\n' +
      '  --grid-head: ' + headBg + ';\n  --btn-face: ' + cardA + ';\n}\n' +
      'body { background: ' + c.bg + '; color: ' + c.ink + '; }\n' +
      '.card, .dialog-shell, .dialog-toolbar, .year-card, .editor-sheet, .checklist-paper { background: ' + cardA + '; }\n' +
      '.topnav { background: ' + cardA + '; border-bottom-color: ' + c.line + '; }\n' +
      '.btn, .button, .icon-button, .segmented button, .month-checklist-button, .small-button {\n' +
      '  background: ' + cardA + '; color: ' + c.brand + '; border-color: ' + c.brand + ';\n}\n' +
      '.btn.primary, .button-primary, .segmented button.active {\n' +
      '  background: ' + c.brand + '; color: ' + kpiInk + '; border-color: ' + c.brand + ';\n}\n' +
      '.btn.ghost, .button-quiet { background: ' + cardA + '; color: ' + c.brand + '; }\n' +
      '.date-controls select, .date-controls input, .field input, .field select, .field textarea,\n' +
      '.item-row input, .item-row select, .section-title-input, .comment-field textarea {\n' +
      '  background: ' + cardA + '; color: ' + c.ink + '; border-color: ' + c.line + ';\n}\n' +
      '.calendar-heading { background: ' + headBg + '; color: ' + c.muted + '; }\n' +
      '.calendar-heading.week-heading { color: ' + c.brand + '; }\n' +
      '.week-slot:hover, .day-cell:hover, .year-month-button:hover { background: ' + brandSofter + '; }\n' +
      '.week-slot.has-checklist, .day-cell.has-checklist { background: ' + brandSoft + '; }\n' +
      '.day-checklist-card { background: ' + cardA + '; border-color: ' + c.line + '; color: ' + c.ink + '; }\n';
  }

  let styleEl = null;
  function apply(theme) {
    const head = document.head || document.getElementsByTagName('head')[0];
    if (!head) return;
    if (!styleEl || !styleEl.isConnected) {
      styleEl = document.getElementById('calendar-theme') ||
        (function () { const s = document.createElement('style'); s.id = 'calendar-theme'; return s; })();
      head.appendChild(styleEl);
    }
    styleEl.textContent = css(theme);
  }

  function readStored() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  }

  function get() { return normalize(readStored()); }

  function sameTheme(a, b) {
    return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
  }

  function persist(theme, pushRemote) {
    const t = normalize(theme);
    apply(t);
    try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* quota */ }
    if (pushRemote !== false) {
      fetch('/api/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(t)
      }).catch(() => {});
    }
    return t;
  }

  function save(theme) { return persist(theme, true); }

  function reset() {
    apply(defaults());
    try { localStorage.removeItem(KEY); } catch { /* */ }
    fetch('/api/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(defaults())
    }).catch(() => {});
    return defaults();
  }

  async function pullRemote() {
    try {
      const resp = await fetch('/api/theme', { cache: 'no-store' });
      if (!resp.ok) return get();
      const body = await resp.json();
      if (!body || !body.theme) return get();
      const next = normalize(body.theme);
      if (!sameTheme(next, get())) persist(next, false);
      return next;
    } catch {
      return get();
    }
  }

  function themeFromHash() {
    const raw = String(location.hash || '');
    const match = /(?:^|#|&)rs-theme=([^&]+)/.exec(raw);
    if (!match) return null;
    try {
      return JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(match[1])))));
    } catch (e) {
      try { return JSON.parse(decodeURIComponent(match[1])); } catch (e2) { return null; }
    }
  }

  function load() {
    const fromHash = themeFromHash();
    if (fromHash) persist(fromHash, true);
    else apply(get());
    pullRemote();
  }

  load();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  setInterval(pullRemote, 2000);

  window.CalendarTheme = {
    TOKENS: TOKENS, defaults: defaults, normalize: normalize, css: css,
    apply: apply, get: get, save: save, reset: reset, load: load, pullRemote: pullRemote,
    hexToRgb: hexToRgb, KEY: KEY
  };
})();
