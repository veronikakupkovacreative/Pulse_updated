import {encodeWav, extractSegment, getAudioPeaks} from './studio-audio.mjs';

export function initStudioTools() {
  const el = id => document.getElementById(id);
  const qs = s => document.querySelector(s);
  const qsa = s => document.querySelectorAll(s);
  
  const tools = { buffer: null, file: null, loading: false, operation: 0, context: null, source: null, playing: false, previewTimer: null, from: 0, to: 0, peaks: [] };
  
  const durationText = seconds => `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
  const precise = seconds => `${durationText(seconds)}.${String(Math.floor((seconds%1)*10)).padStart(1,'0')}`;
  const readableSize = bytes => `${(bytes/(1024*1024)).toLocaleString('en-US',{maximumFractionDigits:1})} MB`;

  function toast(msg) {
    if(!el('toast')) return;
    el('toast').textContent = msg;
    el('toast').classList.add('show');
    setTimeout(()=>el('toast').classList.remove('show'), 3000);
  }
  function setBusy(busy) { tools.loading = busy; }
  
  window.addEventListener('pulse:file-loaded', async (e) => {
    tools.file = e.detail.file;
    tools.buffer = e.detail.buffer;
    tools.from = 0; 
    tools.to = tools.buffer.duration;
    tools.peaks = getAudioPeaks(tools.buffer.getChannelData(0), 220);
    updateEditorUI();
    updateConverterUI();
  });

  // Editor Playback
  function stopPreview(){
    clearInterval(tools.previewTimer); tools.previewTimer = null;
    if(tools.source){tools.source.onended=null; try{tools.source.stop();}catch{} tools.source.disconnect(); tools.source=null;}
    tools.playing = false;
    if(el('play')) el('play').textContent = '▶';
  }

  async function preview(){
    if(!tools.buffer || tools.loading) return;
    if(tools.playing){ stopPreview(); return; }
    try{
      const Ctx = window.AudioContext || window.webkitAudioContext;
      tools.context ||= new Ctx(); 
      if(tools.context.state === 'suspended') await tools.context.resume();
      
      const from = tools.from, to = tools.to;
      if(to - from < .02) return;
      
      const src = tools.context.createBufferSource();
      src.buffer = tools.buffer;
      
      // Build EQ & Gain graph
      let lastNode = src;
      const eqBands = window.getPulseEQ ? window.getPulseEQ() : null;
      if (eqBands && eqBands.length === 4) {
          const types = ['lowshelf', 'peaking', 'peaking', 'highshelf'];
          eqBands.forEach((band, i) => {
              if(band.g === 0) return;
              const bq = tools.context.createBiquadFilter();
              bq.type = types[i];
              bq.frequency.value = band.f;
              bq.gain.value = band.g;
              if(i === 1 || i === 2) bq.Q.value = band.q;
              lastNode.connect(bq);
              lastNode = bq;
          });
      }
      
      const gainNode = tools.context.createGain();
      lastNode.connect(gainNode);
      gainNode.connect(tools.context.destination);
      
      const fadeIdIn = el('fi') ? Number(el('fi').value) : 0;
      const fadeIdOut = el('fo') ? Number(el('fo').value) : 0;
      const masterGain = el('gn') ? Math.pow(10, Number(el('gn').value)/20) : 1;
      
      const t = tools.context.currentTime;
      gainNode.gain.setValueAtTime(0.001, t);
      gainNode.gain.linearRampToValueAtTime(masterGain, t + fadeIdIn);
      gainNode.gain.setValueAtTime(masterGain, t + to - from - fadeIdOut);
      gainNode.gain.linearRampToValueAtTime(0.001, t + to - from);
      
      src.onended = () => { if(tools.source === src){ stopPreview(); if(el('now')) el('now').textContent = precise(0); }};
      tools.source = src; tools.playing = true;
      src.start(0, from, to - from);
      
      const started = tools.context.currentTime;
      if(el('play')) el('play').textContent = '❚❚';
      
      tools.previewTimer = setInterval(()=>{
          const curr = Math.min(to - from, tools.context.currentTime - started);
          if(el('now')) el('now').textContent = precise(curr);
          const ph = el('playhead');
          if(ph) ph.style.left = (((from + curr) / tools.buffer.duration) * 100) + '%';
      }, 50);
      
    } catch(e){ stopPreview(); console.error(e); }
  }

  function updateEditorUI() {
    if(!tools.buffer) return;
    const baseName = tools.file.name.replace(/\.[^.]+$/, '');
    if(el('edit-filename')) el('edit-filename').value = baseName + '_edit';
    
    const wl = el('wl'), wr = el('wr');
    if(wl && wr) {
      let sl='', sr='';
      const peaks = tools.peaks;
      for (let i = 0; i < peaks.length; i++) {
        let h = Math.max(4, peaks[i] * 90);
        sl += `<rect x="${i}" y="${((100 - h) / 2).toFixed(1)}" width="0.62" height="${h.toFixed(1)}" rx="0.2"/>`;
        sr += `<rect x="${i}" y="${((100 - (h*0.8)) / 2).toFixed(1)}" width="0.62" height="${(h*0.8).toFixed(1)}" rx="0.2"/>`;
      }
      wl.innerHTML = sl; wr.innerHTML = sr;
    }
    
    const timeDisplay = qs('.time small');
    if(timeDisplay) timeDisplay.textContent = `/ ${precise(tools.buffer.duration)}`;
    if(el('now')) el('now').textContent = precise(0);
    
    updateSelectionBox();
  }

  function updateSelectionBox() {
    if(!tools.buffer) return;
    const sel = qs('.selection');
    const tag = qs('.selection__tag');
    if(sel) {
        const startPct = (tools.from / tools.buffer.duration) * 100;
        const widthPct = ((tools.to - tools.from) / tools.buffer.duration) * 100;
        sel.style.left = startPct + '%';
        sel.style.width = widthPct + '%';
    }
    if(tag) tag.textContent = (tools.to - tools.from).toFixed(1) + ' s';
    if(el('sel-start')) el('sel-start').textContent = precise(tools.from);
    if(el('sel-end')) el('sel-end').textContent = precise(tools.to);
    if(el('sel-len')) el('sel-len').textContent = (tools.to - tools.from).toFixed(1) + ' s';
  }

  // Interactive Waveform Dragging
  const waveWrap = qs('.wave-wrap');
  if(waveWrap) {
      waveWrap.addEventListener('pointerdown', e => {
          if(!tools.buffer) return;
          const rect = waveWrap.getBoundingClientRect();
          const clickTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * tools.buffer.duration;
          
          if(Math.abs(clickTime - tools.from) < Math.abs(clickTime - tools.to)) {
              tools.from = clickTime;
          } else {
              tools.to = clickTime;
          }
          if(tools.to < tools.from) { let tmp = tools.to; tools.to = tools.from; tools.from = tmp; }
          updateSelectionBox();
          
          const onMove = moveEvent => {
              const moveTime = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width)) * tools.buffer.duration;
              if(Math.abs(moveTime - tools.from) < Math.abs(moveTime - tools.to)) {
                  tools.from = moveTime;
              } else {
                  tools.to = moveTime;
              }
              if(tools.to < tools.from) { let tmp = tools.to; tools.to = tools.from; tools.from = tmp; }
              updateSelectionBox();
          };
          const onUp = () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); };
          document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
      });
  }

  if(el('play')) el('play').onclick = preview;
  
  // High-fidelity Offline Rendering Core
  async function renderProcessedAudio(buffer, opts) {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const duration = opts.to - opts.from;
    if(duration <= 0) throw new Error("Invalid duration");
    
    const ctx = new Offline(buffer.numberOfChannels, Math.ceil(duration * buffer.sampleRate), buffer.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    
    let lastNode = src;
    if (opts.eqBands && opts.eqBands.length === 4) {
        const types = ['lowshelf', 'peaking', 'peaking', 'highshelf'];
        opts.eqBands.forEach((band, i) => {
            if(band.g === 0) return;
            const bq = ctx.createBiquadFilter();
            bq.type = types[i]; bq.frequency.value = band.f; bq.gain.value = band.g;
            if(i === 1 || i === 2) bq.Q.value = band.q;
            lastNode.connect(bq); lastNode = bq;
        });
    }
    
    const gainNode = ctx.createGain();
    lastNode.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    const masterGain = opts.gain !== undefined ? opts.gain : 1;
    gainNode.gain.setValueAtTime(0.001, 0);
    gainNode.gain.linearRampToValueAtTime(masterGain, opts.fi);
    gainNode.gain.setValueAtTime(masterGain, Math.max(opts.fi, duration - opts.fo));
    gainNode.gain.linearRampToValueAtTime(0.001, duration);
    
    src.start(0, opts.from, duration);
    return await ctx.startRendering();
  }
  
  function bufferToData(buf) { return Array.from({length: Math.min(2, buf.numberOfChannels)}, (_, i) => buf.getChannelData(i)); }

  async function exportEditor() {
    if(!tools.buffer || tools.loading) return;
    const token = ++tools.operation; setBusy(true); stopPreview();
    
    const format = qs('input[name="efmt"]:checked')?.value || 'wav';
    const fi = el('fi') ? Number(el('fi').value) : 0;
    const fo = el('fo') ? Number(el('fo').value) : 0;
    const gainVal = el('gn') ? Math.pow(10, Number(el('gn').value)/20) : 1;
    const eqBands = window.getPulseEQ ? window.getPulseEQ() : null;
    
    const btn = el('edit-export'); const origText = btn.textContent; btn.textContent = 'Processing...';
    
    try {
      const newBuf = await renderProcessedAudio(tools.buffer, { from: tools.from, to: tools.to, fi, fo, gain: gainVal, eqBands });
      if(token !== tools.operation) return;
      
      const data = bufferToData(newBuf);
      if(format === 'wav') {
        const blob = encodeWav(data, tools.buffer.sampleRate, 24); 
        downloadBlob(blob, (el('edit-filename')?.value || 'edit') + '.wav');
      } else {
        btn.textContent = 'Encoding MP3...';
        const blob = await encodeMp3(data, tools.buffer.sampleRate, 320, token);
        downloadBlob(blob, (el('edit-filename')?.value || 'edit') + '.mp3');
      }
    } catch(e) { console.error(e); alert("Export failed"); } finally { if(token === tools.operation) setBusy(false); btn.textContent = origText; }
  }
  if(el('edit-export')) el('edit-export').onclick = exportEditor;

  if(el('btn-trim')) el('btn-trim').onclick = async () => {
    if(!tools.buffer) return;
    const newBuf = await renderProcessedAudio(tools.buffer, { from: tools.from, to: tools.to, fi: 0.005, fo: 0.005, gain: 1 });
    tools.buffer = newBuf; tools.from = 0; tools.to = newBuf.duration;
    tools.peaks = getAudioPeaks(newBuf.getChannelData(0), 220);
    updateEditorUI(); toast("Audio trimmed to selection");
  };

  if(el('btn-cut')) el('btn-cut').onclick = async () => {
    if(!tools.buffer) return;
    const sr = tools.buffer.sampleRate, dur1 = tools.from, dur2 = tools.buffer.duration - tools.to;
    if (dur1 + dur2 <= 0) return;
    
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new Offline(tools.buffer.numberOfChannels, Math.ceil((dur1 + dur2) * sr), sr);
    
    if (dur1 > 0) { const src1 = ctx.createBufferSource(); src1.buffer = tools.buffer; src1.connect(ctx.destination); src1.start(0, 0, dur1); }
    if (dur2 > 0) { const src2 = ctx.createBufferSource(); src2.buffer = tools.buffer; src2.connect(ctx.destination); src2.start(dur1, tools.to, dur2); }
    
    const newBuf = await ctx.startRendering();
    tools.buffer = newBuf; tools.from = 0; tools.to = newBuf.duration;
    tools.peaks = getAudioPeaks(newBuf.getChannelData(0), 220);
    updateEditorUI(); toast("Selection cut from audio");
  };

  // --- CONVERTER UI UPDATES ---
  function updateConverterUI() {
    if(!tools.file) return;
    if(el('conv-files')) {
      el('conv-files').innerHTML = `
        <div class="file">
          <span>${tools.file.name}<br><small>${precise(tools.buffer.duration)} · ${(tools.buffer.sampleRate/1000).toFixed(1)} kHz · ${readableSize(tools.file.size)}</small></span>
          <span class="tag tag--local">Ready</span>
        </div>`;
    }
  }

  async function exportConvert() {
    if(!tools.buffer || tools.loading) return;
    const token = ++tools.operation; setBusy(true);
    
    const format = qs('input[name="cf"]:checked')?.value || 'mp3';
    const rate = Number(el('csr')?.value || 48000);
    const bitrate = Number(el('cbr')?.value || 320);
    
    if(el('cgo')) el('cgo').hidden = true; 
    if(el('cdone')) el('cdone').hidden = true; 
    if(el('cprog')) el('cprog').hidden = false;
    
    try {
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const ctx = new Offline(Math.min(2, tools.buffer.numberOfChannels), Math.ceil(tools.buffer.duration * rate), rate);
      const src = ctx.createBufferSource(); src.buffer = tools.buffer; src.connect(ctx.destination); src.start(0);
      const outBuf = await ctx.startRendering();
      if(token !== tools.operation) return;
      
      const data = bufferToData(outBuf);
      if(format === 'wav') {
        const blob = encodeWav(data, rate, 24);
        downloadBlob(blob, tools.file.name.replace(/\.[^.]+$/, '') + '_converted.wav');
      } else {
        const blob = await encodeMp3(data, rate, bitrate, token);
        downloadBlob(blob, tools.file.name.replace(/\.[^.]+$/, '') + '_converted.mp3');
      }
      if(el('cprog')) el('cprog').hidden = true; 
      if(el('cdone')) el('cdone').hidden = false;
      
    } catch(e) { 
        console.error(e); 
        if(el('cprog')) el('cprog').hidden = true; 
        if(el('cgo')) el('cgo').hidden = false; 
        alert("Conversion failed: " + e.message); 
    } finally { 
        if(token === tools.operation) setBusy(false); 
    }
  }

  if(el('cgo')) el('cgo').onclick = exportConvert;
  if(el('cagain')) el('cagain').onclick = () => { el('cdone').hidden = true; el('cgo').hidden = false; };

  // Helpers
  function downloadBlob(blob, name) {
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  }

  let lamePromise;
  function loadLame(){
    if(window.lamejs?.Mp3Encoder) return Promise.resolve(window.lamejs);
    if(lamePromise) return lamePromise;
    lamePromise = new Promise((resolve,reject)=>{
      const script = document.createElement('script'); 
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.all.min.js';
      script.onload = () => window.lamejs?.Mp3Encoder ? resolve(window.lamejs) : reject();
      script.onerror = reject; document.head.appendChild(script);
    }).catch(e=>{ lamePromise=null; throw new Error("MP3 Encoder not available"); });
    return lamePromise;
  }

  async function encodeMp3(data, sampleRate, bitrate, token) {
    const lame = await loadLame();
    const encoder = new lame.Mp3Encoder(data.length, sampleRate, bitrate);
    const parts = []; const size = 1152;
    
    const int16 = (float, offset, len) => {
      const out = new Int16Array(len);
      for(let i=0; i<len; i++){
        const x = Math.max(-1, Math.min(1, float[offset+i]||0));
        out[i] = x < 0 ? Math.round(32768*x) : Math.round(32767*x);
      }
      return out;
    };

    let p = 0;
    for(let i=0; i<data[0].length; i+=size) {
      if(token !== tools.operation) throw new Error('Canceled');
      const len = Math.min(size, data[0].length - i);
      const left = int16(data[0], i, len);
      const right = data[1] ? int16(data[1], i, len) : undefined;
      const chunk = right ? encoder.encodeBuffer(left, right) : encoder.encodeBuffer(left);
      if(chunk.length) parts.push(new Uint8Array(chunk));
      
      // Update UI Progress for MP3
      if(el('cbar') && (i/size)%90 === 0) {
          p = Math.round(i / data[0].length * 100);
          el('cbar').style.width = p + '%';
          if(el('cpct')) el('cpct').textContent = p + '%';
          await new Promise(r => setTimeout(r, 0));
      }
    }
    const last = encoder.flush();
    if(last.length) parts.push(new Uint8Array(last));
    return new Blob(parts, {type:'audio/mpeg'});
  }
}
