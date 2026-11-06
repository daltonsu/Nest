// Prevent unrelated work from merging and preserve pending decisions across execution rounds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTasks } from '../lib/tasks.mjs';
const run = (id, extra = {}) => ({ id, rule: '试一下', agent: 'codex', state: 'done', session: 'same-session', createdAt: `2026-11-06T03:32:${String(id).padStart(2,'0')}Z`, summary: '完成', events: [], ...extra });
const card = (extra = {}) => ({ id: 7, kind: 'ask', state: 'done', title: '选一个颜色', options: ['蓝色','绿色'], choice: 1, rule: '试一下', createdAt: '2026-11-06T03:32:10Z', ...extra });
const facts = [{seq: 1, at: 1793935920000, type:'answer', changes:[
 {table:'cards',key:'7',row:{id:7,run_id:1,answer_event:4}},
 {table:'run_events',key:'2:4',row:{run_id:2,event_id:4}}
]}];
test('an answer and its queued continuation remain one task even before a session exists',()=>{
 const tasks=buildTasks({runs:[run(2,{state:'queued',session:null}),run(1)],cards:[],recentCards:[card({state:'decided'})]},facts);
 assert.equal(tasks.length,1);assert.deepEqual(tasks[0].runs.map(r=>r.id),[1,2]);assert.equal(tasks[0].status,'queued');assert.equal(tasks[0].cards[0].id,7);
});
test('sharing a rule and session does not merge independent tasks',()=>{
 assert.equal(buildTasks({runs:[run(1),run(2)],cards:[],recentCards:[]},[]).length,2);
});
test('an open decision takes precedence over a finished run',()=>{
 const tasks=buildTasks({runs:[run(1)],cards:[card({state:'open'})],recentCards:[]},facts);
 assert.equal(tasks[0].status,'attention');assert.equal(tasks[0].title,'选一个颜色');
});
test('a decision outside loaded history stays actionable as a separate card',()=>{
 const tasks=buildTasks({runs:[],cards:[card({state:'open'})],recentCards:[]},[]);
 assert.equal(tasks[0].id,'card:7');assert.equal(tasks[0].status,'attention');assert.equal(tasks[0].runs.length,0);
});
test('same timestamp and title cannot attach an unrelated card',()=>{
 const tasks=buildTasks({runs:[run(1)],cards:[card({state:'open'})],recentCards:[]},[]);
 assert.equal(tasks.length,2);assert.equal(tasks.find(t=>t.id==='run:1').cards.length,0);
});
test('unknown execution is surfaced as attention and not success',()=>{
 assert.equal(buildTasks({runs:[run(1,{state:'unknown'})],cards:[],recentCards:[]},[])[0].status,'attention');
});

test('partial histories identify the same start by the original timestamp, not the enclosing later fact',async()=>{
 const {traceFor}=await import('../lib/tasks.mjs');
 const row={id:1,agent:'codex',claimed_at:'2026-11-06T03:32:00.000Z'};
 const first=traceFor([{seq:1,at:1793935920000,type:'claimNext',changes:[{table:'runs',key:'1',row}]}]);
 const later=traceFor([{seq:8,at:1793935980000,type:'finish',changes:[{table:'runs',key:'1',row:{...row,state:'done',finished_at:'2026-11-06T03:33:00.000Z'}}]}]);
 assert.equal(first[0].id,later[0].id);assert.equal(later[0].at,row.claimed_at);
});
