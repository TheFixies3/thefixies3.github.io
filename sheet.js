// Language switch, translucent bar edge, and the story sheet.
// The sheet is driven by a small spring (damping ratio + response, Apple-style):
// it tracks the finger 1:1, can be grabbed mid-flight, keeps the release velocity,
// and projects momentum to decide whether to close.

(function () {
  'use strict';

  var root = document.documentElement;

  // ---------- Language ----------
  document.querySelectorAll('[data-set]').forEach(function (b) {
    b.addEventListener('click', function () {
      var l = b.getAttribute('data-set');
      root.lang = l;
      try { localStorage.setItem('lang', l); } catch (e) {}
    });
  });

  // ---------- Bar scroll edge ----------
  var bar = document.getElementById('bar');
  function onScroll() { bar.classList.toggle('scrolled', window.scrollY > 4); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- Spring ----------
  // response: seconds to (roughly) reach the target; damping: 1 = no overshoot.
  function Spring(value, onUpdate) {
    this.x = value; this.v = 0; this.target = value;
    this.onUpdate = onUpdate; this.onRest = null; this.raf = 0;
    this.step = this.step.bind(this);
  }
  Spring.prototype.to = function (target, opts) {
    opts = opts || {};
    var response = opts.response || 0.4, damping = opts.damping == null ? 1 : opts.damping;
    this.target = target;
    if (opts.velocity != null) this.v = opts.velocity;   // velocity handoff from the gesture
    this.k = Math.pow(2 * Math.PI / response, 2);
    this.c = 4 * Math.PI * damping / response;
    this.onRest = opts.onRest || null;
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.step); }
  };
  Spring.prototype.step = function (now) {
    var dt = Math.min((now - this.last) / 1000, 1 / 30);
    this.last = now;
    var n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (var i = 0; i < n; i++) {
      var a = -this.k * (this.x - this.target) - this.c * this.v;
      this.v += a * h; this.x += this.v * h;
    }
    if (Math.abs(this.v) < 1 && Math.abs(this.x - this.target) < 0.5) {
      this.x = this.target; this.v = 0; this.raf = 0;
      this.onUpdate(this.x);
      if (this.onRest) { var r = this.onRest; this.onRest = null; r(); }
      return;
    }
    this.onUpdate(this.x);
    this.raf = requestAnimationFrame(this.step);
  };
  // Interrupt: stop where it is on screen, keep the live value.
  Spring.prototype.stop = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0; this.onRest = null;
  };
  Spring.prototype.set = function (x) { this.stop(); this.x = x; this.v = 0; this.onUpdate(x); };

  // Apple's projection: where a flick would come to rest.
  function project(v, rate) {
    rate = rate || 0.998;
    return (v / 1000) * rate / (1 - rate);
  }
  // Progressive resistance past a boundary.
  function rubberband(over, dim, c) {
    c = c || 0.55;
    return (over * dim * c) / (dim + c * Math.abs(over));
  }

  // ---------- Sheet ----------
  var sheet = document.getElementById('sheet');
  var scrim = document.getElementById('scrim');
  var grab = document.getElementById('grab');
  var body = document.getElementById('sheet-body');
  var titleEl = document.getElementById('sheet-title');
  var noEl = document.getElementById('sheet-no');
  var app = document.getElementById('app');
  var closeBtn = document.getElementById('sheet-close');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  var H = 0;            // distance from open (0) to fully hidden
  var isOpen = false;
  var opener = null;

  function render(y) {
    var p = H ? Math.min(1, Math.max(0, 1 - y / H)) : 0;   // 1 = open
    sheet.style.transform = 'translate3d(0,' + y + 'px,0)';
    scrim.style.opacity = p;
    // Push the page back a little while the sheet is up (dim to focus)
    var s = 1 - 0.035 * p;
    app.style.transform = p > 0.001 ? 'scale(' + s + ')' : '';
    app.style.borderRadius = p > 0.001 ? (14 * p) + 'px' : '';
  }
  var spring = new Spring(0, render);

  function fill(id) {
    var t = document.getElementById(id);
    if (!t) return false;
    var frag = t.content.cloneNode(true);
    noEl.innerHTML = frag.querySelector('[data-no]').innerHTML;
    titleEl.innerHTML = frag.querySelector('[data-title]').innerHTML;
    body.innerHTML = '';
    body.appendChild(frag.querySelector('[data-body]'));
    body.scrollTop = 0;
    return true;
  }

  function open(id, from) {
    if (!fill(id)) return;
    opener = from || null;
    var wasOpen = isOpen;
    isOpen = true;
    scrim.hidden = false; sheet.hidden = false;
    document.body.classList.add('locked');
    app.style.transformOrigin = '50% ' + (window.scrollY + window.innerHeight / 2) + 'px';
    H = sheet.getBoundingClientRect().height + 24;

    if (reduce.matches) {
      sheet.style.opacity = 0; render(0);
      requestAnimationFrame(function () { sheet.style.opacity = 1; });
    } else if (!wasOpen && !spring.raf) {
      spring.set(H);
      spring.to(0, { damping: 1, response: 0.4 });
    } else {
      // Already moving (e.g. reopened while closing): continue from where it is.
      spring.to(0, { damping: 1, response: 0.4 });
    }
    closeBtn.focus({ preventScroll: true });
  }

  function finishClose() {
    scrim.hidden = true; sheet.hidden = true;
    app.style.transform = ''; app.style.borderRadius = '';
    document.body.classList.remove('locked');
    if (opener) opener.focus({ preventScroll: true });
  }

  function close(velocity) {
    if (!isOpen) return;
    isOpen = false;
    if (reduce.matches) {
      sheet.style.opacity = 0; scrim.style.opacity = 0;
      setTimeout(function () { if (!isOpen) { sheet.style.opacity = ''; render(H); finishClose(); } }, 200);
      return;
    }
    spring.to(H, { damping: 1, response: 0.35, velocity: velocity, onRest: function () { if (!isOpen) finishClose(); } });
  }

  document.querySelectorAll('[data-open]').forEach(function (b) {
    b.addEventListener('click', function () { open(b.getAttribute('data-open'), b); });
  });
  closeBtn.addEventListener('click', function () { close(); });
  scrim.addEventListener('click', function () { close(); });
  document.addEventListener('keydown', function (e) {
    if (!isOpen) return;
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      // Keep focus inside the sheet
      var f = sheet.querySelectorAll('button, a[href]');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener('resize', function () {
    if (!sheet.hidden) H = sheet.getBoundingClientRect().height + 24;
  });

  // ---------- Drag ----------
  var drag = null;

  grab.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || e.target.closest('button')) return;
    spring.stop();                                   // grab it mid-flight
    try { grab.setPointerCapture(e.pointerId); } catch (err) {}
    drag = {
      id: e.pointerId,
      startY: e.clientY,
      offset: e.clientY - spring.x,                  // respect where it was grabbed
      active: false,
      hist: [{ t: e.timeStamp, y: spring.x }]
    };
  });

  grab.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active) {
      if (Math.abs(e.clientY - drag.startY) < 6) return;   // small hysteresis
      drag.active = true;
      drag.offset = e.clientY - spring.x;
    }
    var y = e.clientY - drag.offset;
    if (y < 0) y = rubberband(y, window.innerHeight);       // soft top boundary
    spring.x = y; spring.v = 0; render(y);
    drag.hist.push({ t: e.timeStamp, y: y });
    if (drag.hist.length > 6) drag.hist.shift();
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag; drag = null;
    if (!d.active) {
      // Tap on the handle area: settle back if it was interrupted mid-flight
      if (isOpen) spring.to(0, { damping: 1, response: 0.4 });
      else spring.to(H, { damping: 1, response: 0.35, onRest: finishClose });
      return;
    }
    var a = d.hist[0], b = d.hist[d.hist.length - 1];
    var dt = (b.t - a.t) / 1000;
    var v = dt > 0 ? (b.y - a.y) / dt : 0;                  // px/s
    var projected = spring.x + project(v);
    if (projected > H * 0.45 || v > 1200) {
      isOpen = true; close(v);
    } else {
      isOpen = true;
      // It was flung back up: a little bounce, because the gesture carried momentum
      spring.to(0, { damping: Math.abs(v) > 300 ? 0.8 : 1, response: 0.35, velocity: v });
    }
  }
  grab.addEventListener('pointerup', endDrag);
  grab.addEventListener('pointercancel', endDrag);
})();
