const $ = (id) => document.getElementById(id);

function toHex(c) {
  const rgb = window.CalendarTheme ? CalendarTheme.hexToRgb(c) : null;
  if (!rgb) return '#000000';
  return '#' + rgb.map((n) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0')).join('');
}

function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

function renderColors(theme) {
  const wrap = $('themeColors');
  if (!wrap || !window.CalendarTheme) return;
  const tokens = CalendarTheme.TOKENS.filter((t) => t.group !== 'terminal');
  wrap.innerHTML = tokens.map((t) =>
    '<label class="theme-row"><input type="color" data-token="' + t.key + '" value="' +
    toHex(theme.colors[t.key]) + '"><span class="theme-label">' + t.label + '</span></label>').join('');
  wrap.querySelectorAll('input[type=color]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const cur = CalendarTheme.get();
      cur.colors[inp.dataset.token] = inp.value;
      CalendarTheme.save(cur);
    });
  });
}

function refreshTheme() {
  if (!window.CalendarTheme) return;
  const theme = CalendarTheme.get();
  renderColors(theme);
  const slider = $('panelAlpha');
  const out = $('panelAlphaVal');
  const transp = Math.round((1 - theme.panelAlpha) * 100);
  slider.value = String(transp);
  out.textContent = transp + '% clear';
  const border = $('panelBorder');
  const borderOut = $('panelBorderVal');
  const px = theme.panelBorder != null ? theme.panelBorder : 1;
  border.value = String(px);
  borderOut.textContent = px + ' px';
}

$('panelAlpha').addEventListener('input', () => {
  const pct = Number($('panelAlpha').value);
  $('panelAlphaVal').textContent = pct + '% clear';
  const cur = CalendarTheme.get();
  cur.panelAlpha = 1 - pct / 100;
  CalendarTheme.save(cur);
});

$('panelBorder').addEventListener('input', () => {
  const n = Number($('panelBorder').value);
  $('panelBorderVal').textContent = n + ' px';
  const cur = CalendarTheme.get();
  cur.panelBorder = n;
  CalendarTheme.save(cur);
});

$('themeReset').addEventListener('click', () => {
  CalendarTheme.reset();
  refreshTheme();
  toast('Theme reset to defaults.');
});

refreshTheme();
if (window.CalendarTheme && CalendarTheme.pullRemote) {
  CalendarTheme.pullRemote().then(refreshTheme);
  setInterval(refreshTheme, 2000);
}
