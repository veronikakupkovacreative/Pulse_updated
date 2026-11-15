import {fail, getSecrets, noStore, safeEqual, ticketFor, upstream, isTaskId} from '../lib/musicgpt.js';

// Owner-only: a paid MusicGPT request is never exposed as an anonymous public operation.
// Optional additional rate limiting belongs at the edge if this is opened to many users.
export default async function handler(req,res) {
  noStore(res);
  if(req.method!=='POST') {res.setHeader('Allow','POST');return fail(res,405,'POST required.');}
  const {vendor,access}=getSecrets();
  if(!vendor || !access || access.length<16) return fail(res,503,'Music generation is locked. Configure the server-side owner access code.');
  if(!safeEqual(req.headers['x-pulse-access'],access)) return fail(res,403,'Invalid owner access code.');
  const body=req.body||{};
  const prompt=typeof body.prompt==='string'?body.prompt.trim():'';
  const style=typeof body.style==='string'?body.style.trim():'';
  const instrumental=body.instrumental===true;
  if(!prompt || prompt.length>280 || style.length>80) return fail(res,400,'Enter a prompt of 1–280 characters and a style under 80 characters.');
  const duration=Number(body.duration);
  if(!Number.isInteger(duration)||duration<30||duration>180) return fail(res,400,'Duration must be between 30 and 180 seconds.');
  try {
    const result=await upstream('/v2/MusicAI',{method:'POST',body:JSON.stringify({prompt,music_style:style,make_instrumental:instrumental,output_length:duration,model:'v6'})});
    if(!isTaskId(result.task_id)) return fail(res,502,'MusicGPT did not return a valid task ID. Do not retry immediately; generation might have been charged.');
    return res.status(202).json({ok:true,ticket:ticketFor(result.task_id,access),eta:Number.isFinite(result.eta)?result.eta:null,message:'Generation queued. This may create two charged variants.'});
  } catch(e){return fail(res,e.status||502,e.message||'Music generation failed.');}
}
