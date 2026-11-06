// Runs this repository's hub against temporary data and a deterministic worker, without model calls.
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {execFileSync,spawn} from 'node:child_process';
import {setTimeout} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {createHub} from '../lib/hub.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const engine=process.env.AUTOLOOP_ENGINE_HOME||resolve(root,'..');
const cli=join(engine,'bin','agent-autoloop.ts');
const home=await mkdtemp(join(tmpdir(),'autoloop-web-acceptance-'));
const bin=join(home,'bin');await mkdir(bin);for(const name of ['osascript','notify-send'])await writeFile(join(bin,name),'#!/bin/sh\nexit 0\n',{mode:0o755});
const env={...process.env,AGENT_AUTOLOOP_HOME:home,PATH:bin+':'+process.env.PATH};
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const hubPort=socket.address().port;await new Promise(r=>socket.close(r));
let hubProcess,web;let closing=false;
async function cleanup(){if(closing)return;closing=true;if(web){web.closeAllConnections();await new Promise(r=>web.close(r));}if(hubProcess){const exited=new Promise(r=>hubProcess.once('exit',r));hubProcess.kill('SIGTERM');await Promise.race([exited,setTimeout(3000)]);if(hubProcess.exitCode===null)hubProcess.kill('SIGKILL');}await rm(home,{recursive:true,force:true});}
try{
 execFileSync(process.execPath,[cli,'init','--command',`${process.execPath} ${join(root,'test','fixture-agent.mjs')}`,'--no-service','--port',String(hubPort)],{env,stdio:'pipe'});
 for(const file of ['rules.json','config.json']){const p=join(home,file);const d=JSON.parse(await readFile(p,'utf8'));d.channels={};await writeFile(p,JSON.stringify(d),{mode:0o600});}
 const logs=[];hubProcess=spawn(process.execPath,[cli,'up'],{env,stdio:['ignore','pipe','pipe']});hubProcess.stdout.on('data',d=>logs.push(d.toString()));hubProcess.stderr.on('data',d=>logs.push(d.toString()));
 for(let i=0;i<60;i++){try{if((await fetch(`http://127.0.0.1:${hubPort}/healthz`)).ok)break;}catch{}await setTimeout(100);if(i===59)throw new Error('测试中台未启动：'+logs.join('').slice(-1000));}
 const hub=createHub({home});web=createApp({hub,port:0});await new Promise(r=>web.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${web.address().port}`;
 async function request(path,body){const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'x-autoloop-request':'1',...(body!==undefined&&{origin:url,'content-type':'application/json'})},...(body!==undefined&&{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw new Error(`${r.status}: ${data.error}`);return data;}
 async function until(test){for(let i=0;i<100;i++){const s=await request('/api/state');if(test(s))return s;await setTimeout(150);}throw new Error('等待隔离验收结果超时。'+logs.join('').slice(-700));}
 await request('/api/try',{requestId:crypto.randomUUID()});
 let s=await until(s=>s.cards.length===1);const card=s.cards[0];assert.equal(s.tasks.length,1);assert.equal(s.tasks[0].status,'attention');
 await request(`/api/cards/${card.id}/answer`,{version:card.version,choice:1});
 s=await until(s=>s.recentCards.some(c=>c.id===card.id&&c.state==='done'));assert.equal(s.tasks.length,1);assert.equal(s.tasks[0].runs.length,2);assert.match(s.tasks[0].summary,/绿色.*验收通过/);
 console.log('PASS: real hub event → decision → answer → continuation → one completed task');
 await request('/api/try',{requestId:crypto.randomUUID()});s=await until(s=>s.cards.length===1);const second=s.cards[0];
 await request(`/api/cards/${second.id}/resolve`,{version:second.version,reason:'隔离验收：无需继续'});s=await until(s=>s.recentCards.some(c=>c.id===second.id&&c.state==='closed'));
 console.log('PASS: real hub card resolution');
 await hub.call('/v1/events',{method:'POST',identity:'source',body:{id:crypto.randomUUID(),type:'try.slow',subject:'isolated-stop-test'}});s=await until(s=>s.runs.some(r=>r.state==='claimed'));const running=s.runs.find(r=>r.state==='claimed');await request(`/api/runs/${running.id}/cancel`,{});await until(s=>s.runs.some(r=>r.id===running.id&&r.state==='cancelled'));
 console.log('PASS: real hub process cancellation');
 const draft=await request('/api/rules');const edited=JSON.parse(draft.content);edited.rules[0].name='网页保存的试跑规则';
 const invalid=await request('/api/rules/validate',{content:'{'});assert.equal(invalid.valid,false);assert.equal((await request('/api/rules')).version,draft.version);
 const saved=await request('/api/rules',{content:JSON.stringify(edited,null,2)+'\n',version:draft.version});assert.equal(saved.validation.valid,true);
 await until(state=>state.lines.some(rule=>rule.name==='网页保存的试跑规则'));
 console.log('PASS: web rules save → real hub automatically reloads without restart');
 if(process.argv.includes('--serve')){await request('/api/try',{requestId:crypto.randomUUID()});await until(s=>s.cards.length===1);console.log('BROWSER_ACCEPTANCE_URL='+url);for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>cleanup().then(()=>process.exit(0)));}
 else await cleanup();
}catch(error){await cleanup();throw error;}
