(function(){
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- печатающаяся строка в заголовке --- */
  var typeEl = document.querySelector('.h1-type');
  if (typeEl){
    var full = typeEl.getAttribute('data-type') || '';
    var caret = typeEl.querySelector('.caret');
    if (reduced){
      typeEl.insertBefore(document.createTextNode(full), caret);
      caret.classList.add('done');
    } else {
      var i = 0;
      var tick = function(){
        if (i <= full.length){
          typeEl.firstChild && typeEl.firstChild.nodeType === 3
            ? (typeEl.firstChild.nodeValue = full.slice(0, i))
            : typeEl.insertBefore(document.createTextNode(full.slice(0, i)), caret);
          i++;
          setTimeout(tick, 62 + Math.round(i % 3) * 18);
        } else {
          caret.classList.add('done');
        }
      };
      setTimeout(tick, 620);
    }
  }

  /* --- кольцо: бегущая строка по буквам, без наложений ---
     Раньше строка лежала на textPath вдоль сильно сплюснутого эллипса,
     и у левого и правого краёв глифы вставали почти вертикально и
     наезжали друг на друга. Теперь каждая буква ставится сама:
     угол шага равен ширине буквы / радиус, а сама буква сжимается по
     горизонтали ровно во столько же раз (|cos|). Ширина и просвет
     сжимаются синхронно, поэтому наложение невозможно нигде. --- */
  var cr = document.querySelector('.crystal-ring');
  if (cr){
    var SVGNS = 'http://www.w3.org/2000/svg';
    var gBack  = cr.querySelector('.cr-txt-back');
    var gFront = cr.querySelector('.cr-txt-front');
    var R = 424, RY = 108;      // полуоси кольца
    var DEPTH = 0.08;           // насколько ближняя половина крупнее
    var FIT = 0.93;             // запас, чтобы перспектива не съела просвет
    var SPEED = 0.115;          // радиан в секунду
    var PHRASE = 'РУПОР · МАРКЕТИНГ БУДУЩЕГО · ';
    var TWO = Math.PI * 2, DEG = 180 / Math.PI;

    var meas = document.createElementNS(SVGNS, 'text');
    meas.setAttribute('y', '-4000');
    meas.setAttribute('visibility', 'hidden');
    cr.appendChild(meas);

    var glyphs = [];

    function build(){
      // ширины префиксов дают точные слоты с учётом трекинга
      var pre = [0], i;
      for (i = 1; i <= PHRASE.length; i++){
        meas.textContent = PHRASE.slice(0, i).replace(/ /g, ' ');
        pre.push(meas.getComputedTextLength());
      }
      var W = pre[PHRASE.length];
      if (!(W > 10)) return false;

      var reps = Math.max(1, Math.round(TWO * R / W));
      var f = TWO * R / (reps * W);          // подгоняем под целое число повторов

      while (glyphs.length){
        var old = glyphs.pop().el;
        if (old.parentNode) old.parentNode.removeChild(old);
      }

      for (var r = 0; r < reps; r++){
        for (var c = 0; c < PHRASE.length; c++){
          var ch = PHRASE.charAt(c);
          if (ch === ' ') continue;
          var slot = (pre[c + 1] - pre[c]) * f;
          var mid  = (r * W + pre[c]) * f + slot / 2;
          var el = document.createElementNS(SVGNS, 'text');
          el.setAttribute('text-anchor', 'middle');
          el.textContent = ch;
          gFront.appendChild(el);
          glyphs.push({ el: el, a: mid / R, s: f * FIT, half: 1, op: -1 });
        }
      }
      return true;
    }

    var ready = build();
    if (document.fonts && document.fonts.ready){
      document.fonts.ready.then(function(){ build(); ready = true; });
    }

    var halo = cr.querySelector('.cr-haloC');
    var sphere = cr.querySelector('.cr-sphere');
    var rings = cr.querySelectorAll('.cr-ring');

    function paint(t){
      var spin = t * SPEED;
      for (var i = 0; i < glyphs.length; i++){
        var g = glyphs[i];
        var th = g.a + spin;
        var co = Math.cos(th), si = Math.sin(th);
        var sx = Math.abs(co);                       // сжатие по горизонтали
        var half = co > 0 ? 1 : 0;                   // 1 — перед шаром
        if (half !== g.half){
          g.half = half;
          (half ? gFront : gBack).appendChild(g.el);
        }
        var op = sx < 0.11 ? 0 : Math.min(1, (sx - 0.11) / 0.24);
        if (!half) op *= 0.46;
        var p = g.s * (1 + DEPTH * co);
        var rot = Math.atan2(-RY * si, R * (sx || 1e-4)) * DEG;
        g.el.setAttribute('transform',
          'translate(' + (R * si).toFixed(2) + ' ' + (RY * co).toFixed(2) + ') ' +
          'rotate(' + rot.toFixed(2) + ') ' +
          'scale(' + (sx * p).toFixed(4) + ' ' + p.toFixed(4) + ')');
        if (Math.abs(op - g.op) > 0.008){
          g.op = op;
          g.el.setAttribute('opacity', op.toFixed(3));
        }
      }
    }

    function frame(now){
      var t = now / 1000;
      if (!reduced) paint(t);
      var bob = reduced ? 0 : Math.sin(t * 0.62) * 6;
      var sc  = reduced ? 1 : 1 + Math.sin(t * 0.44) * 0.004;
      if (sphere) sphere.setAttribute('transform',
        'translate(540 ' + (545 + bob).toFixed(2) + ') scale(' + sc.toFixed(5) + ') translate(-540 -540)');
      for (var r = 0; r < rings.length; r++){
        rings[r].setAttribute('transform',
          'translate(540 ' + (550 + bob * 0.5).toFixed(2) + ') rotate(-14) scale(' + sc.toFixed(5) + ')');
      }
      if (halo) halo.setAttribute('opacity', (0.5 + Math.sin(t * 0.5) * 0.07).toFixed(3));
      raf = window.requestAnimationFrame(frame);
    }

    var raf;
    if (reduced){
      paint(0);
      frame(0);
      window.cancelAnimationFrame(raf);
    } else {
      raf = window.requestAnimationFrame(frame);
      document.addEventListener('visibilitychange', function(){
        if (document.hidden){ window.cancelAnimationFrame(raf); }
        else { raf = window.requestAnimationFrame(frame); }
      });
    }
  }

  /* --- бургер: меню на узких экранах --- */
  var hdr = document.querySelector('.hdr');
  var burger = document.getElementById('burger');
  var navEl = document.getElementById('nav');
  if (hdr && burger && navEl){
    var setMenu = function(open){
      hdr.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    burger.addEventListener('click', function(e){
      e.stopPropagation();
      setMenu(!hdr.classList.contains('open'));
    });
    navEl.addEventListener('click', function(e){
      if (e.target.closest('a')) setMenu(false);
    });
    document.addEventListener('click', function(e){
      if (!hdr.classList.contains('open')) return;
      if (!e.target.closest('.hdr-in')) setMenu(false);
    });
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' && hdr.classList.contains('open')){ setMenu(false); burger.focus(); }
    });
    window.addEventListener('resize', function(){
      if (window.innerWidth > 1080) setMenu(false);
    });
  }

  /* --- вкладки чата --- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  function select(tab){
    tabs.forEach(function(t){
      var on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      var panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    var strip = tab.parentElement;
    if (strip && strip.scrollWidth > strip.clientWidth + 2){
      var tr = tab.getBoundingClientRect(), sr = strip.getBoundingClientRect();
      if (tr.left < sr.left || tr.right > sr.right){
        strip.scrollTo({ left: strip.scrollLeft + (tr.left - sr.left) - (sr.width - tr.width) / 2, behavior: 'smooth' });
      }
    }
  }
  tabs.forEach(function(t, i){
    t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1;
    t.addEventListener('click', function(){ select(t); });
    t.addEventListener('keydown', function(e){
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var next = tabs[(i + d + tabs.length) % tabs.length];
      next.focus(); select(next);
    });
  });

  /* --- магический шар медленно плывёт за скроллом --- */
  var ball = document.querySelector('.kernel-ball');
  if (ball && !reduced){
    var ticking = false;
    var move = function(){
      var y = Math.max(-160, Math.min(160, -window.scrollY * 0.045));
      ball.style.setProperty('--kernel-y', y.toFixed(1) + 'px');
      ticking = false;
    };
    window.addEventListener('scroll', function(){
      if (!ticking){ ticking = true; window.requestAnimationFrame(move); }
    }, { passive: true });
    move();
  }

  /* --- появление секций --- */
  var items = document.querySelectorAll('.rv');
  if (!('IntersectionObserver' in window)) {
    items.forEach(function(el){ el.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if (en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
  items.forEach(function(el, i){
    el.style.transitionDelay = Math.min(i % 6, 5) * 60 + 'ms';
    io.observe(el);
  });
})();
