/* Klientlogik för säkerhetskontrollen.
   Bilder krymps i webbläsaren innan de skickas, så en mobilkamera på
   4-6 MB blir ~200-400 kB i databasen. Utan JavaScript fungerar
   formuläret ändå - då postas filerna i originalstorlek och
   kommentarsrutorna syns hela tiden. */
(function () {
  'use strict';

  var MAX_EDGE = 1600;      // px, längsta sidan
  var JPEG_QUALITY = 0.82;
  var MAX_PER_FIELD = 6;
  var COMMENT_FALLBACK = { nej: true, annat: true };

  var form = document.getElementById('checkForm') || document.getElementById('previewForm');
  if (!form) return;
  var preview = form.id === 'previewForm';
  var notice = document.getElementById('notice');
  var submitBtn = document.getElementById('submitBtn');
  var langField = document.getElementById('langField');
  var store = {};           // fältnamn -> [{blob, name}]

  var UI = window.FLEET180_UI || {};
  var LANGS = window.FLEET180_LANGS || [{ code: 'sv', dir: 'ltr', htmlLang: 'sv' }];
  var lang = (langField && langField.value) || 'sv';

  function t(key) { return (UI[lang] && UI[lang][key]) || (UI.sv && UI.sv[key]) || key; }

  /* Flags swap the text that is already in the page (every language sits in
     data-t-<code> attributes) instead of reloading, so half-filled answers,
     photos taken and the scroll position all survive the switch. */
  function applyLang(code) {
    var meta = null;
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) meta = LANGS[i];
    if (!meta) return;
    lang = code;
    if (langField) langField.value = code;

    each(document.querySelectorAll('[data-t-' + code + ']'), function (el) {
      var text = el.getAttribute('data-t-' + code);
      if (text === null) return;
      if (el.tagName === 'INPUT' && el.type === 'text') el.placeholder = text;
      else if (el.tagName === 'LABEL' && el.querySelector('.star')) {
        el.childNodes[0].nodeValue = text;   // keep the required marker
      } else el.textContent = text;
    });

    document.documentElement.lang = meta.htmlLang;
    document.documentElement.dir = meta.dir;
    each(document.querySelectorAll('.flag'), function (b) {
      b.classList.toggle('on', b.dataset.lang === code);
    });
    each(form.querySelectorAll('[data-kind="yesno"]'), function (f) { syncComment(f.dataset.name); });
    try { localStorage.setItem('fleet180.lang', code); } catch (e) { /* privat läge */ }
  }

  each(document.querySelectorAll('.flag'), function (btn) {
    btn.addEventListener('click', function () { applyLang(btn.dataset.lang); });
  });

  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function showNotice(msg) {
    notice.textContent = msg;
    notice.classList.add('show');
    notice.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function hideNotice() { notice.classList.remove('show'); }

  /* ---- Ja / Nej / Annat: kommentarsrutan följer valet ---- */
  function commentBox(name) {
    return form.querySelector('[data-comment-for="' + name + '"]');
  }
  /* Which answers open the comment box is decided per question by the
     server (data-comment-on): "have you damaged the car?" wants the
     description on Ja, "does the lighting work?" on Nej. */
  function opensComment(name, value) {
    var field = form.querySelector('[data-kind="yesno"][data-name="' + name + '"]');
    var list = field && field.dataset.commentOn;
    if (!list) return !!COMMENT_FALLBACK[value];
    return list.split(' ').indexOf(value) > -1;
  }

  function syncComment(name) {
    var box = commentBox(name);
    if (!box) return;
    var checked = form.querySelector('input[name="' + name + '"]:checked');
    var show = checked && opensComment(name, checked.value);
    box.classList.toggle('open', !!show);
    var required = checked && checked.value === 'annat';
    box.querySelector('input').classList.toggle('form-control', true);
    box.querySelector('label').textContent = required ? t('commentRequired') : t('comment');
  }
  each(form.querySelectorAll('[data-kind="yesno"]'), function (field) {
    var name = field.dataset.name;
    syncComment(name);
    each(field.querySelectorAll('input[type="radio"]'), function (radio) {
      radio.addEventListener('change', function () {
        syncComment(name);
        clearError(field);
      });
    });
    var input = commentBox(name) && commentBox(name).querySelector('input');
    if (input) input.addEventListener('input', function () { clearError(field); });
  });

  /* ---- byte av förare -------------------------------------------------
     The vehicle was given to somebody today. If the name in the driver field
     is not that person, the check cannot go in until the driver says they
     have replaced the driver on the route AND names the OC or Fleet Manager
     who allowed the vehicle change. The same rule runs on the server -- this
     half is only so the driver sees it while they are still standing at the
     van, not after pressing send. */
  var changeBox = document.getElementById('changeBox');
  var driverInput = null;
  if (changeBox) {
    /* The question belongs to one field -- the driver's name -- and says so,
       rather than being found by position: a form editor can move the
       question, and "the box after that div" would then watch the wrong one. */
    var driverField = form.querySelector('.field[data-name="' + changeBox.dataset.for + '"]');
    driverInput = driverField &&
      (driverField.querySelector('select') || driverField.querySelector('input[type="text"]'));
  }

  function assignedNames() {
    return (changeBox.dataset.assigned || '').split('|')
      .map(function (n) { return norm(n); }).filter(Boolean);
  }

  /* The assignment can arrive after the page did -- the assigner is run while
     drivers are already in the yard. When the server refuses a submission
     because of that, it says who the vehicle was given to; the question is
     then written into the page in all four languages (the same text the
     server would have rendered) and shown, so the driver answers it and sends
     again instead of meeting an error they cannot act on. */
  function raiseChange(assigned) {
    if (!changeBox || !assigned) return;
    changeBox.dataset.assigned = (assigned.drivers || [assigned.driver || '']).join('|');
    var q = document.getElementById('changeQ');
    var key = assigned.route ? 'changeQuestionRoute' : 'changeQuestion';
    var vars = { assigned: assigned.driver || '', plate: assigned.plate || '', route: assigned.route || '' };
    for (var i = 0; i < LANGS.length; i++) {
      var code = LANGS[i].code;
      var tmpl = (UI[code] && UI[code][key]) || (UI.sv && UI.sv[key]) || '';
      q.setAttribute('data-t-' + code, fillText(tmpl, vars));
    }
    q.textContent = fillText((UI[lang] && UI[lang][key]) || '', vars);
    changeBox.hidden = false;
    changeBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* Same substitution the server does, isolates included: a Latin name or
     plate inside an Arabic sentence keeps its punctuation on the right side. */
  function fillText(str, vars) {
    return String(str).replace(/\{(\w+)\}/g, function (m, k) {
      return (vars[k] === undefined || vars[k] === null) ? m : '\u2068' + vars[k] + '\u2069';
    });
  }
  function norm(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

  function driverDiffers() {
    if (!changeBox || !driverInput) return false;
    var names = assignedNames();
    if (!names.length) return false;         // nothing assigned (yet): nothing to confirm
    var chosen = norm(driverInput.value);
    if (!chosen) return false;               // not filled in yet: its own rule applies
    return names.indexOf(chosen) === -1;
  }

  function syncChange() {
    if (!changeBox) return;
    var show = driverDiffers();
    changeBox.hidden = !show;
    if (!show) {
      clearError(changeBox);
      each(changeBox.querySelectorAll('input[type="radio"]'), function (r) { r.checked = false; });
      changeBox.querySelector('#__change_approver').value = '';
    }
  }

  if (changeBox && driverInput) {
    driverInput.addEventListener('change', function () { syncChange(); });
    driverInput.addEventListener('input', function () { syncChange(); });
    each(changeBox.querySelectorAll('input[type="radio"]'), function (r) {
      r.addEventListener('change', function () { clearError(changeBox); });
    });
    changeBox.querySelector('#__change_approver')
      .addEventListener('input', function () { clearError(changeBox); });
    syncChange();
  }

  /* null when the confirmation is satisfied (or not needed), otherwise the
     message to show. Kept apart from validate() so the same answer can be
     checked before send and reported on the box itself. */
  function changeProblem() {
    if (!changeBox || changeBox.hidden) return null;
    var picked = changeBox.querySelector('input[name="__driver_change"]:checked');
    if (!picked) return t('changeNeedAnswer');
    if (picked.value === 'nej') return t('changeBlocked');
    // Two characters, the same floor the server applies: an initial is not a
    // name, and a client that accepted one would send the driver into a
    // refusal that points at no field.
    if (changeBox.querySelector('#__change_approver').value.trim().length < 2) return t('changeNeedApprover');
    return null;
  }

  /* ---- kamera / filväljare ---- */
  each(document.querySelectorAll('.camera-btn'), function (btn) {
    var input = document.getElementById(btn.dataset.target);
    store[input.name] = [];
    btn.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = '';
      files.forEach(function (file) {
        if (!/^image\//.test(file.type)) return;
        if (store[input.name].length >= MAX_PER_FIELD) {
          showNotice(t('maxPhotos'));
          return;
        }
        shrink(file, function (blob, dataUrl) {
          if (store[input.name].length >= MAX_PER_FIELD) return;
          var entry = { blob: blob, name: file.name || 'foto.jpg' };
          store[input.name].push(entry);
          addThumb(input, entry, dataUrl);
        });
      });
    });
  });

  function addThumb(input, entry, dataUrl) {
    var box = document.getElementById('thumbs-' + input.name);
    var d = document.createElement('div');
    d.className = 'thumb';
    var img = document.createElement('img');
    img.src = dataUrl;
    img.alt = entry.name;
    var x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.title = 'Ta bort';
    x.addEventListener('click', function () {
      var i = store[input.name].indexOf(entry);
      if (i > -1) store[input.name].splice(i, 1);
      d.remove();
    });
    d.appendChild(img); d.appendChild(x);
    box.appendChild(d);
  }

  /* Krymp bilden med canvas. Faller tillbaka på originalfilen om
     något går fel (t.ex. HEIC som webbläsaren inte kan avkoda). */
  function shrink(file, done) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      try {
        var scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale);
        var h = Math.round(img.height * scale);
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        canvas.toBlob(function (blob) {
          URL.revokeObjectURL(url);
          done(blob || file, dataUrl);
        }, 'image/jpeg', JPEG_QUALITY);
      } catch (e) {
        URL.revokeObjectURL(url);
        done(file, url);
      }
    };
    img.onerror = function () { URL.revokeObjectURL(url); done(file, ''); };
    img.src = url;
  }

  /* ---- validering ---- */
  function setError(field, msg) {
    field.classList.add('field-invalid');
    var err = field.querySelector('.err');
    if (err) { err.textContent = msg; err.classList.add('show'); }
    var input = field.querySelector('input[type="text"]');
    if (input && field.dataset.kind === 'text') input.classList.add('invalid');
    var sel = field.querySelector('select');
    if (sel) sel.classList.add('invalid');
  }
  function clearError(field) {
    field.classList.remove('field-invalid');
    var err = field.querySelector('.err');
    if (err) err.classList.remove('show');
    each(field.querySelectorAll('.invalid'), function (i) { i.classList.remove('invalid'); });
  }

  function validate() {
    var firstBad = null;
    each(form.querySelectorAll('.field'), function (field) {
      clearError(field);
      var kind = field.dataset.kind;
      if (kind === 'text') {
        var input = field.querySelector('input[type="text"]');
        if (input && input.hasAttribute('required') && !input.value.trim()) {
          setError(field, t('required'));
          if (!firstBad) firstBad = field;
        }
      } else if (kind === 'select') {
        var sel = field.querySelector('select');
        if (sel && sel.hasAttribute('required') && !sel.value) {
          setError(field, t('chooseError'));
          if (!firstBad) firstBad = field;
        }
      } else if (kind === 'yesno') {
        var name = field.dataset.name;
        var checked = form.querySelector('input[name="' + name + '"]:checked');
        var isRequired = !!field.querySelector('input[data-required="1"]');
        if (!checked) {
          if (isRequired) {
            setError(field, t('chooseYesNo'));
            if (!firstBad) firstBad = field;
          }
        } else if (checked.value === 'annat') {
          var box = commentBox(name);
          var text = box ? box.querySelector('input').value.trim() : '';
          if (!text) {
            setError(field, t('commentNeeded'));
            if (!firstBad) firstBad = field;
          }
        }
      }
    });
    var changeMsg = changeProblem();
    if (changeMsg) {
      setError(changeBox, changeMsg);
      if (!firstBad) firstBad = changeBox;
    }
    if (firstBad) {
      firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var focusable = firstBad.querySelector('input');
      if (focusable) focusable.focus({ preventScroll: true });
      return false;
    }
    return true;
  }

  each(form.querySelectorAll('input[type="text"]'), function (inp) {
    inp.addEventListener('input', function () {
      var field = inp.closest('.field');
      if (field && inp.value.trim()) clearError(field);
    });
  });
  each(form.querySelectorAll('select'), function (sel) {
    sel.addEventListener('change', function () {
      var field = sel.closest('.field');
      if (field && sel.value) clearError(field);
    });
  });

  /* ---- skicka ---- */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hideNotice();
    if (preview) return;
    if (!validate()) return;

    var fd = new FormData();
    each(form.querySelectorAll('input[type="text"]'), function (inp) {
      fd.append(inp.name, inp.value.trim());
    });
    each(form.querySelectorAll('input[type="radio"]:checked'), function (inp) {
      if (inp.name === '__driver_change' && changeBox && changeBox.hidden) return;
      fd.append(inp.name, inp.value);
    });
    each(form.querySelectorAll('select'), function (sel) {
      fd.append(sel.name, sel.value);
    });
    fd.append('__lang', lang);
    Object.keys(store).forEach(function (field) {
      store[field].forEach(function (entry, i) {
        fd.append(field, entry.blob, field + '-' + (i + 1) + '.jpg');
      });
    });

    submitBtn.disabled = true;
    submitBtn.textContent = t('sending');

    fetch(form.action, { method: 'POST', body: fd, headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        return r.json().catch(function () { return { ok: false, error: 'Serverfel ' + r.status }; });
      })
      .then(function (data) {
        if (data && data.ok && data.redirect) { window.location.href = data.redirect; return; }
        if (data && data.needsChangeConfirm) {
          // Not a failure to report and forget: put the question on screen.
          raiseChange(data.assigned);
          setError(changeBox, data.error || t('changeNeedAnswer'));
          submitBtn.disabled = false;
          submitBtn.textContent = t('submit');
          return;
        }
        throw new Error((data && data.error) || 'Okänt fel');
      })
      .catch(function (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = t('submit');
        showNotice(t('sendFailed') + err.message + t('tryAgain'));
      });
  });

  document.getElementById('printBtn').addEventListener('click', function () { window.print(); });

  /* A language chosen on one vehicle's page is the one the next page opens
     in -- a driver picks their language once, not at every check. */
  try {
    var saved = localStorage.getItem('fleet180.lang');
    if (saved && saved !== lang) applyLang(saved);
  } catch (e) { /* privat läge: strunt samma */ }

  document.getElementById('clearBtn').addEventListener('click', function () {
    form.reset();
    Object.keys(store).forEach(function (k) { store[k] = []; });
    each(document.querySelectorAll('.thumbs'), function (t) { t.innerHTML = ''; });
    each(form.querySelectorAll('.field'), clearError);
    each(form.querySelectorAll('[data-kind="yesno"]'), function (f) { syncComment(f.dataset.name); });
    syncChange();
    hideNotice();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();
