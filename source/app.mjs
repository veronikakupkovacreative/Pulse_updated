(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  /* ---------- shared snippets injected into every tool view ---------- */
  var CHIP = '<div class="filechip when-loaded"><i class="dot" aria-hidden="true"></i><b>night-drive_demo.wav</b><span>3:42 · 44.1 kHz · stereo</span><button class="btn btn--sm" type="button" data-unload>Replace</button></div>';
  $$('[data-slot="chip"]').forEach(function (e) { e.outerHTML = CHIP; });
  $$('[data-slot="empty"]').forEach(function (e) {
    e.outerHTML = '<div class="empty when-empty"><div class="dropzone__icon" aria-hidden="true">+</div><h2>No track loaded yet</h2><p>' + e.dataset.msg + '</p><button class="btn btn--primary" type="button" data-load>Load demo track</button><p class="note">Prototype: loads a pretend file called night-drive_demo.wav</p></div>';
  });

  /* ---------- toast ---------- */
  var toastEl = $('#toast'), toastT;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  /* ---------- waveform helper ---------- */
  function wave(el, seed, cls) {
    var s = '';
    for (var i = 0; i < 220; i++) {
      var env = 0.35 + 0.45 * Math.abs(Math.sin(i / 17 + seed)) + 0.15 * Math.sin(i / 5 + seed * 2);
      var h = Math.max(4, Math.min(96, env * 100 * (0.7 + 0.3 * Math.abs(Math.sin(i * 1.7 + seed)))));
      s += '<rect x="' + i + '" y="' + ((100 - h) / 2).toFixed(1) + '" width="0.62" height="' + h.toFixed(1) + '" rx="0.2"/>';
    }
    el.innerHTML = s;
  }
  (function () {
    var w = $('#wave'), html = '';
    for (var i = 0; i < 90; i++) {
      var h = 18 + Math.abs(Math.sin(i * 0.42) * 60) + (i * 7 % 13);
      html += '<i style="--h:' + Math.min(h, 100).toFixed(0) + '%;--i:' + i + '"></i>';
    }
    w.innerHTML = html;
  })();
  wave($('#wl'), 1); wave($('#wr'), 1.7);

  /* ---------- track state ---------- */
  var anTimer;
  function runAnalysis() {
    clearInterval(anTimer);
    $('#an-run').hidden = false; $('#an-done').hidden = true;
    var p = 0, bar = $('#an-bar'), pct = $('#an-pct');
    bar.style.width = '0'; pct.textContent = '0%';
    anTimer = setInterval(function () {
      p += 8 + Math.random() * 10;
      if (p >= 100) {
        p = 100; clearInterval(anTimer);
        bar.style.width = '100%'; pct.textContent = '100%';
        setTimeout(function () { $('#an-run').hidden = true; $('#an-done').hidden = false; drawBeat(); }, 250);
        return;
      }
      bar.style.width = p + '%'; pct.textContent = Math.round(p) + '%';
    }, 140);
  }
  function drawBeat() {
    var svg = $('#bg'); wave(svg, 1.3);
    var lines = '';
    for (var i = 0; i < 32; i++) {
      var x = (i * 220 / 32 + 1).toFixed(1);
      lines += '<line class="' + (i % 4 === 0 ? 'bar' : '') + '" x1="' + x + '" x2="' + x + '" y1="0" y2="100"/>';
    }
    svg.insertAdjacentHTML('beforeend', lines);
  }
  function setTrack(v) {
    document.body.dataset.track = v ? 'loaded' : 'none';
    if (v) runAnalysis();
  }

  /* ---------- router ---------- */
  var KNOWN = { home: 1, analyzer: 1, tagger: 1, editor: 1, converter: 1, ai: 1, visualizer: 1 };
  var NAVMAP = { analyzer: 'analyzer', tagger: 'analyzer', editor: 'editor', converter: 'converter', ai: 'ai', 'ai-tool': 'ai', visualizer: 'visualizer' };
  var TITLES = { home: 'Home', analyzer: 'Song Analyzer', tagger: 'Music Tagger', editor: 'Audio Editor', converter: 'Audio Converter', ai: 'AI Studio', visualizer: 'Audio Visualizer' };
  function route() {
    var h = location.hash.replace(/^#\/?/, '') || 'home';
    var parts = h.split('/'), name = parts[0], arg = parts[1], view = name;
    if (!KNOWN[name]) return;
    if (name === 'ai' && arg) {
      if (!AIMAP[arg]) { location.hash = '#/ai'; return; }
      view = 'ai-tool'; renderAi(arg);
    }
    $$('.view').forEach(function (v) { v.hidden = v.dataset.view !== view; });
    var nv = NAVMAP[view];
    $$('[data-nav]').forEach(function (a) { if (a.dataset.nav === nv) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    document.title = (view === 'ai-tool' ? AIMAP[arg].name : TITLES[view]) + ' — PULSE Studio (prototype)';
    window.scrollTo(0, 0);
    var h1 = $('.view:not([hidden]) h1'); if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    vs.run = (view === 'visualizer');
    if (vs.run && !vs.loop) { vs.loop = true; requestAnimationFrame(frame); }
  }
  window.addEventListener('hashchange', route);

  /* ---------- global click handling ---------- */
  document.addEventListener('click', function (e) {
    var t;
    if ((t = e.target.closest('[data-load]'))) {
      setTrack(true);
      if (t.dataset.go) location.hash = '#/' + t.dataset.go;
      else toast('Demo track loaded');
      return;
    }
    if ((t = e.target.closest('[data-unload]'))) { setTrack(false); toast('Audio removed'); return; }
    if ((t = e.target.closest('[data-toast]'))) { toast(t.dataset.toast); return; }
    if ((t = e.target.closest('[data-scroll]'))) { var el = document.getElementById(t.dataset.scroll); if (el) el.scrollIntoView({ behavior: 'smooth' }); return; }
    if (e.target.closest('.skip-link')) { e.preventDefault(); var m = $('#main'); m.setAttribute('tabindex', '-1'); m.focus(); return; }
  });
  var dz = $('#drop');
  ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (x) { x.preventDefault(); dz.classList.add('is-dragover'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (x) { x.preventDefault(); dz.classList.remove('is-dragover'); if (ev === 'drop') { setTrack(true); location.hash = '#/analyzer'; } }); });

  /* ---------- home filters ---------- */
  $$('#filters .chip').forEach(function (c) {
    c.addEventListener('click', function () {
      $$('#filters .chip').forEach(function (x) { x.setAttribute('aria-pressed', x === c ? 'true' : 'false'); });
      var f = c.dataset.f;
      $$('#toolgrid .card').forEach(function (card) { card.style.display = (f === 'all' || card.dataset.cat === f) ? '' : 'none'; });
    });
  });
  $('#an-rerun').addEventListener('click', runAnalysis);

  /* ---------- editor ---------- */
  var tools = $$('.tool[aria-pressed]');
  tools.forEach(function (t) { t.addEventListener('click', function () { tools.forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); t.setAttribute('aria-pressed', 'true'); }); });
  $('#loopbtn').addEventListener('click', function () { var b = this; b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); });
  function bind(id, out, fmt) { var i = document.getElementById(id), o = document.getElementById(out); function u() { o.textContent = fmt(+i.value); } i.addEventListener('input', u); u(); }
  bind('fi', 'fiO', function (v) { return v.toFixed(1) + ' s'; });
  bind('fo', 'foO', function (v) { return v.toFixed(1) + ' s'; });
  bind('gn', 'gnO', function (v) { return (v > 0 ? '+' : '') + v.toFixed(1) + ' dB'; });

  var play = $('#play'), ph = $('#playhead'), now = $('#now'), pos = 0.35, timer = null;
  function fmt(t) { var m = Math.floor(t / 60), s = (t % 60).toFixed(1); return m + ':' + (s < 10 ? '0' : '') + s; }
  play.addEventListener('click', function () {
    if (timer) { clearInterval(timer); timer = null; play.textContent = '▶'; play.setAttribute('aria-label', 'Play'); return; }
    play.textContent = '❚❚'; play.setAttribute('aria-label', 'Pause');
    timer = setInterval(function () { pos += 0.0018; if (pos > 1) pos = 0; ph.style.left = (pos * 100) + '%'; now.textContent = fmt(pos * 222); }, 40);
  });

  var W = 400, H = 150, MID = 75, FMIN = 20, FMAX = 20000;
  var bands = [{ f: 80, g: 3, q: 1.0 }, { f: 400, g: -4, q: 1.4 }, { f: 3000, g: 2.5, q: 1.2 }, { f: 10000, g: 4, q: 0.8 }], sel = 1;
  function fx(f) { return W * (Math.log(f / FMIN) / Math.log(FMAX / FMIN)); }
  function gy(g) { return MID - g * (MID / 14); }
  var gr = '';
  [20, 100, 1000, 10000].forEach(function (f) {
    gr += '<line class="gridline" x1="' + fx(f) + '" x2="' + fx(f) + '" y1="0" y2="' + H + '"/><text x="' + (fx(f) + 3) + '" y="' + (H - 4) + '">' + (f >= 1000 ? (f / 1000) + 'k' : f) + '</text>';
  });
  gr += '<line class="gridline zero" x1="0" x2="' + W + '" y1="' + MID + '" y2="' + MID + '"/>';
  [12, -12].forEach(function (d) { gr += '<text x="3" y="' + (gy(d) + (d > 0 ? 10 : -3)) + '">' + (d > 0 ? '+' : '') + d + '</text>'; });
  $('#eqgrid').innerHTML = gr;
  function draw() {
    var pts = [];
    for (var x = 0; x <= W; x += 4) {
      var g = 0; bands.forEach(function (b) { var d = (x - fx(b.f)) / (W / 5.5 / b.q); g += b.g * Math.exp(-d * d); });
      pts.push([x, gy(Math.max(-13, Math.min(13, g)))]);
    }
    $('#curve').setAttribute('d', 'M0,' + MID + ' ' + pts.map(function (p) { return 'L' + p[0] + ',' + p[1].toFixed(1); }).join(' ') + ' L' + W + ',' + MID + ' Z');
    $('#nodes').innerHTML = bands.map(function (b, i) { return '<circle class="node' + (i === sel ? ' is-active' : '') + '" cx="' + fx(b.f).toFixed(1) + '" cy="' + gy(b.g).toFixed(1) + '" r="' + (i === sel ? 7 : 5.5) + '"/>'; }).join('');
    var b = bands[sel];
    $('#ef').value = Math.round(1000 * Math.log(b.f / FMIN) / Math.log(FMAX / FMIN)); $('#eg').value = b.g; $('#eqq').value = b.q;
    $('#efO').textContent = b.f >= 1000 ? (b.f / 1000).toFixed(1) + ' kHz' : Math.round(b.f) + ' Hz';
    $('#egO').textContent = (b.g > 0 ? '+' : '') + b.g.toFixed(1) + ' dB'; $('#eqO').textContent = b.q.toFixed(1);
  }
  $('#ef').addEventListener('input', function (e) { bands[sel].f = FMIN * Math.pow(FMAX / FMIN, e.target.value / 1000); draw(); });
  $('#eg').addEventListener('input', function (e) { bands[sel].g = +e.target.value; draw(); });
  $('#eqq').addEventListener('input', function (e) { bands[sel].q = +e.target.value; draw(); });
  $$('.bands .chip').forEach(function (c) { c.addEventListener('click', function () { sel = +c.dataset.b; $$('.bands .chip').forEach(function (x) { x.setAttribute('aria-pressed', x === c ? 'true' : 'false'); }); draw(); }); });
  draw();

  /* ---------- converter ---------- */
  var cTimer;
  function cEstimate() {
    var f = $('input[name="cf"]:checked').value, br = parseInt($('#cbr').value, 10);
    var lossy = (f === 'mp3' || f === 'aac' || f === 'ogg');
    $('#cbr-wrap').style.display = lossy ? '' : 'none';
    var mb = lossy ? Math.round(((3 * 60 + 42 + 68) * br) / 8 / 1024) : (f === 'wav' ? 47 : 26);
    $('#cest').textContent = 'Estimated output: ~' + mb + ' MB total';
  }
  $$('input[name="cf"]').forEach(function (r) { r.addEventListener('change', cEstimate); });
  $('#cbr').addEventListener('change', cEstimate); cEstimate();
  $('#cgo').addEventListener('click', function () {
    $('#cgo').hidden = true; $('#cdone').hidden = true; $('#cprog').hidden = false;
    var p = 0; clearInterval(cTimer);
    cTimer = setInterval(function () {
      p += 5 + Math.random() * 7;
      if (p >= 100) { p = 100; clearInterval(cTimer); $('#cprog').hidden = true; $('#cdone').hidden = false; }
      $('#cbar').style.width = p + '%'; $('#cpct').textContent = Math.round(p) + '%';
      $('#cmsg').textContent = p < 50 ? 'Converting night-drive_demo.wav…' : 'Converting bassline_v3.flac…';
    }, 120);
  });
  $('#cagain').addEventListener('click', function () { $('#cdone').hidden = true; $('#cgo').hidden = false; $('#cbar').style.width = '0'; });

  /* ---------- AI Studio ---------- */
  var AI = [
    { g: 'Master & mix', items: [
      { id: 'mastering', name: 'AI Mastering', cloud: true, d: 'Balance loudness, tone and stereo image for release-ready masters.', o: [['range', 'Loudness target', -14, -24, -6, ' LUFS'], ['select', 'Tone', ['Warm', 'Neutral', 'Bright']], ['range', 'Limiter ceiling', -1, -3, 0, ' dBTP']] },
      { id: 'mix', name: 'Mix Assistant', cloud: true, d: 'Get balance suggestions for levels, panning and low end.', o: [['select', 'Reference style', ['Synthwave', 'Pop', 'Hip-hop', 'Rock']], ['range', 'Vocal level', 0, -6, 6, ' dB'], ['range', 'Low-end punch', 50, 0, 100, '%']] },
      { id: 'stereo', name: 'Stereo Lab', cloud: false, d: 'Widen, narrow or fix the stereo image without losing mono compatibility.', o: [['range', 'Stereo width', 120, 0, 200, '%'], ['range', 'Mono bass below', 120, 20, 300, ' Hz']] }] },
    { g: 'Voice & stems', items: [
      { id: 'vocal', name: 'Vocal Studio', cloud: true, d: 'Isolate, remove or clean up vocals.', o: [['select', 'Mode', ['Isolate vocal', 'Remove vocal', 'De-ess', 'Trim reverb tail']], ['range', 'Strength', 70, 0, 100, '%']] },
      { id: 'stems', name: 'Stem Extraction', cloud: true, d: 'Split a track into separate stems you can download.', o: [['select', 'Stems', ['4 stems (vocals, drums, bass, other)', '2 stems (vocals, instrumental)', '6 stems']], ['select', 'Output', ['WAV', 'FLAC', 'MP3']]] },
      { id: 'repair', name: 'Audio Repair', cloud: false, d: 'Reduce noise, clicks and hum in noisy recordings.', o: [['range', 'Noise reduction', 40, 0, 100, '%'], ['range', 'De-click', 30, 0, 100, '%'], ['range', 'De-hum', 0, 0, 100, '%']] }] },
    { g: 'Creative', items: [
      { id: 'beat', name: 'Beat Lab', cloud: false, d: 'Sketch drum patterns that follow your track\'s tempo.', o: [['range', 'Tempo', 124, 60, 200, ' BPM'], ['select', 'Pattern', ['House', 'Breaks', 'Trap', 'Garage']], ['range', 'Swing', 12, 0, 60, '%']] },
      { id: 'fx', name: 'Smart FX', cloud: false, d: 'Add tape, reverb, delay or chorus with sensible starting points.', o: [['select', 'Effect', ['Tape saturation', 'Plate reverb', 'Stereo delay', 'Chorus']], ['range', 'Mix', 35, 0, 100, '%']] },
      { id: 'pitch', name: 'Pitch & Time', cloud: false, d: 'Shift pitch or stretch time independently.', o: [['range', 'Pitch', 0, -12, 12, ' st'], ['range', 'Time stretch', 100, 50, 200, '%'], ['select', 'Mode', ['Preserve formants', 'Classic']]] }] },
    { g: 'Generate & clean', items: [
      { id: 'lyrics', name: 'Lyrics Generator', cloud: true, d: 'Draft lyric ideas from a mood and language.', o: [['select', 'Language', ['English', 'Czech', 'Spanish']], ['select', 'Mood', ['Nocturnal', 'Uplifting', 'Melancholic']], ['range', 'Verses', 2, 1, 4, '']] },
      { id: 'music', name: 'AI Music Generator', cloud: true, d: 'Generate a short musical idea from a genre and key.', o: [['select', 'Genre', ['Synthwave', 'Lo-fi', 'Ambient', 'House']], ['range', 'Length', 60, 15, 180, ' s'], ['select', 'Key', ['A minor', 'C major', 'F minor']]] },
      { id: 'watermark', name: 'Watermark Cleaner', cloud: false, d: 'Detect and reduce audible watermarks.', o: [['select', 'Method', ['Detect only', 'Remove (experimental)']], ['range', 'Sensitivity', 60, 0, 100, '%']] }] }
  ];
  var AIMAP = {};
  AI.forEach(function (grp) { grp.items.forEach(function (t) { t.g = grp.g; AIMAP[t.id] = t; }); });
  $('#ai-groups').innerHTML = AI.map(function (grp) {
    return '<div class="group"><h2>' + grp.g + ' <small>' + grp.items.length + ' tools</small></h2><div class="grid">' +
      grp.items.map(function (t) {
        return '<a class="card card--tool" href="#/ai/' + t.id + '"><div class="card__top"><span class="card__num">' + t.g.toUpperCase() + '</span><span class="tag ' + (t.cloud ? 'tag--cloud">Cloud' : 'tag--local">Local') + '</span></div><h3>' + t.name + '</h3><p>' + t.d + '</p><span class="card__link">Open ' + t.name + '</span></a>';
      }).join('') + '</div></div>';
  }).join('');

  var aiCur = null, aiTimer;
  function renderAi(id) {
    var t = AIMAP[id]; aiCur = t; clearInterval(aiTimer);
    var words = t.name.split(' '), last = words.pop();
    $('#ai-title').innerHTML = (words.length ? words.join(' ') + ' ' : '') + '<em>' + last.replace('&', '&') + '</em>';
    $('#ai-crumb').textContent = t.name;
    $('#ai-desc').textContent = t.d;
    var tag = $('#ai-tag'); tag.className = 'tag ' + (t.cloud ? 'tag--cloud' : 'tag--local'); tag.textContent = t.cloud ? 'Cloud · asks first' : 'Local';
    $('#ai-controls').innerHTML = t.o.map(function (o, i) {
      if (o[0] === 'range') return '<div class="field"><label for="ao' + i + '">' + o[1] + ' <output id="aoO' + i + '">' + o[2] + o[5] + '</output></label><input id="ao' + i + '" type="range" min="' + o[3] + '" max="' + o[4] + '" value="' + o[2] + '" data-u="' + o[5] + '" data-o="aoO' + i + '"></div>';
      return '<div class="fieldblock"><label for="ao' + i + '">' + o[1] + '</label><select class="input" id="ao' + i + '">' + o[2].map(function (v) { return '<option>' + v + '</option>'; }).join('') + '</select></div>';
    }).join('');
    $$('#ai-controls input[type=range]').forEach(function (r) { r.addEventListener('input', function () { document.getElementById(r.dataset.o).textContent = r.value + r.dataset.u; }); });
    $('#ai-run').textContent = 'Run ' + t.name;
    $('#ai-idle').hidden = false; $('#ai-prog').hidden = true; $('#ai-res').hidden = true;
  }
  function startAi() {
    $('#ai-idle').hidden = true; $('#ai-res').hidden = true; $('#ai-prog').hidden = false;
    var p = 0, bar = $('#ai-bar'); bar.style.width = '0'; clearInterval(aiTimer);
    $('#ai-msg').textContent = aiCur.cloud ? 'Uploading and processing…' : 'Processing on your device…';
    aiTimer = setInterval(function () {
      p += 4 + Math.random() * 7;
      if (p >= 100) { p = 100; clearInterval(aiTimer); $('#ai-prog').hidden = true; $('#ai-res').hidden = false; wave($('#aiw'), 2.2); $('#ai-done-tag').textContent = aiCur.cloud ? 'Done · upload deleted' : 'Done · on device'; }
      bar.style.width = p + '%'; $('#ai-pct').textContent = Math.round(p) + '%';
    }, 110);
  }
  var consent = $('#consent');
  $('#ai-run').addEventListener('click', function () {
    if (aiCur.cloud && consent.showModal) consent.showModal(); else startAi();
  });
  $('#consent-no').addEventListener('click', function () { consent.close(); toast('Nothing was uploaded'); });
  $('#consent-yes').addEventListener('click', function () { consent.close(); startAi(); });
  $$('input[name="ab"]').forEach(function (r) { r.addEventListener('change', function () { wave($('#aiw'), r.value === 'after' ? 2.2 : 1.0); }); });

  /* ---------- visualizer ---------- */
  var cv = $('#viz'), cx = cv.getContext('2d');
  var vs = { style: 'bars', color: '#ff4d1c', sens: 70, playing: true, run: false, loop: false, t: 0, last: 0 };
  var SIZES = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [1000, 1000] };
  function frame(ts) {
    if (!vs.run) { vs.loop = false; return; }
    requestAnimationFrame(frame);
    var dt = (ts - vs.last) / 1000; vs.last = ts; if (dt > 0.1) dt = 0.016;
    if (vs.playing) vs.t += dt;
    var w = cv.width, h = cv.height, k = vs.sens / 100, t = vs.t, i;
    cx.fillStyle = '#050506'; cx.fillRect(0, 0, w, h);
    cx.fillStyle = vs.color; cx.strokeStyle = vs.color;
    if (vs.style === 'bars') {
      var n = 48, bw = w / n;
      for (i = 0; i < n; i++) {
        var a = (0.2 + 0.8 * Math.abs(Math.sin(t * 2.1 + i * 0.35) * Math.cos(t * 0.9 + i * 0.12))) * k;
        var bh = a * h * 0.7; cx.fillRect(i * bw + bw * 0.15, h / 2 - bh / 2, bw * 0.7, bh);
      }
    } else if (vs.style === 'wave') {
      cx.lineWidth = Math.max(3, h / 160); cx.beginPath();
      for (var x = 0; x <= w; x += 4) {
        var y = h / 2 + Math.sin(x / w * 18 + t * 3) * h * 0.18 * k * Math.sin(x / w * 3.1 + t) + Math.sin(x / w * 47 + t * 5) * h * 0.05 * k;
        if (x === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
      }
      cx.stroke();
    } else {
      var m = Math.min(w, h), r0 = m * 0.2; cx.lineWidth = m * 0.012; cx.lineCap = 'round';
      for (i = 0; i < 72; i++) {
        var ang = i / 72 * Math.PI * 2, aa = (0.15 + 0.85 * Math.abs(Math.sin(t * 2 + i * 0.4) * Math.cos(t + i * 0.17))) * k, len = m * 0.24 * aa;
        cx.beginPath(); cx.moveTo(w / 2 + Math.cos(ang) * r0, h / 2 + Math.sin(ang) * r0); cx.lineTo(w / 2 + Math.cos(ang) * (r0 + len), h / 2 + Math.sin(ang) * (r0 + len)); cx.stroke();
      }
    }
  }
  $$('input[name="vs"]').forEach(function (r) { r.addEventListener('change', function () { vs.style = r.value; }); });
  $$('input[name="va"]').forEach(function (r) { r.addEventListener('change', function () {
    var s = SIZES[r.value]; cv.width = s[0]; cv.height = s[1];
    cv.style.maxWidth = r.value === '9:16' ? '380px' : '100%'; cv.style.margin = r.value === '9:16' ? '0 auto' : '0';
  }); });
  $$('#vcol .swatch').forEach(function (b) { b.addEventListener('click', function () { vs.color = b.dataset.c; $$('#vcol .swatch').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); }); });
  $('#vsens').addEventListener('input', function (e) { vs.sens = +e.target.value; $('#vsensO').textContent = vs.sens + '%'; });
  $('#vplay').addEventListener('click', function () { vs.playing = !vs.playing; this.textContent = vs.playing ? '❚❚' : '▶'; this.setAttribute('aria-label', vs.playing ? 'Pause' : 'Play'); });

  /* ---------- boot ---------- */
  if (/[?&]loaded/.test(location.search)) setTrack(true);
  route();
})();