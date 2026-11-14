import {initStudioTools} from './tools.mjs';
const $ = selector => document.querySelector(selector);
const ui = Object.fromEntries(['file-input','drop-zone','upload-empty','processing','track-content','result-panel','result-empty','result-controls','result-note','result-status','bpm-number','error','live-status'].map(id=>[id,$('#'+id)]));
const state = {file:null,generation:0,busy:false,worker:null,cancelWorker:null,buffer:null,result:null,bpm:0,factor:1,context:null,source:null,playing:false,starting:false,offset:0,startedAt:0,raf:0,metroTimer:null,metroNext:0,metroBeat:0,metroNodes:new Set(),beatTimers:new Set()};
const messages = {
  TOO_SHORT:'Track too short. Use at least 6 seconds.',
  SILENCE:'Silence or weak audio. Try a track with a clear beat.',
  NO_RHYTHM:'No steady beat detected. Try another section or Tap Tempo.',
  DECODE:'Cannot decode audio. Try WAV, MP3 or MP4 with AAC audio.',
  TIMEOUT:'Analysis timed out. Try a shorter track.'
};
const timeLabel = seconds => `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const bpmLabel = value => Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.',',');

function announce(text) { ui['live-status'].textContent=text; }
function showError(message) { ui.error.textContent=message; ui.error.hidden=false; }
let toastTimer;
function toast(text) { $('#toast').textContent=text; $('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,2500); }

function setBusy(busy) {
  state.busy=busy;
  $('#an-run').hidden=!busy;
  $('#an-done').hidden=true;
  if(busy) {
      $('#an-pct').textContent = '0%';
      $('#an-bar').style.width = '0%';
  }
}

function stopPlayback() {
  if(state.source){state.source.onended=null;try{state.source.stop();}catch{}state.source.disconnect();state.source=null;}
  state.playing=false;
}

function reset() {
  state.generation++;state.cancelWorker?.();state.cancelWorker=null;state.worker?.terminate();state.worker=null;stopPlayback();state.file=null;state.buffer=null;state.result=null;window.dispatchEvent(new Event('pulse:bpm-track-ready'));state.offset=0;state.bpm=0;state.factor=1;state.starting=false;
  
  setBusy(false);
  $('#an-run').hidden=true;
  $('#an-done').hidden=true;
  setTrack(false);
}

async function processFile(file) {
  if(!file||state.busy)return;
  ui.error.hidden=true;
  if(!/\.(wav|mp3|mp4)$/i.test(file.name)){showError('Unsupported format. Use WAV, MP3 or MP4.');return;}
  if(file.size>100*1024*1024){showError('File exceeds 100 MB. Choose a smaller file.');return;}
  if(file.size===0){showError('Empty file. Try another.');return;}
  
  reset();
  const generation=state.generation;
  setBusy(true);
  
  try {
    const OfflineContext=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    if(!OfflineContext)throw new Error('Audio analysis is not supported in this browser.');
    let buffer;
    try { const decoder=new OfflineContext(1,1,22050);buffer=await decoder.decodeAudioData(await file.arrayBuffer()); }
    catch { throw new Error('DECODE'); }
    if(generation!==state.generation)return;
    if(buffer.duration>1200)throw new Error('Track exceeds 20 minutes.');
    if(buffer.duration<6)throw new Error('TOO_SHORT');
    
    let bestChannel=0,bestEnergy=-1;
    for(let ch=0;ch<buffer.numberOfChannels;ch++) {const data=buffer.getChannelData(ch);let energy=0;for(let i=0;i<data.length;i+=32)energy+=data[i]*data[i];if(energy>bestEnergy){bestEnergy=energy;bestChannel=ch;}}
    const samples=buffer.getChannelData(bestChannel).slice();
    
    const result=await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./analysis-worker.mjs',import.meta.url),{type:'module'});state.worker=worker;
      const timeout=setTimeout(()=>{worker.terminate();reject(new Error('TIMEOUT'));},60000);
      state.cancelWorker=()=>{clearTimeout(timeout);worker.terminate();reject(new Error('CANCELLED'));};
      worker.onmessage=({data})=>{clearTimeout(timeout);worker.terminate();if(state.worker===worker){state.worker=null;state.cancelWorker=null;}data.error?reject(new Error(data.error)):resolve(data.result);};
      worker.onerror=()=>{clearTimeout(timeout);worker.terminate();state.cancelWorker=null;reject(new Error('Analysis failed to start. Refresh and retry.'));};
      worker.postMessage({samples,sampleRate:buffer.sampleRate},[samples.buffer]);
      
      // Simulate progress bar visually since worker doesn't report it
      let p=0;
      let pTimer=setInterval(()=>{
          p+=Math.random()*15;
          if(p>95) p=95;
          if(state.worker===null) {
              clearInterval(pTimer);
              p=100;
          }
          $('#an-bar').style.width = p + '%'; 
          $('#an-pct').textContent = Math.round(p) + '%';
      }, 300);
    });
    
    if(generation!==state.generation)return;
    state.file=file;state.buffer=buffer;state.result=result;window.dispatchEvent(new Event('pulse:bpm-track-ready'));state.bpm=result.bpm;
    setBusy(false);
    
    renderResult(file);
    
  } catch(error) {
    if(generation!==state.generation)return;
    setBusy(false);showError(messages[error.message]||error.message);
  }
}

function renderResult(file) {
  $$('.metric--hot b')[0].textContent = state.result.bpm;
  
  setTrack(true, file.name);
  $('#an-run').hidden = true; 
  $('#an-done').hidden = false;
  drawBeat(state.result.waveform);
}


/* ---------- UI and Drag&Drop wiring ---------- */
var CHIP = '<div class="filechip when-loaded"><i class="dot" aria-hidden="true"></i><b id="loaded-filename">night-drive_demo.wav</b><span id="loaded-fileinfo"></span><button class="btn btn--sm" type="button" data-unload>Replace</button></div>';
$$('[data-slot="chip"]').forEach(function (e) { e.outerHTML = CHIP; });
$$('[data-slot="empty"]').forEach(function (e) {
  e.outerHTML = '<div class="empty when-empty"><div class="dropzone__icon" aria-hidden="true">+</div><h2>No track loaded yet</h2><p>' + e.dataset.msg + '</p><button class="btn btn--primary" type="button" data-load>Load demo track</button><p class="note">Upload any audio file to begin.</p></div>';
});

let currentFile = null; 
var dz = $('#drop');

['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, x => { 
    x.preventDefault(); 
    dz.classList.add('is-dragover'); 
}));

['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, x => { 
    x.preventDefault(); 
    dz.classList.remove('is-dragover'); 
    if (ev === 'drop' && x.dataTransfer.files.length > 0) { 
        currentFile = x.dataTransfer.files[0];
        processFile(currentFile);
        location.hash = '#/analyzer'; 
    } 
}));

dz.addEventListener('click', () => {
    let input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = e => {
        if (e.target.files.length > 0) {
            currentFile = e.target.files[0];
            processFile(currentFile);
            location.hash = '#/analyzer';
        }
    };
    input.click();
});

function drawBeat(waveform) {
  var svg = $('#bg'); 
  var s = '';
  if(waveform) {
      const len = waveform.length;
      for (let i = 0; i < len; i++) {
        let h = Math.max(4, waveform[i] * 96);
        s += '<rect x="' + i + '" y="' + ((100 - h) / 2).toFixed(1) + '" width="0.62" height="' + h.toFixed(1) + '" rx="0.2"/>';
      }
  } else {
      // Fallback
      for (let i = 0; i < 220; i++) {
        s += '<rect x="' + i + '" y="48" width="0.62" height="4" rx="0.2"/>';
      }
  }
  
  var lines = '';
  for (var i = 0; i < 32; i++) {
    var x = (i * 220 / 32 + 1).toFixed(1);
    lines += '<line class="' + (i % 4 === 0 ? 'bar' : '') + '" x1="' + x + '" x2="' + x + '" y1="0" y2="100"/>';
  }
  svg.innerHTML = s + lines;
}

function setTrack(v, name = "night-drive_demo.wav") {
  document.body.dataset.track = v ? 'loaded' : 'none';
  if (v) {
      $$('#loaded-filename').forEach(el => el.textContent = name);
  } else {
      currentFile = null;
  }
}

document.addEventListener('click', function (e) {
  var t;
  if ((t = e.target.closest('[data-load]'))) {
    if (!currentFile) {
        // Create dummy file for "demo track" click
        setTrack(true);
        $('#an-run').hidden = false;
        setTimeout(()=>{
            $('#an-run').hidden = true;
            $('#an-done').hidden = false;
            $$('.metric--hot b')[0].textContent = "124";
            drawBeat();
        }, 1500);
    }
    if (t.dataset.go) location.hash = '#/' + t.dataset.go;
    else toast('Demo track loaded');
    return;
  }
  if ((t = e.target.closest('[data-unload]'))) { reset(); toast('Audio removed'); return; }
  if ((t = e.target.closest('[data-toast]'))) { toast(t.dataset.toast); return; }
});

/* Router and layout code... */
var KNOWN = { home: 1, analyzer: 1, tagger: 1, editor: 1, converter: 1, ai: 1, visualizer: 1 };
var NAVMAP = { analyzer: 'analyzer', tagger: 'analyzer', editor: 'editor', converter: 'converter', ai: 'ai', 'ai-tool': 'ai', visualizer: 'visualizer' };
function route() {
  var h = location.hash.replace(/^#\/?/, '') || 'home';
  var parts = h.split('/'), name = parts[0], view = name;
  if (!KNOWN[name]) return;
  $$('.view').forEach(function (v) { v.hidden = v.dataset.view !== view; });
  var nv = NAVMAP[view];
  $$('[data-nav]').forEach(function (a) { if (a.dataset.nav === nv) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// Initialize original tool handlers for editor and converter compatibility
initStudioTools(()=>({file:state.file,buffer:state.buffer,bpm:state.bpm}));

// Trigger route on load
if (/[?&]loaded/.test(location.search)) setTrack(true);
route();
