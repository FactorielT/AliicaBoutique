(function () {
  'use strict';
  // Confirmation avant envoi
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) { if (!confirm(f.dataset.confirm)) e.preventDefault(); });
  });
  document.querySelectorAll('[data-confirm-btn]').forEach(function (b) {
    b.addEventListener('click', function (e) { if (!confirm(b.dataset.confirmBtn)) e.preventDefault(); });
  });

  // Interrupteurs instantanés (publication, activation…)
  document.querySelectorAll('[data-toggle-url]').forEach(function (cb) {
    cb.addEventListener('click', function (e) { e.stopPropagation(); });
    cb.addEventListener('change', function () {
      fetch(cb.dataset.toggleUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ valeur: cb.checked }) })
        .then(function (r) { if (!r.ok) throw new Error(); })
        .catch(function () { cb.checked = !cb.checked; alert('Erreur, veuillez réessayer.'); });
    });
  });

  // Aperçu d'image avant envoi
  document.querySelectorAll('input[type=file][data-apercu]').forEach(function (inp) {
    inp.addEventListener('change', function () {
      var f = inp.files[0]; if (!f) return;
      var url = URL.createObjectURL(f);
      inp.dataset.apercu.split(',').forEach(function (id) { var im = document.getElementById(id); if (im) { im.src = url; im.style.display = 'block'; } });
    });
  });
  document.querySelectorAll('input[type=file][data-apercu-multi]').forEach(function (inp) {
    inp.addEventListener('change', function () {
      var c = document.getElementById(inp.dataset.apercuMulti); c.innerHTML = '';
      Array.prototype.forEach.call(inp.files, function (f) {
        var d = document.createElement('div'); d.className = 'im'; d.innerHTML = '<img alt="">'; d.firstChild.src = URL.createObjectURL(f); c.appendChild(d);
      });
    });
  });

  // Aperçu en direct (diaporama)
  document.querySelectorAll('[data-live]').forEach(function (inp) {
    inp.addEventListener('input', function () { var el = document.getElementById(inp.dataset.live); if (el) el.textContent = inp.value; });
  });
  document.querySelectorAll('[data-live-bg]').forEach(function (inp) {
    inp.addEventListener('input', function () { var el = document.getElementById(inp.dataset.liveBg); if (el) el.style.background = inp.value; });
  });
})();
