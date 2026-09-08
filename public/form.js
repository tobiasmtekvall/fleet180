/* Klientlogik för säkerhetskontrollen.
   Bilder krymps i webbläsaren innan de skickas, så en mobilkamera på
   4-6 MB blir ~200-400 kB i databasen. Utan JavaScript fungerar
   formuläret ändå - då postas filerna i originalstorlek. */
(function () {
  'use strict';

  var MAX_EDGE = 1600;      // px, längsta sidan
  var JPEG_QUALITY = 0.82;
  var MAX_PER_FIELD = 6;

  var form = document.getElementById('checkForm');
  if (!form) return;
  var notice = document.getElementById('notice');
  var submitBtn = document.getElementById('submitBtn');
  var store = {};           // fältnamn -> [{blob, name}]

  function showNotice(msg) {
    notice.textContent = msg;
    notice.classList.add('show');
    notice.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function hideNotice() { notice.classList.remove('show'); }

  /* ---- kamera / filväljare ---- */
  Array.prototype.forEach.call(document.querySelectorAll('.camera-btn'), function (btn) {
    var input = document.getElementById(btn.dataset.target);
    store[input.name] = [];
    btn.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = '';
      files.forEach(function (file) {
        if (!/^image\//.test(file.type)) return;
        if (store[input.name].length >= MAX_PER_FIELD) {
          showNotice('Max ' + MAX_PER_FIELD + ' bilder per fråga.');
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
  function validate() {
    var firstBad = null;
    Array.prototype.forEach.call(form.querySelectorAll('input[required]'), function (inp) {
      var bad = !inp.value.trim();
      inp.classList.toggle('invalid', bad);
      var err = inp.parentNode.querySelector('.err');
      if (err) err.classList.toggle('show', bad);
      if (bad && !firstBad) firstBad = inp;
    });
    if (firstBad) {
      firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      firstBad.focus({ preventScroll: true });
      return false;
    }
    return true;
  }

  Array.prototype.forEach.call(form.querySelectorAll('input[required]'), function (inp) {
    inp.addEventListener('input', function () {
      if (inp.value.trim()) {
        inp.classList.remove('invalid');
        var err = inp.parentNode.querySelector('.err');
        if (err) err.classList.remove('show');
      }
    });
  });

  /* ---- skicka ---- */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hideNotice();
    if (!validate()) return;

    var fd = new FormData();
    Array.prototype.forEach.call(form.querySelectorAll('input[type="text"]'), function (inp) {
      fd.append(inp.name, inp.value.trim());
    });
    Object.keys(store).forEach(function (field) {
      store[field].forEach(function (entry, i) {
        fd.append(field, entry.blob, (field + '-' + (i + 1) + '.jpg'));
      });
    });

    submitBtn.disabled = true;
    submitBtn.textContent = 'Skickar…';

    fetch(form.action, {
      method: 'POST',
      body: fd,
      headers: { 'Accept': 'application/json' }
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'Serverfel ' + r.status }; });
    }).then(function (data) {
      if (data && data.ok && data.redirect) {
        window.location.href = data.redirect;
        return;
      }
      throw new Error((data && data.error) || 'Okänt fel');
    }).catch(function (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Bekräfta och skicka';
      showNotice('Kunde inte skicka kontrollen: ' + err.message +
        '. Kontrollera nätverket och försök igen.');
    });
  });

  document.getElementById('printBtn').addEventListener('click', function () { window.print(); });

  document.getElementById('clearBtn').addEventListener('click', function () {
    form.reset();
    Object.keys(store).forEach(function (k) { store[k] = []; });
    Array.prototype.forEach.call(document.querySelectorAll('.thumbs'), function (t) { t.innerHTML = ''; });
    Array.prototype.forEach.call(form.querySelectorAll('.invalid'), function (i) { i.classList.remove('invalid'); });
    Array.prototype.forEach.call(form.querySelectorAll('.err.show'), function (i) { i.classList.remove('show'); });
    hideNotice();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();
