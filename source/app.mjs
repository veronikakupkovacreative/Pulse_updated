import {initStudioTools} from './tools.mjs';

const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);

const state = {file:null, generation:0, busy:false, worker:null, cancelWorker:null, buffer:null, result:null, keyResult:null};

function announce(text) { if($('#live-status')) $('#live-status').textContent=text; }
function showError(message) { if($('#error')) { $('#error').textContent=message; $('#error').hidden=false; } else { toast("Error: " + message); } }

let toastTimer;
function toast(text) { 
  if(!$('#toast')) return;
  $('#toast').textContent=text; 
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{ $('#toast').classList.remove('show'); }, 3000); 
}

function setBusy(busy) {
  state.busy = busy;
  if($('#an-run')) $('#an-run').hidden = !busy;
  if($('#an-done')) $('#an-done').hidden = true;
  if(busy && $('#an-pct')) {
      $('#an-pct').textContent = '0%';
      $('#an-bar').style.width = '0%';
  }
}

function reset() {
  state.generation++; state.cancelWorker?.(); state.cancelWorker=null; state.worker?.terminate(); state.worker=null;
  state.file = null; state.buffer = null; state.result = null; state.keyResult = null;
  window.dispatchEvent(new Event('pulse:bpm-track-ready'));
  setBusy(false);
  if($('#an-run')) $('#an-run').hidden = true;
  if($('#an-done')) $('#an-done').hidden = true;
  setTrack(false);
}

async function processFile(file) {
  if(!file || state.busy) return;
  if($('#error')) $('#error').hidden = true;
  if(!/\.(wav|mp3|mp4|m4a|aac|ogg|flac|aiff|aif)$/i.test(file.name)){ showError('Unsupported format. Try WAV or MP3.'); return; }
  if(file.size > 100*1024*1024){ showError('File exceeds 100 MB.'); return; }
  
  reset();
  const generation = state.generation;
  setBusy(true);
  
  try {
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if(!OfflineContext) throw new Error('Audio analysis is not supported in this browser.');
    let buffer;
    try { 
        const ctx = window.AudioContext ? new window.AudioContext() : new window.webkitAudioContext();
        buffer = await ctx.decodeAudioData(await file.arrayBuffer()); 
    } catch { throw new Error('Could not decode audio.'); }
    
    if(generation !== state.generation) return;
    if(buffer.duration > 1200) throw new Error('Track exceeds 20 minutes.');
    if(buffer.duration < 2) throw new Error('Track too short.');
    
    // Prepare for BPM
    let bestChannel = 0, bestEnergy = -1;
    for(let ch=0; ch<buffer.numberOfChannels; ch++) {
        const data = buffer.getChannelData(ch);
        let energy = 0;
        for(let i=0; i<data.length; i+=32) energy += data[i]*data[i];
        if(energy > bestEnergy) { bestEnergy = energy; bestChannel = ch; }
    }
    const samples = buffer.getChannelData(bestChannel).slice();
    
    // Prepare for Key Detection
    const sr = buffer.sampleRate, step = Math.max(1, Math.round(sr/11025)), dstRate = sr/step;
    const input = buffer.getChannelData(0), segments = [];
    const duration = buffer.duration, chunk = Math.min(duration, 10), positions = duration>18 ? [.08,.43,.78] : [0];
    for(const p of positions){
        const start = Math.max(0, Math.min(input.length - Math.floor(chunk*sr), Math.floor(duration*p*sr)));
        const count = Math.floor(chunk*dstRate), data = new Float32Array(count);
        for(let i=0; i<count; i++) data[i] = input[Math.min(input.length-1, start+i*step)];
        segments.push(data);
    }
    const merged = new Float32Array(segments.reduce((a,b)=>a+b.length, 0));
    let off = 0; for(const c of segments){ merged.set(c, off); off+=c.length; }

    const bpmPromise = new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./analysis-worker.mjs', import.meta.url), {type:'module'});
      state.worker = worker;
      const timeout = setTimeout(()=>{ worker.terminate(); reject(new Error('TIMEOUT')); }, 60000);
      state.cancelWorker = ()=>{ clearTimeout(timeout); worker.terminate(); reject(new Error('CANCELLED')); };
      worker.onmessage = ({data})=>{ clearTimeout(timeout); worker.terminate(); if(state.worker===worker){ state.worker=null; state.cancelWorker=null; } data.error ? reject(new Error(data.error)) : resolve(data.result); };
      worker.onerror = ()=>{ clearTimeout(timeout); worker.terminate(); state.cancelWorker=null; reject(new Error('Failed')); };
      worker.postMessage({samples, sampleRate:buffer.sampleRate}, [samples.buffer]);
      
      let p=0;
      let pTimer=setInterval(()=>{
          p+=Math.random()*15; if(p>95) p=95;
          if(state.worker===null) { clearInterval(pTimer); p=100; }
          if($('#an-bar')) { $('#an-bar').style.width = p + '%'; $('#an-pct').textContent = Math.round(p) + '%'; }
      }, 300);
    });

    const keyPromise = new Promise((resolve) => {
      const kworker = new Worker(new URL('./key-worker.mjs', import.meta.url), {type:'module'});
      kworker.onmessage = ({data})=>{ kworker.terminate(); data.error ? resolve(null) : resolve(data.result); };
      kworker.onerror = ()=>{ kworker.terminate(); resolve(null); };
      kworker.postMessage({samples:merged, sampleRate:dstRate}, [merged.buffer]);
    });
    
    const [result, keyResult] = await Promise.all([bpmPromise, keyPromise]);
    
    if(generation !== state.generation) return;
    state.file = file; state.buffer = buffer; state.result = result; state.keyResult = keyResult;
    window.dispatchEvent(new CustomEvent('pulse:file-loaded', {detail: {file: file, buffer: buffer}}));
    setBusy(false);
    
    renderResult(file);
    
  } catch(error) {
    if(generation !== state.generation) return;
    setBusy(false); showError(error.message);
  }
}

function renderResult(file) {
  if($$('.metric--hot b')[0]) $$('.metric--hot b')[0].textContent = state.result.bpm;
  if(state.keyResult && $$('.metric b')[1] && $$('.metric b')[2]) {
      $$('.metric b')[1].textContent = state.keyResult.primary.name + (state.keyResult.primary.mode === 'minor' ? ' minor' : ' major');
      $$('.metric b')[2].textContent = state.keyResult.primary.camelot;
  }
  
  setTrack(true, file.name);
  if($('#an-run')) $('#an-run').hidden = true; 
  if($('#an-done')) $('#an-done').hidden = false;
  drawBeat(state.result.waveform);
}

function drawBeat(waveform) {
  var svg = $('#bg'); 
  if(!svg) return;
  var s = '';
  if(waveform) {
      const len = waveform.length;
      for (let i = 0; i < len; i++) {
        let h = Math.max(4, waveform[i] * 96);
        s += `<rect x="${i}" y="${((100 - h) / 2).toFixed(1)}" width="0.62" height="${h.toFixed(1)}" rx="0.2"/>`;
      }
  } else {
      for (let i = 0; i < 220; i++) s += `<rect x="${i}" y="48" width="0.62" height="4" rx="0.2"/>`;
  }
  var lines = '';
  for (var i = 0; i < 32; i++) {
    var x = (i * 220 / 32 + 1).toFixed(1);
    lines += `<line class="${(i % 4 === 0 ? 'bar' : '')}" x1="${x}" x2="${x}" y1="0" y2="100"/>`;
  }
  svg.innerHTML = s + lines;
}

function setTrack(v, name = "night-drive_demo.wav") {
  document.body.dataset.track = v ? 'loaded' : 'none';
  if (v) {
      $$('#loaded-filename').forEach(el => el.textContent = name);
  }
}

/* EQ Visualization & State */
var eqW = 400, eqH = 150, eqMID = 75, eqFMIN = 20, eqFMAX = 20000;
var eqBands = [{ f: 80, g: 0, q: 1.0 }, { f: 400, g: 0, q: 1.4 }, { f: 3000, g: 0, q: 1.2 }, { f: 10000, g: 0, q: 0.8 }];
var eqSel = 1;
function eqX(f) { return eqW * (Math.log(f / eqFMIN) / Math.log(eqFMAX / eqFMIN)); }
function eqY(g) { return eqMID - g * (eqMID / 14); }

function drawEq() {
  const eqgrid = $('#eqgrid'), curve = $('#curve'), nodes = $('#nodes');
  if(!eqgrid || !curve || !nodes) return;
  
  if(eqgrid.innerHTML === '') {
      let gr = '';
      [20, 100, 1000, 10000].forEach(f => {
        gr += `<line class="gridline" x1="${eqX(f)}" x2="${eqX(f)}" y1="0" y2="${eqH}"/><text x="${eqX(f) + 3}" y="${eqH - 4}">${f >= 1000 ? (f / 1000) + 'k' : f}</text>`;
      });
      gr += `<line class="gridline zero" x1="0" x2="${eqW}" y1="${eqMID}" y2="${eqMID}"/>`;
      [12, -12].forEach(d => { gr += `<text x="3" y="${eqY(d) + (d > 0 ? 10 : -3)}">${d > 0 ? '+' : ''}${d}</text>`; });
      eqgrid.innerHTML = gr;
  }
  
  const pts = [];
  for (let x = 0; x <= eqW; x += 4) {
    let g = 0; 
    eqBands.forEach(b => { 
        const d = (x - eqX(b.f)) / (eqW / 5.5 / b.q); 
        g += b.g * Math.exp(-d * d); 
    });
    pts.push([x, eqY(Math.max(-13, Math.min(13, g)))]);
  }
  curve.setAttribute('d', `M0,${eqMID} ` + pts.map(p => `L${p[0]},${p[1].toFixed(1)}`).join(' ') + ` L${eqW},${eqMID} Z`);
  nodes.innerHTML = eqBands.map((b, i) => `<circle class="node${i === eqSel ? ' is-active' : ''}" cx="${eqX(b.f).toFixed(1)}" cy="${eqY(b.g).toFixed(1)}" r="${i === eqSel ? 7 : 5.5}"/>`).join('');
  
  const b = eqBands[eqSel];
  if($('#ef')) {
      $('#ef').value = Math.round(1000 * Math.log(b.f / eqFMIN) / Math.log(eqFMAX / eqFMIN)); 
      $('#eg').value = b.g; 
      $('#eqq').value = b.q;
      $('#efO').textContent = b.f >= 1000 ? (b.f / 1000).toFixed(1) + ' kHz' : Math.round(b.f) + ' Hz';
      $('#egO').textContent = (b.g > 0 ? '+' : '') + b.g.toFixed(1) + ' dB'; 
      $('#eqO').textContent = b.q.toFixed(1);
  }
}
window.getPulseEQ = () => eqBands;

// Wire EQ UI
if($('#ef')) {
    $('#ef').addEventListener('input', e => { eqBands[eqSel].f = eqFMIN * Math.pow(eqFMAX / eqFMIN, e.target.value / 1000); drawEq(); });
    $('#eg').addEventListener('input', e => { eqBands[eqSel].g = +e.target.value; drawEq(); });
    $('#eqq').addEventListener('input', e => { eqBands[eqSel].q = +e.target.value; drawEq(); });
    $$('.bands .chip').forEach(c => { 
        c.addEventListener('click', () => { 
            eqSel = +c.dataset.b; 
            $$('.bands .chip').forEach(x => x.setAttribute('aria-pressed', x === c ? 'true' : 'false')); 
            drawEq(); 
        }); 
    });
    drawEq();
}

/* AI Studio / Fake Tagger interaction */
var AI = [
  { g: 'Master & mix', items: [
    { id: 'mastering', name: 'AI Mastering', cloud: true, d: 'Balance loudness, tone and stereo image for release-ready masters.', o: [['range', 'Loudness target', -14, -24, -6, ' LUFS'], ['select', 'Tone', ['Warm', 'Neutral', 'Bright']], ['range', 'Limiter ceiling', -1, -3, 0, ' dBTP']] }
  ]}
];
var AIMAP = {}; AI.forEach(grp => grp.items.forEach(t => { t.g = grp.g; AIMAP[t.id] = t; }));
if($('#ai-groups')) {
  $('#ai-groups').innerHTML = AI.map(grp => `<div class="group"><h2>${grp.g} <small>${grp.items.length} tools</small></h2><div class="grid">${grp.items.map(t => `<a class="card card--tool" href="#/ai/${t.id}"><div class="card__top"><span class="card__num">${t.g.toUpperCase()}</span><span class="tag ${t.cloud ? 'tag--cloud">Cloud' : 'tag--local">Local'}</span></div><h3>${t.name}</h3><p>${t.d}</p><span class="card__link">Open ${t.name}</span></a>`).join('')}</div></div>`).join('');
}
var aiTimer;
function startAi() {
  $('#ai-idle').hidden = true; $('#ai-res').hidden = true; $('#ai-prog').hidden = false;
  var p = 0, bar = $('#ai-bar'); bar.style.width = '0'; clearInterval(aiTimer);
  aiTimer = setInterval(() => {
    p += 4 + Math.random() * 7;
    if (p >= 100) { p = 100; clearInterval(aiTimer); $('#ai-prog').hidden = true; $('#ai-res').hidden = false; drawBeat(); }
    bar.style.width = p + '%'; $('#ai-pct').textContent = Math.round(p) + '%';
  }, 110);
}

/* Event listeners */
var dz = $('#drop');
['dragenter', 'dragover'].forEach(ev => dz?.addEventListener(ev, x => { x.preventDefault(); dz.classList.add('is-dragover'); }));
['dragleave', 'drop'].forEach(ev => dz?.addEventListener(ev, x => { 
    x.preventDefault(); dz.classList.remove('is-dragover'); 
    if (ev === 'drop' && x.dataTransfer.files.length > 0) { 
        processFile(x.dataTransfer.files[0]);
        location.hash = '#/analyzer'; 
    } 
}));
dz?.addEventListener('click', () => {
    let input = document.createElement('input'); input.type = 'file'; input.accept = 'audio/*';
    input.onchange = e => { if(e.target.files.length > 0) { processFile(e.target.files[0]); location.hash = '#/analyzer'; } };
    input.click();
});

document.addEventListener('click', function (e) {
  var t;
  if ((t = e.target.closest('[data-load]'))) {
    if (!state.buffer) toast('Please upload a file via the Dropzone first.');
    if (t.dataset.go) location.hash = '#/' + t.dataset.go;
    return;
  }
  if ((t = e.target.closest('[data-unload]'))) { reset(); toast('Audio removed'); return; }
  if ((t = e.target.closest('[data-toast]'))) { toast(t.dataset.toast); return; }
  
  // Tagger Copy
  if(e.target.textContent && e.target.textContent.includes('Copy tags')) {
      if(navigator.clipboard) navigator.clipboard.writeText('Synthwave, Electronic, Synth pad, Drum machine, Nocturnal, Driving').then(()=>toast('Tags copied to clipboard.'));
  }
});

/* Router */
function route() {
  var h = location.hash.replace(/^#\/?/, '') || 'home';
  var parts = h.split('/'), name = parts[0], view = name;
  $$('.view').forEach(v => v.hidden = v.dataset.view !== view);
  
  if (name === 'ai' && parts[1]) {
      var t = AIMAP[parts[1]];
      if(t) {
        clearInterval(aiTimer);
        $('#ai-title').innerHTML = `<em>${t.name}</em>`; $('#ai-desc').textContent = t.d;
        $('#ai-idle').hidden = false; $('#ai-prog').hidden = true; $('#ai-res').hidden = true;
      }
  }

  $$('[data-nav]').forEach(a => a.setAttribute('aria-current', (a.dataset.nav === (name==='ai-tool'?'ai':name) ? 'true' : 'false')));
  window.scrollTo(0, 0);
  vs.run = (view === 'visualizer');
  if (vs.run && !vs.loop) { vs.loop = true; requestAnimationFrame(frame); }
}
window.addEventListener('hashchange', route);

/* Visualizer (Live AudioContext) */
var cv = $('#viz');
var vs = { style: 'bars', color: '#ff4d1c', sens: 70, playing: false, run: false, loop: false, t: 0, last: 0, source: null, analyser: null, data: null, audioCtx: null };

if($('#vplay')) {
  $('#vplay').onclick = async () => {
      if(!state.buffer) { toast("No audio loaded."); return; }
      if(vs.playing) {
          vs.playing = false;
          if(vs.source) { try{vs.source.stop();}catch{} vs.source.disconnect(); vs.source = null; }
          $('#vplay').textContent = '▶';
          return;
      }
      
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if(!vs.audioCtx) vs.audioCtx = new Ctx();
      if(vs.audioCtx.state === 'suspended') await vs.audioCtx.resume();
      
      vs.source = vs.audioCtx.createBufferSource();
      vs.source.buffer = state.buffer;
      
      vs.analyser = vs.audioCtx.createAnalyser();
      vs.analyser.fftSize = 512;
      vs.data = new Uint8Array(vs.analyser.frequencyBinCount);
      
      vs.source.connect(vs.analyser);
      vs.analyser.connect(vs.audioCtx.destination);
      vs.source.start(0);
      
      vs.playing = true;
      $('#vplay').textContent = '❚❚';
      vs.source.onended = () => { vs.playing = false; $('#vplay').textContent = '▶'; };
  };
}

function frame(ts) {
  if (!vs.run) { vs.loop = false; return; }
  requestAnimationFrame(frame);
  if(!cv) return;
  var cx = cv.getContext('2d');
  var w = cv.width, h = cv.height;
  
  cx.fillStyle = '#050506'; cx.fillRect(0, 0, w, h);
  cx.fillStyle = vs.color; cx.strokeStyle = vs.color;
  
  if(!vs.playing) {
      var dt = (ts - vs.last) / 1000; vs.last = ts; if (dt > 0.1) dt = 0.016;
      vs.t += dt;
      var k = ($('#vsens') ? $('#vsens').value : 70) / 100;
      
      if (vs.style === 'bars') {
        var n = 48, bw = w / n;
        for (var i = 0; i < n; i++) {
          var a = (0.2 + 0.8 * Math.abs(Math.sin(vs.t * 2.1 + i * 0.35) * Math.cos(vs.t * 0.9 + i * 0.12))) * k;
          var bh = a * h * 0.5; cx.fillRect(i * bw + bw * 0.15, h - bh, bw * 0.7, bh);
        }
      } else if (vs.style === 'wave') {
        cx.lineWidth = Math.max(3, h / 160); cx.beginPath();
        for (var x = 0; x <= w; x += 4) {
          var y = h / 2 + Math.sin(x / w * 18 + vs.t * 3) * h * 0.18 * k * Math.sin(x / w * 3.1 + vs.t) + Math.sin(x / w * 47 + vs.t * 5) * h * 0.05 * k;
          if (x === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
        }
        cx.stroke();
      } else {
        var m = Math.min(w, h), r0 = m * 0.2; cx.lineWidth = m * 0.012; cx.lineCap = 'round';
        for (var i = 0; i < 72; i++) {
          var ang = i / 72 * Math.PI * 2, aa = (0.15 + 0.85 * Math.abs(Math.sin(vs.t * 2 + i * 0.4) * Math.cos(vs.t + i * 0.17))) * k, len = m * 0.24 * aa;
          cx.beginPath(); cx.moveTo(w / 2 + Math.cos(ang) * r0, h / 2 + Math.sin(ang) * r0); cx.lineTo(w / 2 + Math.cos(ang) * (r0 + len), h / 2 + Math.sin(ang) * (r0 + len)); cx.stroke();
        }
      }
      return;
  }
  
  if(vs.analyser && vs.data) {
      var k = ($('#vsens') ? $('#vsens').value : 70) / 100;
      if (vs.style === 'bars') {
          vs.analyser.getByteFrequencyData(vs.data);
          var n = 64, bw = w / n;
          for(var i=0; i<n; i++) {
              var v = vs.data[i] / 255.0;
              var bh = v * h * k * 1.5;
              cx.fillRect(i * bw + bw * 0.1, h - bh, bw * 0.8, bh);
          }
      } else if (vs.style === 'wave') {
          vs.analyser.getByteTimeDomainData(vs.data);
          cx.lineWidth = Math.max(3, h / 160); cx.beginPath();
          var slice = w / vs.data.length;
          for(var i=0; i<vs.data.length; i++) {
              var v = vs.data[i] / 128.0;
              var y = v * h / 2;
              if(i===0) cx.moveTo(i*slice, y); else cx.lineTo(i*slice, y);
          }
          cx.stroke();
      } else {
          vs.analyser.getByteFrequencyData(vs.data);
          var m = Math.min(w, h), r0 = m * 0.2; cx.lineWidth = m * 0.012; cx.lineCap = 'round';
          var n = 72;
          for (var i = 0; i < n; i++) {
            var ang = (i / n) * Math.PI * 2;
            var v = (vs.data[i] / 255.0) * k * 1.5;
            var len = m * 0.25 * v;
            cx.beginPath(); cx.moveTo(w / 2 + Math.cos(ang) * r0, h / 2 + Math.sin(ang) * r0); cx.lineTo(w / 2 + Math.cos(ang) * (r0 + len), h / 2 + Math.sin(ang) * (r0 + len)); cx.stroke();
          }
      }
  }
}
$$('input[name="vs"]').forEach(r => r.addEventListener('change', () => vs.style = r.value));
$$('#vcol .swatch').forEach(b => b.addEventListener('click', () => { vs.color = b.dataset.c; $$('#vcol .swatch').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); }));
if($('#vsens')) $('#vsens').addEventListener('input', e => { vs.sens = +e.target.value; $('#vsensO').textContent = vs.sens + '%'; });

initStudioTools();
route();
