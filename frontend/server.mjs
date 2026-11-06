import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {createHub,AppError} from './lib/hub.mjs';
import {buildTasks,traceFor} from './lib/tasks.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const assets=new Map([['/',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/views.js',['views.js','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']],['/favicon.svg',['favicon.svg','image/svg+xml']]]);
const security={
 'cache-control':'no-store', 'x-content-type-options':'nosniff', 'referrer-policy':'no-referrer',
 'x-frame-options':'DENY',
 'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
const positive=value=>/^[1-9][0-9]*$/.test(String(value))&&Number.isSafeInteger(Number(value));
async function jsonBody(req) {
 if (!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')) throw new AppError(415,'请使用 JSON 请求。');
 const chunks=[];let size=0;
 for await (const chunk of req) {size+=chunk.length;if(size>16384)throw new AppError(413,'提交内容过长。');chunks.push(chunk);}
 try {const body=JSON.parse(Buffer.concat(chunks).toString());if(!body||Array.isArray(body)||typeof body!=='object')throw 0;return body;}catch{throw new AppError(400,'提交内容不是有效的 JSON 对象。');}
}
async function mapLimit(items,limit,fn) {
 const results=new Array(items.length);let index=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{for(;;){const i=index++;if(i>=items.length)return;results[i]=await fn(items[i]);}}));
 return results;
}
export function createApp({hub=createHub(),port=3351}={}) {
 const traces=new Map();
 async function factsFor(run,epoch) {
  const signature=JSON.stringify([run.state,run.attempts,run.session,run.summary,run.error,run.stopping,epoch]);
  const cached=traces.get(run.id);
  if(cached?.signature===signature&&Date.now()-cached.at<30000)return cached.facts;
  const facts=await hub.call(`/v1/runs/${run.id}/why`);
  traces.set(run.id,{signature,facts,at:Date.now()});
  if(traces.size>240)traces.delete(traces.keys().next().value);
  return facts;
 }
 async function snapshot(before) {
  const state=await hub.call('/v1/state'+(before?`?before=${before}`:''));
  const epoch=JSON.stringify([...(state.cards??[]),...(state.recentCards??[])].map(c=>[c.id,c.version,c.state]));
  const batches=await mapLimit(state.runs??[],4,run=>factsFor(run,epoch));
  const unique=[...new Map(batches.flat().map(f=>[f.seq,f])).values()];
  return {...state,tasks:buildTasks(state,unique)};
 }
 const server=createServer({requestTimeout:15000,headersTimeout:10000},async(req,res)=>{
  const send=(code,value)=>{res.writeHead(code,{...security,'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  try {
   const bound=server.address()?.port??port;
   const allowed=new Set([`127.0.0.1:${bound}`,`localhost:${bound}`]);
   const host=req.headers.host;
   if(!allowed.has(host))throw new AppError(403,'仅允许从本机地址访问。');
   const origin=`http://${host}`;
   if(req.headers.origin&&req.headers.origin!==origin)throw new AppError(403,'不接受来自其他网站的请求。');
   if(req.headers['sec-fetch-site']==='cross-site')throw new AppError(403,'不接受来自其他网站的请求。');
   const url=new URL(req.url,origin);
   if(req.method==='GET'&&assets.has(url.pathname)) {
    const [name,type]=assets.get(url.pathname);const file=await readFile(resolve(root,'public',name));
    res.writeHead(200,{...security,'content-type':type});return res.end(file);
   }
   if(req.method==='GET'&&url.pathname==='/healthz')return send(200,{ok:true,service:'agent-autoloop-web',version:'0.1.0'});
   if(url.pathname.startsWith('/api/')&&req.headers['x-autoloop-request']!=='1')throw new AppError(403,'请通过工作台访问接口。');
   if(req.method==='GET'&&url.pathname==='/api/state') {
    const before=url.searchParams.get('before');if(before!==null&&!positive(before))throw new AppError(400,'分页编号不正确。');
    return send(200,await snapshot(before));
   }
   const trace=/^\/api\/runs\/([1-9][0-9]*)\/trace$/.exec(url.pathname);
   if(req.method==='GET'&&trace) {
    if(!positive(trace[1]))throw new AppError(400,'轮次编号不正确。');
    return send(200,{timeline:traceFor(await hub.call(`/v1/runs/${trace[1]}/why`))});
   }
   if(req.method==='POST') {
    if(req.headers.origin!==origin)throw new AppError(403,'需要工作台的同源请求。');
    const body=await jsonBody(req);
    const card=/^\/api\/cards\/([1-9][0-9]*)\/(answer|resolve)$/.exec(url.pathname);
    if(card) {
     if(!positive(card[1]))throw new AppError(400,'卡片编号不正确。');
     const state=await hub.call('/v1/state');
     const current=state.cards.find(c=>c.id===Number(card[1]));
     if(!current||current.version!==body.version)throw new AppError(409,'这张卡片已被处理或更新，请刷新后再操作。');
     let payload;
     if(card[2]==='resolve') {
      if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000)throw new AppError(400,'请填写结案原因，最多 1000 字。');
      payload={reason:body.reason.trim()};
     } else {
      const hasChoice=body.choice!==undefined,hasText=typeof body.text==='string'&&body.text.trim().length>0;
      if(hasChoice===hasText)throw new AppError(400,'请选择一个选项，或填写其他回答。');
      if(hasChoice&&(!Number.isInteger(body.choice)||body.choice<0||body.choice>=current.options.length))throw new AppError(400,'选项编号不正确。');
      if(hasText&&body.text.length>4000)throw new AppError(400,'回答最多 4000 字。');
      payload=hasChoice?{choice:body.choice}:{text:body.text.trim()};
     }
     const answer=await hub.call(`/v1/cards/${card[1]}/${card[2]}`,{method:'POST',body:payload});traces.clear();return send(200,answer);
    }
    const cancel=/^\/api\/runs\/([1-9][0-9]*)\/cancel$/.exec(url.pathname);
    if(cancel&&positive(cancel[1])) {const result=await hub.call(`/v1/runs/${cancel[1]}/cancel`,{method:'POST',body:{}});traces.clear();return send(200,result);}
    if(url.pathname==='/api/try') {
     if(typeof body.requestId!=='string'||! /^[0-9a-f-]{36}$/.test(body.requestId))throw new AppError(400,'试跑请求编号不正确。');
     const state=await hub.call('/v1/state');const cfg=await hub.config();
     const matches=state.lines.some(rule=>rule.source===cfg.source?.name&&rule.types.some(type=>type==='try.start'||type==='try.*'||type==='*'));
     if(!matches)throw new AppError(409,'当前没有匹配 try.start 的本机规则，请先配置试跑规则。');
     const result=await hub.call('/v1/events',{method:'POST',identity:'source',body:{id:`web-try-${body.requestId}`,type:'try.start',subject:`web-try-${body.requestId}`,summary:'从 Web 工作台启动试跑'}});traces.clear();return send(200,result);
    }
   }
   throw new AppError(404,'没有这个地址。');
  }catch(error){if(!req.complete)res.setHeader('connection','close');send(error instanceof AppError?error.status:500,error instanceof AppError?{error:error.message}:{error:'工作台暂时无法完成请求。'});}
 });
 return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const port=Number(process.env.AUTOLOOP_WEB_PORT||3351);
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('AUTOLOOP_WEB_PORT 必须是 1–65535。');
 const app=createApp({port});
 app.on('error',error=>{console.error(error.code==='EADDRINUSE'?`端口 ${port} 已被占用。`:error.message);process.exitCode=1;});
 app.listen(port,'127.0.0.1',()=>console.log(`Autoloop 工作台：http://127.0.0.1:${port}`));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{app.close(()=>process.exit(0));app.closeIdleConnections();});
}
