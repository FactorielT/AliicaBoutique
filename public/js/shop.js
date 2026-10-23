(function () {
  'use strict';
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var fcfa = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' CFA'; };

  function toast(html) {
    var t = $('#toast'); if (!t) return;
    t.innerHTML = html; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, 3500);
  }

  // En-tête collant
  var header = $('#header');
  window.addEventListener('scroll', function () { if (header) header.classList.toggle('scrolled', window.scrollY > 10); });

  // Ouvrir / fermer (menu, recherche)
  $$('[data-ouvrir]').forEach(function (b) {
    b.addEventListener('click', function () {
      var el = document.getElementById(b.dataset.ouvrir); el.classList.add('open');
      var i = $('input', el); if (i) setTimeout(function () { i.focus(); }, 50);
    });
  });
  $$('[data-fermer]').forEach(function (b) { b.addEventListener('click', function () { document.getElementById(b.dataset.fermer).classList.remove('open'); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $$('.open').forEach(function (x) { x.classList.remove('open'); }); });

  // Diaporama
  $$('[data-slider]').forEach(function (sl) {
    var slides = $$('.slide', sl), dots = $$('.dots button', sl), i = 0, timer;
    if (slides.length < 2) return;
    function go(n) {
      slides[i].classList.remove('actif'); if (dots[i]) dots[i].classList.remove('actif');
      i = (n + slides.length) % slides.length;
      slides[i].classList.add('actif'); if (dots[i]) dots[i].classList.add('actif');
    }
    function auto() { clearInterval(timer); timer = setInterval(function () { go(i + 1); }, 6000); }
    dots.forEach(function (d, k) { d.addEventListener('click', function () { go(k); auto(); }); });
    var x0 = null;
    sl.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    sl.addEventListener('touchend', function (e) { if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) { go(i + (dx < 0 ? 1 : -1)); auto(); } x0 = null; });
    auto();
  });

  // Onglets
  $$('[data-onglets]').forEach(function (b) {
    var btns = $$('.onglets button', b), tabs = $$('.tab', b);
    btns.forEach(function (btn, k) {
      btn.addEventListener('click', function () {
        btns.forEach(function (x) { x.classList.remove('actif'); }); tabs.forEach(function (x) { x.classList.remove('actif'); });
        btn.classList.add('actif'); tabs[k].classList.add('actif');
      });
    });
  });

  // Carrousels
  $$('.carrousel').forEach(function (c) {
    var rail = $('.rail', c);
    $('.fleche.g', c).addEventListener('click', function () { rail.scrollBy({ left: -rail.clientWidth * 0.8, behavior: 'smooth' }); });
    $('.fleche.d', c).addEventListener('click', function () { rail.scrollBy({ left: rail.clientWidth * 0.8, behavior: 'smooth' }); });
  });

  // Favoris (stockés dans le navigateur)
  function getFav() { try { return JSON.parse(localStorage.getItem('aliica_favoris') || '[]'); } catch (e) { return []; } }
  function setFav(f) { try { localStorage.setItem('aliica_favoris', JSON.stringify(f)); } catch (e) { /* ignore */ } majFav(); }
  function majFav() {
    var f = getFav(); var b = $('#nbFavoris');
    if (b) { b.textContent = f.length; b.style.display = f.length ? 'flex' : 'none'; }
    $$('[data-favori]').forEach(function (x) { x.classList.toggle('on', f.indexOf(Number(x.dataset.favori)) > -1); });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-favori]'); if (!b) return;
    e.preventDefault();
    var id = Number(b.dataset.favori), f = getFav(), k = f.indexOf(id);
    if (k > -1) { f.splice(k, 1); toast('Retiré des favoris'); } else { f.push(id); toast('Ajouté aux favoris ♥ <a href="/favoris">Voir</a>'); }
    setFav(f);
    if ($('#grilleFavoris') && k > -1) { b.closest('.carte').remove(); if (!getFav().length) $('#favorisVide').style.display = 'block'; }
  });
  majFav();

  var grille = $('#grilleFavoris');
  if (grille) {
    var ids = getFav();
    if (!ids.length) $('#favorisVide').style.display = 'block';
    else fetch('/api/produits?ids=' + ids.join(',')).then(function (r) { return r.json(); }).then(function (ps) {
      if (!ps.length) { $('#favorisVide').style.display = 'block'; return; }
      grille.innerHTML = ps.map(function (p) {
        var esc = function (s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
        return '<div class="carte"><div class="visuel"><a href="/produit/' + p.slug + '" class="photo"><img class="img1" src="' + (p.image_id ? '/img/' + p.image_id : '/static/img/placeholder.svg') + '" alt=""></a>' +
          '<button class="coeur on" data-favori="' + p.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.3"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg></button></div>' +
          '<div class="meta">' + esc(p.categorie) + '</div><a href="/produit/' + p.slug + '"><h3 class="nom">' + esc(p.nom) + '</h3></a>' +
          '<div class="prix">' + fcfa(p.prix) + (p.prix_promo ? '<del>' + fcfa(p.prix_vente) + '</del>' : '') + '</div></div>';
      }).join('');
    });
  }

  // Filtres catalogue : envoi automatique
  $$('[data-auto]').forEach(function (el) { el.addEventListener('change', function () { var f = el.form; var p = f.querySelector('[name=page]'); if (p) p.remove(); f.submit(); }); });

  // Fiche produit : sélection de variante
  var form = $('#formAchat');
  if (form) {
    var variantes = JSON.parse(form.dataset.variantes || '[]');
    var choix = {};
    var axes = $$('.pastilles', form).map(function (p) { return p.dataset.axe; });
    var dispo = $('#dispo'), btn = $('#btnAjout'), hid = $('#varianteId');
    function trouver() {
      return variantes.filter(function (v) { return axes.every(function (a) { return !choix[a] || v[a] === choix[a]; }); });
    }
    function maj() {
      // désactive les options sans stock
      $$('.pastilles', form).forEach(function (p) {
        var axe = p.dataset.axe;
        $$('button', p).forEach(function (b) {
          var test = Object.assign({}, choix); test[axe] = b.dataset.val;
          var ok = variantes.some(function (v) { return v.stock > 0 && axes.every(function (a) { return !test[a] || v[a] === test[a]; }); });
          b.disabled = !ok; b.classList.toggle('actif', choix[axe] === b.dataset.val);
        });
      });
      var complet = axes.every(function (a) { return choix[a]; });
      var res = trouver();
      if (!axes.length) res = variantes;
      if ((complet || !axes.length) && res.length === 1) {
        var v = res[0]; hid.value = v.id;
        if (v.stock <= 0) { dispo.textContent = 'Rupture de stock'; dispo.className = 'dispo faible'; btn.disabled = true; }
        else { dispo.textContent = v.stock <= 3 ? 'Plus que ' + v.stock + ' pièce(s) disponible(s) !' : 'En stock'; dispo.className = 'dispo' + (v.stock <= 3 ? ' faible' : ''); btn.disabled = false; }
      } else {
        hid.value = ''; btn.disabled = false;
        var total = variantes.reduce(function (a, v) { return a + v.stock; }, 0);
        dispo.textContent = total <= 0 ? 'Rupture de stock' : 'Choisissez ' + axes.filter(function (a) { return !choix[a]; }).map(function (a) { return 'une ' + a; }).join(' et ');
        if (total <= 0) btn.disabled = true;
      }
    }
    $$('.pastilles button', form).forEach(function (b) {
      b.addEventListener('click', function () {
        var axe = b.parentNode.dataset.axe;
        choix[axe] = choix[axe] === b.dataset.val ? null : b.dataset.val; maj();
      });
    });
    $$('[data-qte]', form).forEach(function (b) {
      b.addEventListener('click', function () { var q = $('#quantite'); q.value = Math.max(1, (parseInt(q.value, 10) || 1) + Number(b.dataset.qte)); });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!hid.value) { dispo.textContent = 'Veuillez choisir ' + axes.filter(function (a) { return !choix[a]; }).join(' et ') + '.'; dispo.className = 'dispo faible'; return; }
      btn.disabled = true;
      fetch('/panier/ajouter', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ variante_id: hid.value, quantite: $('#quantite').value }) })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          btn.disabled = false;
          if (r.error) { toast(r.error); return; }
          $('#nbPanier').textContent = r.nb;
          toast('Article ajouté au panier ✓ <a href="/panier">Voir le panier</a>');
        }).catch(function () { btn.disabled = false; toast('Erreur réseau, réessayez.'); });
    });
    // vignettes
    $$('.vignettes img').forEach(function (im) {
      im.addEventListener('click', function () {
        $('#imgPrincipale').src = im.dataset.grand;
        $$('.vignettes img').forEach(function (x) { x.classList.remove('actif'); }); im.classList.add('actif');
      });
    });
    maj();
  }

  // Code promo
  var bp = $('#btnPromo');
  if (bp) {
    var appliquer = function () {
      var code = $('#codePromo').value.trim(); var st = Number($('[data-st]').dataset.st), frais = Number($('[data-frais]').dataset.frais);
      if (!code) { $('#ligneRemise').style.display = 'none'; $('#total').textContent = fcfa(st + frais); $('#msgPromo').textContent = ''; return; }
      fetch('/api/promo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code, telephone: $('#telephone').value }) })
        .then(function (r) { return r.json(); }).then(function (r) {
          if (r.erreur) { $('#msgPromo').textContent = r.erreur; $('#msgPromo').style.color = '#c0392b'; $('#ligneRemise').style.display = 'none'; $('#total').textContent = fcfa(st + frais); return; }
          $('#msgPromo').textContent = 'Code appliqué : -' + r.pourcentage + '%'; $('#msgPromo').style.color = '#2e7d32';
          $('#ligneRemise').style.display = 'flex'; $('#remise').textContent = '− ' + fcfa(r.remise); $('#total').textContent = fcfa(st - r.remise + frais);
        });
    };
    bp.addEventListener('click', appliquer);
    if ($('#codePromo').value) appliquer();
  }

  // Newsletter en AJAX
  $$('[data-ajax-newsletter]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      fetch('/newsletter', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ email: f.email.value }) })
        .then(function (r) { return r.json(); }).then(function (r) { toast(r.msg); f.reset(); });
    });
  });
})();
