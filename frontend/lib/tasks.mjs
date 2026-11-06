const at = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

export function buildTasks(state, facts = []) {
  const runs = state.runs ?? [];
  const parents = new Map();
  const find = id => {
    if (!parents.has(id)) parents.set(id, id);
    if (parents.get(id) !== id) parents.set(id, find(parents.get(id)));
    return parents.get(id);
  };
  const union = (a, b) => {
    const left = find(a), right = find(b);
    if (left !== right) parents.set(Math.max(left, right), Math.min(left, right));
  };
  const cardRows = new Map(), relations = new Map();
  for (const fact of [...facts].sort((a,b)=>a.seq-b.seq)) {
    for (const {table,key,row} of fact.changes ?? []) {
      if (table === 'cards') row ? cardRows.set(Number(key), row) : cardRows.delete(Number(key));
      if (table === 'run_events') row ? relations.set(key, row) : relations.delete(key);
    }
  }
  // Only an explicit answered-card relationship joins rounds. Session reuse is not task identity.
  for (const card of cardRows.values()) {
    if (!card.run_id) continue;
    find(card.run_id);
    for (const relation of relations.values()) {
      if (card.answer_event && relation.event_id === card.answer_event) union(card.run_id, relation.run_id);
    }
  }
  const tasks = new Map();
  const get = id => {
    if (!tasks.has(id)) tasks.set(id, { id, runs: [], cards: [] });
    return tasks.get(id);
  };
  for (const run of runs) get(`run:${find(run.id)}`).runs.push(run);
  const cards = new Map([...(state.recentCards ?? []), ...(state.cards ?? [])].map(card=>[card.id,card]));
  for (const card of cards.values()) {
    const origin = cardRows.get(card.id)?.run_id;
    const id = origin ? `run:${find(origin)}` : `card:${card.id}`;
    get(id).cards.push(card);
  }
  for (const task of tasks.values()) {
    task.runs.sort((a,b)=>a.id-b.id);
    task.cards.sort((a,b)=>b.id-a.id);
    const latest = task.runs.at(-1), recent = task.cards[0];
    const open = task.cards.find(c=>c.state==='open');
    const root = task.runs[0];
    task.title = open?.title || recent?.title || root?.events?.find(e=>e.summary)?.summary || [root?.rule,root?.events?.[0]?.subject].filter(Boolean).join(' · ') || '未命名事项';
    task.rule = latest?.rule || recent?.rule || '外部事项';
    task.agent = latest?.agent || null;
    task.status = open || task.runs.some(r=>r.state==='unknown') ? 'attention'
      : task.runs.some(r=>r.state==='claimed') ? 'running'
      : task.runs.some(r=>r.state==='queued') || task.cards.some(c=>c.state==='decided') ? 'queued' : 'done';
    task.updatedAt = [ ...task.runs.flatMap(r=>[r.finishedAt,r.claimedAt,r.createdAt]), ...task.cards.flatMap(c=>[c.closedAt,c.decidedAt,c.createdAt]) ].filter(Boolean).sort((a,b)=>at(b)-at(a))[0] ?? null;
    task.summary = open?.text || recent?.result || latest?.error || latest?.summary || (task.status==='queued'?'等待接单程序领取':'');
    task.link = [...task.runs].reverse().find(r=>r.link)?.link || recent?.link || null;
    task.stopped = task.runs.length>0 && task.runs.every(r=>r.state==='cancelled');
  }
  const priority = {attention:0,running:1,queued:2,done:3};
  return [...tasks.values()].sort((a,b)=>priority[a.status]-priority[b.status] || at(b.updatedAt)-at(a.updatedAt));
}

export function traceFor(facts) {
  const timeline = [], previous = new Map();
  const add = (fact, key, type, title, detail='', runId=null, when=fact.at) => { const at=new Date(when).toISOString();timeline.push({id:`${key}:${type}:${at}`,at,type,title,detail,runId}); };
  for (const fact of [...facts].sort((a,b)=>a.seq-b.seq)) {
    const changes = new Map((fact.changes??[]).map(change=>[`${change.table}:${change.key}`,change]));
    for (const [key,{table,row}] of changes) {
      const before = previous.get(key);
      if (row && table==='events' && !before) add(fact,key,'event',row.type==='card.answered'?'回答触发继续处理':'收到事件', [row.type,row.subject,row.summary].filter(Boolean).join(' · '));
      if (row && table==='runs') {
        if (row.claimed_at && row.claimed_at!==before?.claimed_at) add(fact,key,'run',`第 ${row.id} 轮开始`,row.agent,row.id,row.claimed_at);
        if (row.finished_at && row.finished_at!==before?.finished_at) add(fact,key,'done',`第 ${row.id} 轮${row.state==='cancelled'?'已停止':'结束'}`,row.summary||row.error||'没有填写结论',row.id,row.finished_at);
        if (row.state==='queued' && row.attempts>0 && row.attempts!==before?.attempts) add(fact,key,'error',`第 ${row.id} 轮等待重试`,row.error||'',row.id);
      }
      if (row && table==='cards') {
        if (!before) add(fact,key,'ask',row.kind==='ask'?'Agent 提出问题':'Agent 发来通知',row.title,row.run_id,row.created_at);
        if (row.decided_at && row.decided_at!==before?.decided_at) {
          let options=[];try{options=typeof row.options==='string'?JSON.parse(row.options):row.options??[];}catch{}
          add(fact,key,'answer',`${row.by||'本人'}已回答`,row.answer??options[row.choice]??'',row.run_id,row.decided_at);
        }
        if (row.state==='closed' && before?.state!=='closed') add(fact,key,'closed','卡片已结案',row.result||row.title,row.run_id,row.created_at);
      }
      row ? previous.set(key,row) : previous.delete(key);
    }
  }
  return timeline;
}
