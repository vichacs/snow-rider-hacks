/*
 * Snow Rider 3D - Mod Menu
 * Se carga ANTES de UnityLoader.js (ver index.html).
 *   Abrir/cerrar menú: tecla ` (acento grave) o Insert, o el botón ⚙
 *   Velocidad: [ y ]   |   Restablecer velocidad: \
 */
(function () {
  'use strict';
  if (window.__snowMod) return;
  window.__snowMod = true;


  /* ================= Teclado del menú =================
   * Unity captura las teclas y llama a preventDefault, lo que impide escribir
   * en los campos del menú. Este listener se registra antes que el de Unity y
   * corta la propagación (sin cancelar la acción por defecto) cuando el foco
   * está en el menú. */
  function fromMenu(e) {
    var h = document.getElementById('snowmod-host');
    var path = e.composedPath ? e.composedPath() : [];
    return !!h && path.indexOf(h) >= 0;
  }
  ['keydown', 'keyup', 'keypress'].forEach(function (ev) {
    window.addEventListener(ev, function (e) {
      if (e.code === 'Insert') return;
      if (fromMenu(e)) e.stopImmediatePropagation();
    }, true);
  });

  /* ================= Ajustes persistentes ================= */
  var KEY = 'snowrider_modmenu_v1';
  var cfg = { volume: 1, autoAds: false, fps: false, fit: false };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} }
  var state = { speed: 1 };

  /* ================= Reloj virtual (velocidad del juego) =================
   * Unity WebGL calcula deltaTime con performance.now(). Si escalamos ese
   * reloj, todo el juego (físicas incluidas) va más rápido o más lento. */
  var realPerf = performance.now.bind(performance);
  var realDate = Date.now.bind(Date);
  var lastReal = realPerf(), virt = lastReal;
  var dateOffset = realDate() - lastReal;
  function vnow() {
    var r = realPerf();
    virt += (r - lastReal) * state.speed;
    lastReal = r;
    return virt;
  }
  try { performance.now = vnow; } catch (e) {}
  try { Date.now = function () { return Math.round(dateOffset + vnow()); }; } catch (e) {}

  /* ================= Volumen maestro ================= */
  var masters = [];
  try {
    var proto = (window.BaseAudioContext || window.AudioContext).prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'destination');
    if (desc && desc.get) {
      Object.defineProperty(proto, 'destination', {
        configurable: true,
        get: function () {
          if (!this.__mmMaster) {
            var real = desc.get.call(this);
            var g = this.createGain();
            g.gain.value = cfg.volume;
            g.connect(real);
            this.__mmMaster = g;
            masters.push(g);
          }
          return this.__mmMaster;
        }
      });
    }
  } catch (e) {}
  function setVolume(v) {
    cfg.volume = v; save();
    masters.forEach(function (g) { try { g.gain.value = v; } catch (e) {} });
  }

  /* ================= Anuncios con recompensa automáticos =================
   * El juego llama a gdsdk.showAd('rewarded') y espera una promesa. Con esta
   * opción la promesa se resuelve al instante, como si hubieras visto el anuncio. */
  var realGd;
  var stubGd = {
    AdType: { Interstitial: 'interstitial', Rewarded: 'rewarded' },
    showAd: function () { return Promise.resolve({}); },
    preloadAd: function () { return Promise.resolve({}); }
  };
  try {
    Object.defineProperty(window, 'gdsdk', {
      configurable: true,
      get: function () { return cfg.autoAds ? stubGd : realGd; },
      set: function (v) { realGd = v; }
    });
  } catch (e) {}

  /* ================= Escáner de memoria (tipo Cheat Engine) ================= */
  var Mem = {
    CAP: 2000000, n: 0, type: 'f32',
    hits: new Uint32Array(0), prev: new Float64Array(0),
    frozen: {}, // addr -> {type, val}
    mod: function () {
      var g = window.gameInstance;
      if (!g || !g.Module || !g.Module.HEAPU8) throw new Error('El juego todavía no ha cargado.');
      return g.Module;
    },
    view: function (type) {
      var b = this.mod().HEAPU8.buffer;
      return type === 'i32' ? new Int32Array(b) : new Float32Array(b);
    },
    first: function (type, lo, hi) {
      if (hi < lo) { var t = lo; lo = hi; hi = t; }
      var v = this.view(type);
      if (type === 'f32' && lo === hi) {
        var tol = Math.max(1e-4, Math.abs(lo) * 1e-6); lo -= tol; hi += tol;
      }
      var hits = new Uint32Array(this.CAP), prev = new Float64Array(this.CAP);
      var n = 0, over = false;
      for (var i = 1; i < v.length; i++) {
        var x = v[i];
        if (x >= lo && x <= hi) {
          if (n >= this.CAP) { over = true; break; }
          hits[n] = i * 4; prev[n] = x; n++;
        }
      }
      this.type = type; this.hits = hits; this.prev = prev; this.n = n;
      return over;
    },
    next: function (mode, val) {
      var v = this.view(this.type), k = 0;
      var tol = this.type === 'f32' ? Math.max(1e-4, Math.abs(val) * 1e-6) : 0;
      for (var j = 0; j < this.n; j++) {
        var x = v[this.hits[j] / 4], p = this.prev[j], ok = false;
        if (mode === 'exact') ok = Math.abs(x - val) <= tol;
        else if (mode === 'changed') ok = x !== p;
        else if (mode === 'same') ok = x === p;
        else if (mode === 'inc') ok = x > p;
        else if (mode === 'dec') ok = x < p;
        if (ok) { this.hits[k] = this.hits[j]; this.prev[k] = x; k++; }
      }
      this.n = k;
    },
    reset: function () { this.n = 0; this.hits = new Uint32Array(0); this.prev = new Float64Array(0); },
    read: function (addr, type) { return this.view(type || this.type)[addr / 4]; },
    write: function (addr, val, type) { this.view(type || this.type)[addr / 4] = val; }
  };
  setInterval(function () {
    var keys = Object.keys(Mem.frozen);
    if (!keys.length) return;
    try {
      keys.forEach(function (a) { var f = Mem.frozen[a]; Mem.write(+a, f.val, f.type); });
    } catch (e) {}
  }, 30);

  /* ================= Interfaz ================= */
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '#fab{position:fixed;right:14px;bottom:14px;width:40px;height:40px;border-radius:50%;border:1px solid #4a6a8a;background:#14202e;color:#cfe6ff;font-size:20px;cursor:pointer;opacity:.55;z-index:2147483646}',
    '#fab:hover{opacity:1}',
    '#fps{position:fixed;left:8px;top:8px;padding:2px 7px;border-radius:6px;background:rgba(10,18,28,.75);color:#9fe6a8;font:12px/1.4 ui-monospace,Consolas,monospace;z-index:2147483645;display:none}',
    '#panel{position:fixed;top:60px;right:20px;width:352px;max-height:82vh;display:none;flex-direction:column;background:#0f1824;color:#dbe7f3;border:1px solid #2c4560;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.5);z-index:2147483647;font-size:13px}',
    '#panel.open{display:flex}',
    '#head{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:move;border-bottom:1px solid #22364b;user-select:none}',
    '#head b{flex:1;font-size:14px;letter-spacing:.2px}',
    '#head button{background:none;border:0;color:#8fa6bd;font-size:18px;cursor:pointer}',
    '#tabs{display:flex;border-bottom:1px solid #22364b}',
    '#tabs button{flex:1;padding:8px 4px;background:none;border:0;border-bottom:2px solid transparent;color:#8fa6bd;cursor:pointer;font-size:13px}',
    '#tabs button.on{color:#fff;border-bottom-color:#4da3ff}',
    '.pg{display:none;padding:12px;overflow:auto}.pg.on{display:block}',
    '.row{display:flex;align-items:center;gap:8px;margin:0 0 10px}',
    '.row>label{flex:0 0 78px;color:#9db3c8}',
    '.row.full>label{flex:1}',
    'input[type=range]{flex:1;accent-color:#4da3ff}',
    'input[type=text],input[type=number],select{flex:1;min-width:0;padding:6px 8px;background:#0a121c;color:#e6f0fa;border:1px solid #2c4560;border-radius:6px;font-size:13px}',
    'button.b{padding:6px 10px;background:#1b3149;color:#e6f0fa;border:1px solid #2f5273;border-radius:6px;cursor:pointer;font-size:12.5px}',
    'button.b:hover{background:#244264}',
    'button.b.pri{background:#2a6fc4;border-color:#3a85de}',
    '.pill{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}',
    '.val{min-width:46px;text-align:right;color:#fff;font-variant-numeric:tabular-nums}',
    '.hint{color:#7f96ad;font-size:12px;line-height:1.45;margin:0 0 10px}',
    '.st{min-height:18px;color:#9fe6a8;font-size:12px;margin:0 0 8px}.st.err{color:#ff9a9a}',
    'h4{margin:12px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#7f96ad}',
    'table{width:100%;border-collapse:collapse;font-size:12px}',
    'td{padding:3px 2px;border-bottom:1px solid #1a2b3d;vertical-align:middle}',
    'td input[type=text]{width:70px;padding:3px 5px;font-size:12px}',
    '.mono{font-family:ui-monospace,Consolas,monospace}',
    '#foot{padding:7px 12px;border-top:1px solid #22364b;color:#6c8399;font-size:11.5px}'
  ].join('');

  var HTML = [
    '<button id="fab" title="Mod menu (` o Insert)">⚙</button>',
    '<div id="fps">-- FPS</div>',
    '<div id="panel">',
    '<div id="head"><b>❄ Snow Rider · Mod Menu</b><button id="x" title="Cerrar">✕</button></div>',
    '<div id="tabs"><button data-t="g" class="on">Juego</button><button data-t="m">Memoria</button><button data-t="a">Avanzado</button></div>',

    '<div class="pg on" id="pg-g">',
    ' <div class="row"><label>Velocidad</label><input type="range" id="spd" min="0.1" max="4" step="0.05" value="1"><span class="val" id="spdv">1.00×</span></div>',
    ' <div class="pill"><button class="b" data-s="0.25">0.25×</button><button class="b" data-s="0.5">0.5×</button><button class="b" data-s="1">1×</button><button class="b" data-s="1.5">1.5×</button><button class="b" data-s="2">2×</button><button class="b" data-s="3">3×</button></div>',
    ' <div class="row"><label>Volumen</label><input type="range" id="vol" min="0" max="1" step="0.05"><span class="val" id="volv"></span></div>',
    ' <div class="row full"><label for="ads">Anuncios con recompensa automáticos</label><input type="checkbox" id="ads"></div>',
    ' <div class="row full"><label for="fpsc">Mostrar FPS</label><input type="checkbox" id="fpsc"></div>',
    ' <div class="row full"><label for="fit">Ajustar el juego a la ventana</label><input type="checkbox" id="fit"></div>',
    ' <div class="pill"><button class="b" id="full">Pantalla completa</button></div>',
    ' <p class="hint">La velocidad escala el reloj del juego: por encima de 1× todo va más deprisa, por debajo ayuda a esquivar con calma.</p>',
    '</div>',

    '<div class="pg" id="pg-m">',
    ' <p class="hint">Busca un número del juego (puntos, regalos, monedas…) en la memoria y modifícalo. Ejemplo: escanea tu cifra actual, consigue una más, pulsa «Filtrar» con la nueva cifra y repite hasta que queden pocas direcciones.</p>',
    ' <div class="row"><label>Tipo</label><select id="mtype"><option value="i32">Entero (int32)</option><option value="f32">Decimal (float)</option></select></div>',
    ' <div class="row"><label>Valor</label><input type="number" id="mlo" step="any" placeholder="p. ej. 12"><input type="number" id="mhi" step="any" placeholder="hasta (opc.)"></div>',
    ' <div class="pill"><button class="b pri" id="mfirst">Primer escaneo</button><button class="b" id="mreset">Reiniciar</button></div>',
    ' <div class="row"><label>Filtrar</label><select id="mmode"><option value="exact">Valor exacto</option><option value="changed">Ha cambiado</option><option value="same">No ha cambiado</option><option value="inc">Ha subido</option><option value="dec">Ha bajado</option></select></div>',
    ' <div class="row"><label>Valor</label><input type="number" id="mval" step="any" placeholder="solo para «exacto»"><button class="b pri" id="mnext">Filtrar</button></div>',
    ' <div class="st" id="mst"></div>',
    ' <table><tbody id="mres"></tbody></table>',
    ' <h4>Dirección manual</h4>',
    ' <div class="row"><label>Dirección</label><input type="text" id="maddr" placeholder="0x232667C"></div>',
    ' <div class="row"><label>Valor</label><input type="number" id="maval" step="any" placeholder="p. ej. 99999"></div>',
    ' <div class="pill"><button class="b" id="mard">Leer</button><button class="b pri" id="mawr">Escribir</button><button class="b" id="mafz">Congelar</button></div>',
    ' <h4>Congelados <span id="fcount">0</span> <button class="b" id="fclear" style="float:right;padding:2px 8px">soltar todo</button></h4>',
    '</div>',

    '<div class="pg" id="pg-a">',
    ' <p class="hint">Llama a un método público de un objeto del juego (<span class="mono">gameInstance.SendMessage</span>). Solo funciona con métodos de scripts que reciban 0 o 1 parámetro (texto o número).</p>',
    ' <div class="row"><label>Objeto</label><input type="text" id="smo" placeholder="GameDistribution"></div>',
    ' <div class="row"><label>Método</label><input type="text" id="smm" placeholder="RewardedVideoSuccessCallback"></div>',
    ' <div class="row"><label>Parámetro</label><input type="text" id="smp" placeholder="(vacío = ninguno)"></div>',
    ' <div class="pill"><button class="b pri" id="smgo">Enviar</button></div>',
    ' <h4>Atajos</h4>',
    ' <div class="pill"><button class="b" data-sm="GameDistribution|RewardedVideoSuccessCallback">Recompensa de anuncio</button><button class="b" data-sm="GameDistribution|ResumeGameCallback">Reanudar</button><button class="b" data-sm="GameDistribution|PauseGameCallback">Pausar</button></div>',
    ' <div class="st" id="smst"></div>',
    '</div>',

    '<div id="foot">` / Insert: menú · [ ] velocidad · \\ restablecer</div>',
    '</div>'
  ].join('');

  function build() {
    var host = document.createElement('div');
    host.id = 'snowmod-host';
    document.body.appendChild(host);
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var style = document.createElement('style'); style.textContent = CSS;
    var wrap = document.createElement('div'); wrap.innerHTML = HTML;
    root.appendChild(style); root.appendChild(wrap);
    var $ = function (s) { return root.querySelector(s); };
    var $$ = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };

    var panel = $('#panel');
    function toggle(force) {
      var on = typeof force === 'boolean' ? force : !panel.classList.contains('open');
      panel.classList.toggle('open', on);
    }
    $('#fab').onclick = function () { toggle(); };
    $('#x').onclick = function () { toggle(false); };

    /* arrastrar */
    (function () {
      var drag = null, head = $('#head');
      head.addEventListener('pointerdown', function (e) {
        if (e.target.tagName === 'BUTTON') return;
        var r = panel.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        head.setPointerCapture(e.pointerId);
      });
      head.addEventListener('pointermove', function (e) {
        if (!drag) return;
        panel.style.left = Math.max(0, Math.min(innerWidth - 80, e.clientX - drag.dx)) + 'px';
        panel.style.top = Math.max(0, Math.min(innerHeight - 40, e.clientY - drag.dy)) + 'px';
        panel.style.right = 'auto';
      });
      head.addEventListener('pointerup', function () { drag = null; });
    })();

    /* que el juego no reciba las teclas escritas en el menú */
    ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'wheel'].forEach(function (ev) {
      panel.addEventListener(ev, function (e) { e.stopPropagation(); });
    });

    /* pestañas */
    var curTab = 'g';
    $$('#tabs button').forEach(function (b) {
      b.onclick = function () {
        curTab = b.getAttribute('data-t');
        $$('#tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
        $$('.pg').forEach(function (p) { p.classList.toggle('on', p.id === 'pg-' + curTab); });
      };
    });

    /* ---- Juego ---- */
    function setSpeed(v) {
      v = Math.max(0.1, Math.min(4, Math.round(v * 100) / 100));
      state.speed = v;
      $('#spd').value = v;
      $('#spdv').textContent = v.toFixed(2) + '×';
    }
    $('#spd').oninput = function () { setSpeed(parseFloat(this.value)); };
    $$('[data-s]').forEach(function (b) { b.onclick = function () { setSpeed(parseFloat(b.getAttribute('data-s'))); }; });

    $('#vol').value = cfg.volume; $('#volv').textContent = Math.round(cfg.volume * 100) + '%';
    $('#vol').oninput = function () { var v = parseFloat(this.value); setVolume(v); $('#volv').textContent = Math.round(v * 100) + '%'; };

    $('#ads').checked = cfg.autoAds;
    $('#ads').onchange = function () { cfg.autoAds = this.checked; save(); };

    var fpsBox = $('#fps'), frames = 0, t0 = realPerf();
    $('#fpsc').checked = cfg.fps; fpsBox.style.display = cfg.fps ? 'block' : 'none';
    $('#fpsc').onchange = function () { cfg.fps = this.checked; save(); fpsBox.style.display = cfg.fps ? 'block' : 'none'; };
    (function loop() {
      frames++;
      var now = realPerf();
      if (now - t0 >= 1000) {
        fpsBox.textContent = Math.round(frames * 1000 / (now - t0)) + ' FPS';
        frames = 0; t0 = now;
      }
      requestAnimationFrame(loop);
    })();

    function applyFit() {
      var c = document.getElementById('gameContainer');
      if (!c) return;
      if (cfg.fit) {
        var w = Math.min(innerWidth, innerHeight * 1.6), h = w / 1.6;
        c.style.width = Math.floor(w) + 'px'; c.style.height = Math.floor(h) + 'px';
        c.style.marginTop = Math.max(0, Math.floor((innerHeight - h) / 2)) + 'px';
      } else {
        c.style.width = '960px'; c.style.height = '600px'; c.style.marginTop = '';
      }
    }
    $('#fit').checked = cfg.fit;
    $('#fit').onchange = function () { cfg.fit = this.checked; save(); applyFit(); };
    window.addEventListener('resize', function () { if (cfg.fit) applyFit(); });
    applyFit();

    $('#full').onclick = function () {
      try { window.gameInstance.SetFullscreen(1); } catch (e) { /* el juego aún no ha cargado */ }
    };

    /* ---- Memoria ---- */
    var mst = $('#mst');
    function say(msg, err) { mst.textContent = msg; mst.className = 'st' + (err ? ' err' : ''); }
    function hex(a) { return '0x' + a.toString(16).toUpperCase(); }
    function fmt(x) { return Number.isInteger(x) ? String(x) : (+x).toPrecision(7).replace(/\.?0+$/, ''); }

    function render() {
      var body = $('#mres'), html = '', shown = Math.min(Mem.n, 40);
      for (var i = 0; i < shown; i++) {
        var a = Mem.hits[i];
        html += '<tr data-a="' + a + '"><td class="mono">' + hex(a) + '</td><td class="mono cur">…</td>' +
          '<td><input type="text" class="nv" placeholder="nuevo"></td>' +
          '<td><button class="b go" style="padding:2px 7px">✔</button></td>' +
          '<td title="Congelar"><input type="checkbox" class="fz"' + (Mem.frozen[a] ? ' checked' : '') + '></td></tr>';
      }
      body.innerHTML = html;
      $$('#mres tr').forEach(function (tr) {
        var a = +tr.getAttribute('data-a');
        var inp = tr.querySelector('.nv');
        var parse = function () { var n = parseFloat(inp.value); return isNaN(n) ? null : (Mem.type === 'i32' ? Math.round(n) : n); };
        tr.querySelector('.go').onclick = function () {
          var n = parse(); if (n === null) return;
          try { Mem.write(a, n); } catch (e) { say(e.message, true); }
        };
        tr.querySelector('.fz').onchange = function () {
          if (this.checked) {
            var n = parse(); if (n === null) n = Mem.read(a);
            Mem.frozen[a] = { type: Mem.type, val: n };
          } else delete Mem.frozen[a];
          $('#fcount').textContent = Object.keys(Mem.frozen).length;
        };
      });
      refreshVals();
    }
    function refreshVals() {
      if (curTab !== 'm' || !panel.classList.contains('open')) return;
      try {
        $$('#mres tr').forEach(function (tr) {
          tr.querySelector('.cur').textContent = fmt(Mem.read(+tr.getAttribute('data-a')));
        });
      } catch (e) {}
    }
    setInterval(refreshVals, 400);

    function summary(extra) {
      say(Mem.n + ' direcciones' + (Mem.n > 40 ? ' (se muestran 40)' : '') + (extra || ''));
      render();
    }
    $('#mfirst').onclick = function () {
      var lo = parseFloat($('#mlo').value), hi = $('#mhi').value === '' ? lo : parseFloat($('#mhi').value);
      if (isNaN(lo) || isNaN(hi)) return say('Escribe un valor para buscar.', true);
      try {
        say('Escaneando…');
        setTimeout(function () {
          try {
            var over = Mem.first($('#mtype').value, lo, hi);
            summary(over ? ' · demasiados resultados, afina el valor' : '');
          } catch (e) { say(e.message, true); }
        }, 20);
      } catch (e) { say(e.message, true); }
    };
    $('#mnext').onclick = function () {
      if (!Mem.n) return say('Haz primero un primer escaneo.', true);
      var mode = $('#mmode').value, val = parseFloat($('#mval').value);
      if (mode === 'exact' && isNaN(val)) return say('Escribe el valor actual.', true);
      try { Mem.next(mode, val); summary(); } catch (e) { say(e.message, true); }
    };
    $('#mreset').onclick = function () { Mem.reset(); $('#mres').innerHTML = ''; say('Escaneo reiniciado.'); };
    $('#fclear').onclick = function () { Mem.frozen = {}; $('#fcount').textContent = 0; render(); };


    /* dirección manual (usa el tipo elegido arriba) */
    function manual() {
      var a = parseInt($('#maddr').value.trim(), 16);
      if (isNaN(a) || a % 4) { say('Dirección no válida (hex, múltiplo de 4).', true); return null; }
      return a;
    }
    function mtype() { return $('#mtype').value; }
    $('#mard').onclick = function () {
      var a = manual(); if (a === null) return;
      try { say(hex(a) + ' = ' + fmt(Mem.read(a, mtype()))); } catch (e) { say(e.message, true); }
    };
    function mval() { var n = parseFloat($('#maval').value); if (isNaN(n)) { say('Escribe un valor.', true); return null; } return mtype() === 'i32' ? Math.round(n) : n; }
    $('#mawr').onclick = function () {
      var a = manual(), n = a === null ? null : mval(); if (n === null) return;
      try { Mem.write(a, n, mtype()); say(hex(a) + ' ← ' + n); } catch (e) { say(e.message, true); }
    };
    $('#mafz').onclick = function () {
      var a = manual(), n = a === null ? null : mval(); if (n === null) return;
      Mem.frozen[a] = { type: mtype(), val: n };
      $('#fcount').textContent = Object.keys(Mem.frozen).length;
      say(hex(a) + ' congelada en ' + n);
    };

    /* ---- Avanzado ---- */
    var smst = $('#smst');
    function sendMsg(o, m, p) {
      try {
        if (!o || !m) throw new Error('Indica objeto y método.');
        var g = window.gameInstance;
        if (!g || !g.SendMessage) throw new Error('El juego todavía no ha cargado.');
        if (p === '' || p === undefined) g.SendMessage(o, m);
        else g.SendMessage(o, m, /^-?\d+(\.\d+)?$/.test(p) ? parseFloat(p) : p);
        smst.className = 'st'; smst.textContent = 'Enviado: ' + o + '.' + m + (p ? '(' + p + ')' : '()');
      } catch (e) { smst.className = 'st err'; smst.textContent = e.message || String(e); }
    }
    $('#smgo').onclick = function () { sendMsg($('#smo').value.trim(), $('#smm').value.trim(), $('#smp').value); };
    $$('[data-sm]').forEach(function (b) {
      b.onclick = function () { var s = b.getAttribute('data-sm').split('|'); sendMsg(s[0], s[1]); };
    });

    /* ---- Atajos de teclado (fase de captura, antes que el juego) ---- */
    window.addEventListener('keydown', function (e) {
      var t = e.composedPath ? e.composedPath()[0] : e.target;
      var typing = t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
      if (e.code === 'Backquote' || e.code === 'Insert') {
        if (typing && e.code === 'Backquote') return;
        e.preventDefault(); e.stopPropagation(); toggle(); return;
      }
      if (typing) return;
      if (e.key === '[') { setSpeed(state.speed - 0.25); e.stopPropagation(); }
      else if (e.key === ']') { setSpeed(state.speed + 0.25); e.stopPropagation(); }
      else if (e.key === '\\') { setSpeed(1); e.stopPropagation(); }
    }, true);

    window.snowMod = { toggle: toggle, setSpeed: setSpeed, Mem: Mem, state: state, cfg: cfg };
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();
