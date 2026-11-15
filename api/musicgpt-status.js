import {fail, getSecrets, noStore, verifyTicket, upstream, urlsFromResult} from '../lib/musicgpt.js';
export default async function handler(req,res) {
  noStore(res);
  if(req.method!=='GET'){res.setHeader('Allow','GET');return fail(res,405,'GET required.');}
  const {vendor,access}=getSecrets();
  if(!vendor||!access) return fail(res,503,'MusicGPT is not configured.');
  const task=verifyTicket(req.query?.ticket,access);
  if(!task)return fail(res,403,'Invalid or expired generation ticket.');
  try {
    const params=new URLSearchParams({conversionType:'MUSIC_AI',task_id:task});
    const result=await upstream('/v1/byId?'+params.toString());
    const tracks=urlsFromResult(result);
    const raw=String(result.status||result.data?.status||result.result?.status||'').toUpperCase();
    const error=['FAILED','ERROR','CANCELED'].includes(raw);
    return res.status(200).json({ok:true,status:error?'failed':tracks.length?'completed':raw==='COMPLETED'?'completed':'processing',tracks,message:error?'MusicGPT failed to generate audio.':tracks.length?'Audio ready.':raw==='COMPLETED'?'Generation complete but audio URLs are not available yet.':'Generation in progress.'});
  } catch(e){return fail(res,e.status||502,e.message||'Could not retrieve generation status.');}
}
