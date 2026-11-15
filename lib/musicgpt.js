import {createHmac, timingSafeEqual} from 'node:crypto';

export const API_ORIGIN = 'https://api.musicgpt.com/api/public';
const TOKEN_PATTERN = /^[0-9a-fA-F-]{36}$/;
export function isTaskId(value) { return typeof value === 'string' && TOKEN_PATTERN.test(value); }
export function getSecrets() {
  return { vendor: process.env.PULSE_MUSICGPT_OWNER_TOKEN, access: process.env.PULSE_MUSICGPT_GENERATION_ACCESS_CODE };
}
export function safeEqual(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const x=Buffer.from(a), y=Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x,y);
}
export function ticketFor(taskId, secret) {
  const expires = Date.now() + 6 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({id:taskId,exp:expires})).toString('base64url');
  const mac=createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}
export function verifyTicket(ticket, secret) {
  if(typeof ticket !== 'string' || ticket.length > 500 || !secret) return null;
  const [payload,signature,...extra]=ticket.split('.');
  if(!payload || !signature || extra.length) return null;
  const correct=createHmac('sha256',secret).update(payload).digest('base64url');
  if(!safeEqual(signature,correct)) return null;
  try { const value=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')); return isTaskId(value.id)&&Number.isFinite(value.exp)&&Date.now()<value.exp?value.id:null; } catch { return null; }
}
export const noStore = res => {res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');};
export const fail = (res,status,message) => res.status(status).json({ok:false,error:message});
export async function upstream(path, options={}) {
  const token=getSecrets().vendor;
  if(!token) throw Object.assign(new Error('MusicGPT token is not configured.'),{status:503});
  let response;
  try { response=await fetch(API_ORIGIN+path,{...options,headers:{Authorization:token,Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{})},signal:AbortSignal.timeout(15000)}); }
  catch { throw Object.assign(new Error('MusicGPT is temporarily unreachable.'),{status:502}); }
  let result;
  try { result=await response.json(); } catch { throw Object.assign(new Error('Unexpected response from MusicGPT.'),{status:502}); }
  if(!response.ok || result?.success===false) {
    const code=response.status===402?402:response.status===429?429:response.status===401||response.status===403?502:502;
    const message=code===402?'MusicGPT account has insufficient credits.':code===429?'MusicGPT rate limit reached.':response.status===401||response.status===403?'MusicGPT rejected authorization.':'MusicGPT could not complete the request.';
    throw Object.assign(new Error(message),{status:code});
  }
  return result;
}
export function urlsFromResult(result) {
  const outputs=[];
  const visit=(value,depth=0)=>{
    if(!value || typeof value!=='object' || depth>4) return;
    if(Array.isArray(value)){for(const entry of value.slice(0,10))visit(entry,depth+1);return;}
    if(value.conversion_path || value.audio_url || value.audioUrl || value.output_url){
      const mp3=value.conversion_path||value.audio_url||value.audioUrl||value.output_url;
      const wav=value.conversion_path_wav;
      const safeUrl=url=>{try{const u=new URL(url);return u.protocol==='https:'?u.href:null;}catch{return null;}};
      if(safeUrl(mp3))outputs.push({title:typeof value.title==='string'?value.title.slice(0,120):'Generated track',audioUrl:safeUrl(mp3),wavUrl:safeUrl(wav)});
    }
    for(const key of ['data','result','results','conversions','items','tracks','outputs','conversion_details']) if(value[key])visit(value[key],depth+1);
  };
  visit(result);return [...new Map(outputs.map(x=>[x.audioUrl,x])).values()].slice(0,2);
}
