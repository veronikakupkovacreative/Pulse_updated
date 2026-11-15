import {initStudioTools} from './tools.mjs';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const state = {file:null,buffer:null,result:null,key:null,worker:null,busy:false,seq:0};
const toast = message => { const el=$('#toast'); if(!el)return; el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),3500); };
const fmt = t => `${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}.${Math.floor(t%1*10)}`;
const name = () => state.file?.name || 'No audio loaded';
function updateTrack(){
  document.body.dataset.track=state.buffer?'loaded':'none';
  $$('.filechip').forEach(el=>{ const b=el.querySelector('b'); if(b) b.textContent=name(); const meta=el.querySelector('span'); if(meta && state.buffer) meta.textContent=`${fmt(state.buffer.duration)} · ${(state.buffer.sampleRate/1000).toFixed(1)} kHz`; });
  $('#an-rerun').disabled=!state.buffer;
}
function showError(err){const el=$('#error'); el.textContent=typeof err==='string'?err:(err.message || 'Processing error'); el.hidden=false; toast(el.textContent);}
function reset(){state.seq++;state.worker?.terminate();state.worker=null;state.file=null;state.buffer=null;state.result=null;state.key=null;state.busy=false;$('#an-run').hidden=true;$('#an-done').hidden=true;$('#error').hidden=true;updateTrack();window.dispatchEvent(new Event('pulse:bpm-track-ready'));}
function waveform(svg, arr){if(!svg)return; const p=arr||Array(220).fill(0); svg.setAttribute('viewBox','0 0 220 100'); svg.innerHTML=Array.from({length:220},(_,i)=>{const h=Math.max(2,Math.min(96,(p[Math.min(p.length-1,Math.floor(i*p.length/220))]||0)*90));return `<rect x="${i}" y="${(100-h)/2}" width=".64" height="${h}" rx=".15"/>`;}).join('');}
function beatGrid(){const svg=$('#bg');if(!svg)return;waveform(svg,state.result?.waveform);svg.insertAdjacentHTML('beforeend',Array.from({length:32},(_,i)=>`<line class="${i%4===0?'bar':''}" x1="${i*220/32}" x2="${i*220/32}" y1="0" y2="100"/>`).join(''));}
function drawResult(){const r=state.result, k=state.key; if(!r)return;
  $('.metric--hot b').textContent=String(r.bpm);$('.metric--hot small').textContent=typeof r.confidence==='number'?`Confidence ${Math.round(r.confidence*100)}%`:'Estimated tempo';
  const m=$$('.metric b');if(k?.primary){m[1].textContent=k.primary.name+' '+k.primary.mode;m[2].textContent=k.primary.camelot;}else{m[1].textContent='Unavailable';m[2].textContent='—';}
  $('#an-run').hidden=true;$('#an-done').hidden=false;beatGrid();
}
async function processFile(file){if(!file)return;if(file.size>100*1024*1024){showError('Maximum audio size is 100 MB.');return;}
  reset();const seq=state.seq;state.busy=true;state.file=file;$('#an-run').hidden=false;$('#an-pct').textContent='0%';$('#an-bar').style.width='0%';updateTrack();location.hash='#/analyzer';
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)throw Error('AudioContext unsupported');const ctx=new Ctx();let buffer;
    try{buffer=await ctx.decodeAudioData(await file.arrayBuffer());}finally{await ctx.close().catch(()=>{});}
    if(seq!==state.seq)return;if(buffer.duration>1200)throw Error('Maximum track length is 20 minutes.');if(buffer.duration<2)throw Error('Track must be at least 2 seconds.');
    const samples=buffer.getChannelData(0).slice();let keyInput=buffer.getChannelData(0);const stride=Math.max(1,Math.floor(buffer.sampleRate/11025));const n=Math.min(Math.floor(keyInput.length/stride),11025*28);const reduced=new Float32Array(n);for(let i=0;i<n;i++)reduced[i]=keyInput[i*stride];
    const bpm=await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./analysis-worker.mjs', import.meta.url), {type:'module'});state.worker=worker;
      const timer=setTimeout(()=>{worker.terminate();reject(Error('BPM analysis timed out'));},60000);
      worker.onmessage=e=>{clearTimeout(timer);worker.terminate();state.worker=null;e.data.error?reject(Error(e.data.error)):resolve(e.data.result);};
      worker.onerror=()=>{clearTimeout(timer);worker.terminate();state.worker=null;reject(Error('BPM worker failed'));};
      worker.postMessage({samples,sampleRate:buffer.sampleRate},[samples.buffer]);
    });
    if(seq!==state.seq)return;state.result=bpm;state.buffer=buffer;
    state.key=await new Promise(resolve=>{
      const worker=new Worker(new URL('./key-worker.mjs', import.meta.url), {type:'module'});
      const timer=setTimeout(()=>{worker.terminate();resolve(null);},20000);
      worker.onmessage=e=>{clearTimeout(timer);worker.terminate();resolve(e.data.error?null:e.data.result);};worker.onerror=()=>{clearTimeout(timer);worker.terminate();resolve(null);};
      worker.postMessage({samples:reduced,sampleRate:buffer.sampleRate/stride},[reduced.buffer]);
    });
    if(seq!==state.seq)return;window.dispatchEvent(new CustomEvent('pulse:file-loaded',{detail:{file,buffer}}));updateTrack();drawResult();toast('Audio analyzed locally');
  }catch(e){if(seq===state.seq){$('#an-run').hidden=true;showError(e);}}finally{if(seq===state.seq)state.busy=false;}
}
// All controls load a real user file. No fictional demo track.
const input=$('#audio-file-input');document.addEventListener('click',e=>{
  if(e.target.closest('[data-load]')){e.preventDefault();input.click();return;}
  if(e.target.closest('[data-unload]')){e.preventDefault();reset();return;}
  if(e.target.closest('[data-unavailable]')){e.preventDefault();toast(e.target.closest('[data-unavailable]').dataset.unavailable);return;}
  if(e.target.closest('[data-toast]')){e.preventDefault();toast('This action is not connected in the current preview.');return;}
  if(e.target.closest('[data-scroll]')){$('#'+e.target.closest('[data-scroll]').dataset.scroll)?.scrollIntoView({behavior:'smooth'});}
});
input.addEventListener('change',()=>{if(input.files[0])processFile(input.files[0]);input.value='';});
const dz=$('#drop');['dragenter','dragover'].forEach(type=>dz.addEventListener(type,e=>{e.preventDefault();dz.classList.add('is-dragover')}));['dragleave','drop'].forEach(type=>dz.addEventListener(type,e=>{e.preventDefault();dz.classList.remove('is-dragover');if(type==='drop' && e.dataTransfer.files[0])processFile(e.dataTransfer.files[0]);}));
$('#an-rerun').addEventListener('click',()=>{if(state.file)processFile(state.file)});
$$('#filters .chip').forEach(button=>button.onclick=()=>{$$('#filters .chip').forEach(x=>x.setAttribute('aria-pressed',String(button===x)));$$('#toolgrid .card').forEach(c=>c.hidden=button.dataset.f!=='all'&&c.dataset.cat!==button.dataset.f);});
// Keep reference layout and all twelve tool cards. Cloud tools never simulate uploaded results.
const AI=[
  ['Master & mix',[['mastering','AI Mastering',true],['mix','Mix Assistant',true],['stereo','Stereo Lab',false]]],
  ['Voice & stems',[['vocal','Vocal Studio',true],['stems','Stem Extraction',true],['repair','Audio Repair',false]]],
  ['Creative',[['beat','Beat Lab',false],['fx','Smart FX',false],['pitch','Pitch & Time',false]]],
  ['Generate & clean',[['lyrics','Lyrics Generator',true],['music','AI Music Generator',true],['watermark','Watermark Cleaner',false]]]
];
const aiMap={};for(const [group,items] of AI)for(const [id,label,cloud] of items)aiMap[id]={id,label,cloud,group};
$('#ai-groups').innerHTML=AI.map(([group,items])=>`<div class="group"><h2>${group}<small>${items.length} tools</small></h2><div class="grid">${items.map(([id,label,cloud])=>`<a class="card card--tool" href="#/ai/${id}"><div class="card__top"><span class="card__num">${group.toUpperCase()}</span><span class="tag ${cloud?'tag--cloud':'tag--local'}">${cloud?'Cloud':'Local'}</span></div><h3>${label}</h3><p>${id==='music'?'Generate from prompts using MusicGPT with owner-only access.':'Integration pending. This control will not simulate processing.'}</p><span class="card__link">View ${label}</span></a>`).join('')}</div></div>`).join('');
let musicTicket=null,musicPollTimer=null,musicPollCount=0;
function stopMusicPolling(){clearTimeout(musicPollTimer);musicPollTimer=null;musicTicket=null;musicPollCount=0;}
function renderMusicUI(){
  $('#ai-title').textContent='AI Music Generator';
  $('#ai-desc').textContent='Generate a new song from a prompt. MusicGPT processes this in the cloud. Each request can incur credits for two variations.';
  $('#ai-tag').textContent='Cloud · paid';$('#ai-tag').className='tag tag--cloud';
  $('#ai-controls').innerHTML=`
    <div class="fieldblock"><label for="music-prompt">Music prompt (max. 280 characters)</label><textarea class="input" id="music-prompt" rows="4" maxlength="280" placeholder="Dark instrumental lo-fi trap, cold synths, heavy 808 bass, 150 BPM" required style="resize:vertical"></textarea></div>
    <div class="fieldblock"><label for="music-style">Style</label><select class="input" id="music-style"><option>Dark trap</option><option>Lo-fi</option><option>Hip-hop</option><option>Electronic</option><option>Ambient</option><option>House</option><option>Pop</option></select></div>
    <div class="fieldblock"><label for="music-length">Duration (experimental) <output id="music-length-label">60 s</output></label><input type="range" id="music-length" min="30" max="180" step="15" value="60"></div>
    <div class="fieldblock"><label for="music-instrumental"><input id="music-instrumental" type="checkbox" checked> Instrumental only</label></div>
    <div class="fieldblock"><label for="music-access">Owner access code</label><input class="input" id="music-access" type="password" autocomplete="off" placeholder="Owner-only authorization"><p class="note">Separate from your MusicGPT API key. The API key stays on the server.</p></div>
    <p class="note">A charge may occur when you press Generate. Do not retry a request after a network timeout without checking your MusicGPT dashboard.</p>`;
  $('#music-length').oninput=e=>$('#music-length-label').textContent=e.target.value+' s';
  $('#ai-run').disabled=false;$('#ai-run').textContent='Generate music';
  $('#ai-tool-workspace').classList.remove('when-loaded');
  $('#ai-idle').hidden=false;$('#ai-idle').textContent='Enter a prompt, then press Generate music.';
  $('#ai-prog').hidden=true;$('#ai-res').hidden=true;
  const empty=$('[data-view="ai-tool"] .when-empty');if(empty)empty.hidden=true;
}
function renderMusicTracks(tracks){
  const wrapper=$('#ai-res');wrapper.replaceChildren();
  tracks.forEach((track,i)=>{
    const box=document.createElement('div');box.className='block';
    const title=document.createElement('h3');title.textContent=(track.title||'Generated track')+' · '+(i+1);box.append(title);
    const player=document.createElement('audio');player.controls=true;player.preload='none';player.src=track.audioUrl;player.style.width='100%';box.append(player);
    const links=document.createElement('div');links.className='row';
    for(const [url,label] of [[track.audioUrl,'Download audio'],[track.wavUrl,'Download WAV']]){
      if(!url)continue;const a=document.createElement('a');a.className='btn btn--sm';a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label;links.append(a);
    }
    box.append(links);wrapper.append(box);
  });
  wrapper.hidden=false;$('#ai-prog').hidden=true;$('#ai-run').disabled=false;
}
async function pollMusic(){
  if(!musicTicket)return;
  if(++musicPollCount>90){$('#ai-msg').textContent='Still processing. Check MusicGPT dashboard if the result takes longer.';$('#ai-run').disabled=false;return;}
  try{
    const response=await fetch('/api/musicgpt-status?ticket='+encodeURIComponent(musicTicket),{cache:'no-store'});
    const body=await response.json();if(!response.ok)throw Error(body.error||'Status check failed.');
    if(body.status==='failed')throw Error(body.message||'Music generation failed.');
    if(body.tracks?.length){renderMusicTracks(body.tracks);stopMusicPolling();return;}
    $('#ai-msg').textContent=body.message||'MusicGPT is processing your audio…';
    musicPollTimer=setTimeout(pollMusic,6000);
  }catch(error){$('#ai-msg').textContent=error.message+' — Check provider dashboard before starting another generation.';$('#ai-run').disabled=false;stopMusicPolling();}
}
$('#ai-run').addEventListener('click',async()=>{
  if(location.hash!=='#/ai/music'||musicTicket)return;
  const prompt=$('#music-prompt').value.trim(),access=$('#music-access').value;
  if(!prompt){toast('Enter a music prompt.');$('#music-prompt').focus();return;}
  if(!access){toast('Enter your owner access code.');$('#music-access').focus();return;}
  $('#ai-run').disabled=true;$('#ai-res').hidden=true;$('#ai-prog').hidden=false;$('#ai-idle').hidden=true;
  $('#ai-msg').textContent='Submitting to MusicGPT…';$('#ai-pct').textContent='Queued';$('#ai-bar').style.width='0%';
  try{
    const response=await fetch('/api/musicgpt-generate',{method:'POST',headers:{'Content-Type':'application/json','X-Pulse-Access':access},body:JSON.stringify({prompt,style:$('#music-style').value,duration:Number($('#music-length').value),instrumental:$('#music-instrumental').checked})});
    const body=await response.json();if(!response.ok)throw Error(body.error||'MusicGPT request failed.');
    musicTicket=body.ticket;musicPollCount=0;$('#music-access').value='';
    $('#ai-msg').textContent='Queued on MusicGPT. Waiting for real audio…';$('#ai-pct').textContent='Processing';musicPollTimer=setTimeout(pollMusic,4000);
  }catch(error){$('#ai-prog').hidden=true;$('#ai-idle').hidden=false;$('#ai-idle').textContent=error.message;$('#ai-run').disabled=false;}
});
function route(){const p=(location.hash||'#/home').replace(/^#\/?/,'').split('/');let view=p[0];if(view==='ai'&&p[1]){const a=aiMap[p[1]];if(!a){location.hash='#/ai';return;}view='ai-tool';$('#ai-title').textContent=a.label;$('#ai-crumb').textContent=a.label;
  if(a.id==='music'){renderMusicUI();}
  else{const empty=$('[data-view="ai-tool"] .when-empty');if(empty)empty.hidden=false;$('#ai-tool-workspace').classList.add('when-loaded');$('#ai-desc').textContent='This tool is not yet connected to a processing engine.';$('#ai-tag').textContent='Not connected';$('#ai-tag').className='tag tag--soon';$('#ai-controls').innerHTML='<p class="note">Processing controls will appear when the actual engine is available.</p>';$('#ai-run').disabled=true;$('#ai-run').textContent='Not available yet';$('#ai-idle').hidden=false;$('#ai-prog').hidden=true;$('#ai-res').hidden=true;}
  if(a.id!=='music')stopMusicPolling();}
  else stopMusicPolling();
  $$('.view').forEach(v=>v.hidden=v.dataset.view!==view);const tab=view==='ai-tool'?'ai':view;$$('[data-nav]').forEach(link=>link.setAttribute('aria-current',String(link.dataset.nav===tab)));window.scrollTo(0,0);document.title='PULSE Studio — '+(view==='home'?'Audio Workspace':view);
  if(view==='visualizer')startVisuals();else stopVisuals();}
window.addEventListener('hashchange',route);
const eqBands=[{f:80,g:0,q:1},{f:400,g:0,q:1.4},{f:3000,g:0,q:1.2},{f:10000,g:0,q:.8}];let selectedBand=1;window.getPulseEQ=()=>eqBands;
function drawEq(){const W=400,M=75,x=f=>W*Math.log(f/20)/Math.log(1000),y=g=>M-g*(M/14);$('#eqgrid').innerHTML=[20,100,1000,10000].map(f=>`<line class="gridline" x1="${x(f)}" x2="${x(f)}" y1="0" y2="150"/>`).join('')+'<line class="gridline zero" x1="0" x2="400" y1="75" y2="75"/>';
 const points=[];for(let t=0;t<=W;t+=4){let g=0;eqBands.forEach(b=>{const d=(t-x(b.f))/(W/5.5/b.q);g+=b.g*Math.exp(-d*d)});points.push(`L${t},${y(g).toFixed(1)}`);}$('#curve').setAttribute('d',`M0,75 ${points.join(' ')} L400,75 Z`);$('#nodes').innerHTML=eqBands.map((b,i)=>`<circle class="node ${i===selectedBand?'is-active':''}" cx="${x(b.f)}" cy="${y(b.g)}" r="${i===selectedBand?7:5}"/>`).join('');const b=eqBands[selectedBand];$('#ef').value=Math.round(1000*Math.log(b.f/20)/Math.log(1000));$('#eg').value=b.g;$('#eqq').value=b.q;$('#efO').textContent=Math.round(b.f)+' Hz';$('#egO').textContent=b.g.toFixed(1)+' dB';$('#eqO').textContent=b.q.toFixed(1);}
$$('.bands .chip').forEach(x=>x.addEventListener('click',()=>{selectedBand=Number(x.dataset.b);$$('.bands .chip').forEach(b=>b.setAttribute('aria-pressed',String(b===x)));drawEq()}));$('#ef').oninput=e=>{eqBands[selectedBand].f=20*Math.pow(1000,e.target.value/1000);drawEq()};$('#eg').oninput=e=>{eqBands[selectedBand].g=Number(e.target.value);drawEq()};$('#eqq').oninput=e=>{eqBands[selectedBand].q=Number(e.target.value);drawEq()};drawEq();
for(const [id,out,suffix] of [['fi','fiO',' s'],['fo','foO',' s'],['gn','gnO',' dB']]){$('#'+id).oninput=e=>{$('#'+out).textContent=Number(e.target.value).toFixed(1)+suffix};}
// Converter and editor use actual Web Audio processing via initStudioTools.
$$('input[name="cf"]').forEach(r=>r.onchange=()=>{$('#cbr-wrap').hidden=!['mp3'].includes($('input[name="cf"]:checked').value)});
for(const fmt of ['flac','aac','ogg']){const r=$(`input[name="cf"][value="${fmt}"]`);if(r){r.disabled=true;r.closest('label').title='Not available in this browser build';}}
for(const fmt of ['m4a','flac']){const r=$(`input[name="efmt"][value="${fmt}"]`);if(r){r.disabled=true;r.closest('label').title='Not available in this browser build';}}
// Real visualizer uses the decoded buffer and frequency bins, not the prototype timer.
let visualFrame=0,analyser=null,visualSource=null,ctx=null,visualStyle='bars',visualColor='#ff4d1c';const canvas=$('#viz');
function stopVisuals(){cancelAnimationFrame(visualFrame);visualFrame=0;if(visualSource){try{visualSource.stop()}catch{}visualSource=null}$('#vplay').textContent='▶';}
function paintVisual(){const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;c.fillStyle='#050506';c.fillRect(0,0,w,h);c.fillStyle=visualColor;c.strokeStyle=visualColor;const bins=new Uint8Array(analyser?.frequencyBinCount||128);analyser?.getByteFrequencyData(bins);const scale=Number($('#vsens').value)/100;
 if(visualStyle==='bars'){for(let i=0;i<48;i++){const val=(bins[i]||0)/255;const bh=val*h*.85*scale;c.fillRect(i*w/48+2,h-bh,w/48-4,bh)}}else if(visualStyle==='wave'){c.beginPath();for(let i=0;i<bins.length;i++){const x=i*w/(bins.length-1),y=h/2-(bins[i]/255)*h*.4*scale;i?c.lineTo(x,y):c.moveTo(x,y)}c.stroke();}else{const n=72,m=Math.min(w,h);for(let i=0;i<n;i++){const angle=i*Math.PI*2/n,length=((bins[i]||0)/255)*m*.24*scale;c.beginPath();c.moveTo(w/2+Math.cos(angle)*m*.18,h/2+Math.sin(angle)*m*.18);c.lineTo(w/2+Math.cos(angle)*(m*.18+length),h/2+Math.sin(angle)*(m*.18+length));c.stroke()}}visualFrame=requestAnimationFrame(paintVisual);}
function startVisuals(){if(!visualFrame)paintVisual()}
$('#vplay').onclick=async()=>{if(visualSource){stopVisuals();startVisuals();return}if(!state.buffer){toast('Load audio first');return}ctx||=new (window.AudioContext||window.webkitAudioContext)();await ctx.resume();const source=ctx.createBufferSource();source.buffer=state.buffer;analyser=ctx.createAnalyser();source.connect(analyser);analyser.connect(ctx.destination);source.onended=()=>{visualSource=null;$('#vplay').textContent='▶'};source.start();visualSource=source;$('#vplay').textContent='❚❚'};
$$('input[name="vs"]').forEach(r=>r.onchange=()=>visualStyle=r.value);$$('input[name="va"]').forEach(r=>r.onchange=()=>{const map={'16:9':[1280,720],'9:16':[720,1280],'1:1':[1000,1000]};[canvas.width,canvas.height]=map[r.value]});$$('#vcol .swatch').forEach(b=>b.onclick=()=>{visualColor=b.dataset.c;$$('#vcol .swatch').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))});$('#vsens').oninput=e=>$('#vsensO').textContent=e.target.value+'%';
// Unsupported editor buttons never claim that they have edited audio.
$$('.toolbar .tool').forEach(b=>{if(['Select','Trim','Cut','Fade in','Fade out','Reverse','Gain','Merge','↶','↷','−','+'].some(x=>b.textContent.trim().startsWith(x))){if(!b.hasAttribute('disabled'))b.addEventListener('click',()=>{if(!['Select','Trim','Cut'].some(x=>b.textContent.startsWith(x)))toast('Use the available selection and fade/gain controls below.');});}});
$$('[data-slot="chip"]').forEach(el=>el.outerHTML='<div class="filechip when-loaded"><i class="dot" aria-hidden="true"></i><b>Audio</b><span></span><button class="btn btn--sm" data-unload>Replace</button></div>');
$$('[data-slot="empty"]').forEach(el=>el.outerHTML=`<div class="empty when-empty"><div class="dropzone__icon">+</div><h2>No track loaded yet</h2><p>${el.dataset.msg}</p><button class="btn btn--primary" data-load>Choose audio file</button></div>`);
// Disable false success buttons from the reference prototype.
for(const t of ['Undo','Redo','Merge','Reverse','Export PNG','Export video','Copy tags']){const btn=$$('button').find(el=>el.textContent.trim()===t);if(btn){btn.disabled=true;btn.title='Not implemented in this version';}}
$('#consent-yes').disabled=true;$('#consent-no').onclick=()=>$('#consent').close();
initStudioTools();reset();route();
