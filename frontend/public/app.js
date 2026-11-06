import {escapeHTML as e,icon,labels,time,taskItem,detailView,timelineView,rulesView,connectionsView,spendingText} from './views.js';
const $=selector=>document.querySelector(selector);
const ui={data:null,nav:'work',filter:'all',selected:null,before:null,online:false,drafts:new Map(),busy:new Set(),traceKey:'',toastTimer:null,action:null};
let refreshPromise=null,detailFingerprint='',traceVersion=0;
async function api(path,body) {
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'x-autoloop-request':'1',...(body!==undefined&&{'content-type':'application/json'})},...(body!==undefined&&{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000),cache:'no-store'});
 const data=await response.json();
 if(!response.ok){const error=new Error(data.error||'请求没有完成。');error.status=response.status;throw error;}
 return data;
}
function toast(message){clearTimeout(ui.toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;ui.toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
const visibleTasks=()=>ui.data?.tasks.filter(task=>ui.filter==='all'||task.status===ui.filter)??[];
function selectedTask(){return visibleTasks().find(task=>task.id===ui.selected)??null;}
function connectionError(error){ui.online=false;$('#error-banner').hidden=false;$('#error-banner').textContent=(error.name==='TimeoutError'?'请求超时，请稍后刷新。':error.message||'连接失败。')+(ui.data?' 显示的是上次同步数据，操作已暂时禁用。':'');$('#service-dot').className='dot offline';$('#service-label').textContent='中台连接中断';$('#try-button').disabled=true;renderDetail();}
async function refresh(force=false){
 if(refreshPromise){if(!force)return refreshPromise;await refreshPromise;}
 const before=ui.before;
 refreshPromise=(async()=>{
  try{
   const data=await api('/api/state'+(before?`?before=${before}`:''));
   if(before!==ui.before)return;
   const first=!ui.data;ui.data=data;ui.online=true;
   if(first&&data.tasks.some(t=>t.status==='attention'))ui.filter='attention';
   $('#error-banner').hidden=true;$('#service-dot').className='dot';$('#service-label').textContent='中台在线';$('#try-button').disabled=false;
   $('#sync-time').textContent='已同步 '+time(data.now,data.timezone);
   render();
  }catch(error){connectionError(error);}finally{refreshPromise=null;}
 })();
 return refreshPromise;
}
function render(){
 const data=ui.data;if(!data)return;
 const counts=Object.fromEntries(['all','attention','running','queued','done'].map(status=>[status,status==='all'?data.tasks.length:data.tasks.filter(t=>t.status===status).length]));
 const tasks=visibleTasks();if(!tasks.some(t=>t.id===ui.selected))ui.selected=tasks[0]?.id??null;
 $('#nav-count').textContent=data.cards.length;
 $('#today-label').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:data.timezone,month:'long',day:'numeric',weekday:'long'}).format(new Date(data.now));
 $('#headline').textContent=counts.attention?`有 ${counts.attention} 件事，等你处理。`:counts.running?'Agent 正在接着处理。':'今天，一切有序。';
 $('#subtitle').textContent=ui.before?'正在查看较早记录，待处理卡片仍会显示。':counts.attention?'做一个决定，后续进展会自动更新。':`当前 ${counts.running} 件进行中、${counts.queued} 件排队；已载入 ${counts.done} 件完成事项。`;
 $('#filters').innerHTML=Object.entries(labels).map(([key,label])=>`<button class="filter" data-filter="${key}" aria-pressed="${ui.filter===key}">${label}<span>${counts[key]}</span></button>`).join('');
 $('#list-label').textContent=ui.before?'较早记录':'最近事项';$('#task-count').textContent=`${tasks.length} 件 · ${tasks.reduce((sum,task)=>sum+task.runs.length,0)} 轮`;
 $('#task-list').innerHTML=tasks.length?tasks.map(task=>taskItem(task,ui.selected,data)).join(''):`<div class="list-empty">${ui.filter==='attention'?'没有需要你处理的事项。':'这个状态下暂时没有事项。'}</div>`;
 $('#pagination').innerHTML=(ui.before?'<button class="button" data-page="latest">返回最近</button>':'')+(data.hasMore?`<button class="button" data-page="${data.nextBefore}">较早记录 ${icon('arrow')}</button>`:'');
 $('#rules-content').innerHTML=rulesView(data);$('#connections-content').innerHTML=connectionsView(data);
 $('#usage-footer').innerHTML=`<span>今天 ${e(spendingText(data.spending.today))}</span><span class="week">最近 7 天 ${e(spendingText(data.spending.week))}</span>`;
 renderDetail();
}
function renderDetail(){
 const task=selectedTask();
 const fingerprint=JSON.stringify([task,ui.online,[...ui.busy]]);
 if(fingerprint===detailFingerprint)return;
 detailFingerprint=fingerprint;
 const detailsOpen=$('#task-detail details')?.open;
 $('#task-detail').innerHTML=detailView(task,ui.data??{agents:[]},{drafts:ui.drafts,busy:ui.busy,online:ui.online});
 if(detailsOpen&&$('#task-detail details'))$('#task-detail details').open=true;
 if(task)loadTrace(task);
}
async function loadTrace(task){
 const request=++traceVersion;
 const host=$('#timeline-content');if(!host)return;
 const basic=[];
 for(const card of task.cards){basic.push({id:`card:${card.id}:created`,at:card.createdAt,type:'ask',title:card.kind==='ask'?'Agent 提出问题':'收到通知',detail:card.title});if(card.decidedAt)basic.push({id:`card:${card.id}:answered`,at:card.decidedAt,type:'answer',title:`${card.by||'本人'}已回答`,detail:card.answer??card.options?.[card.choice]??''});if(card.closedAt)basic.push({id:`card:${card.id}:closed`,at:card.closedAt,type:'closed',title:card.state==='done'?'事项已完成':'卡片已结案',detail:card.result||''});}
 if(!task.runs.length){host.innerHTML=timelineView(basic.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)),ui.data.timezone);return;}
 try{
  const items=[];for(const run of task.runs){const data=await api(`/api/runs/${run.id}/trace`);items.push(...data.timeline);if(request!==traceVersion)return;}
  const unique=[...new Map(items.map(item=>[item.id,item])).values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  if(request===traceVersion&&ui.selected===task.id&&host.isConnected)host.innerHTML=timelineView(unique,ui.data.timezone);
 }catch(error){if(host.isConnected&&request===traceVersion)host.innerHTML=`<p class="trace-error">${e(error.message)} <button class="button ghost" data-retry-trace>重新加载</button></p>`;}
}
function navigate(nav){ui.nav=nav;document.querySelectorAll('[data-nav]').forEach(button=>button.dataset.nav===nav?button.setAttribute('aria-current','page'):button.removeAttribute('aria-current'));for(const name of ['work','rules','connections'])$('#'+name+'-view').hidden=name!==nav;$('#breadcrumb-page').textContent={work:'工作台',rules:'规则',connections:'连接'}[nav];}
function setAction(action){
 ui.action=action;$('#dialog-error').hidden=true;$('#dialog-submit').disabled=false;
 const isTry=action.kind==='try',isResolve=action.kind==='resolve';
 $('#dialog-title').textContent=isTry?'运行一次真实试跑？':isResolve?'给这张卡片结案':'停止这一轮？';
 $('#dialog-description').textContent=isTry?'会调用你已配置的 Agent，并使用模型额度。Agent 将提出一个颜色问题，回答后继续完成。':isResolve?'填写原因后，这张卡片将不再等待回答。':'会请求接单程序终止该轮进程。停止完成前，页面会继续显示正在停止。';
 $('#dialog-fields').innerHTML=isResolve?'<label class="field-label" for="resolve-reason">结案原因</label><textarea id="resolve-reason" name="reason" required maxlength="1000" placeholder="例如：已经手动处理，无需继续。"></textarea>':'';
 $('#dialog-submit').textContent=isTry?'开始试跑':isResolve?'确认结案':'请求停止';
 $('#action-dialog').showModal();
 if(isResolve)$('#resolve-reason').focus();
}
document.addEventListener('click',async event=>{
 const button=event.target.closest('button');if(!button||button.disabled)return;
 if(button.dataset.nav)navigate(button.dataset.nav);
 if(button.dataset.filter){ui.filter=button.dataset.filter;render();}
 if(button.dataset.task){ui.selected=button.dataset.task;render();if(matchMedia('(max-width:620px)').matches)$('#task-detail').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'start'});}
 if(button.hasAttribute('data-page')){ui.before=button.dataset.page==='latest'?null:Number(button.dataset.page);ui.selected=null;await refresh(true);}
 if(button.hasAttribute('data-close-dialog'))$('#action-dialog').close();
 if(button.hasAttribute('data-resolve'))setAction({kind:'resolve',id:Number(button.dataset.resolve),version:Number(button.dataset.version)});
 if(button.hasAttribute('data-cancel'))setAction({kind:'cancel',id:Number(button.dataset.cancel)});
 if(button.hasAttribute('data-retry-trace')&&selectedTask())loadTrace(selectedTask());
});
$('#refresh').addEventListener('click',()=>refresh(true));
$('#try-button').addEventListener('click',()=>setAction({kind:'try',requestId:crypto.randomUUID()}));
function saveDraft(form){
 const id=Number(form.dataset.answerForm);const radio=form.querySelector('input:checked');const text=form.elements.text.value;
 const draft={choice:radio?Number(radio.value):undefined,text};ui.drafts.set(id,draft);
 form.querySelector('[type=submit]').disabled=!ui.online||ui.busy.has(id)||(!radio&&!text.trim());
}
$('#task-detail').addEventListener('change',event=>{const form=event.target.closest('[data-answer-form]');if(!form)return;if(event.target.type==='radio')form.elements.text.value='';saveDraft(form);});
$('#task-detail').addEventListener('input',event=>{const form=event.target.closest('[data-answer-form]');if(!form)return;if(event.target.tagName==='TEXTAREA'&&event.target.value.trim())form.querySelectorAll('input').forEach(input=>input.checked=false);saveDraft(form);});
$('#task-detail').addEventListener('submit',async event=>{
 const form=event.target.closest('[data-answer-form]');if(!form)return;event.preventDefault();
 const id=Number(form.dataset.answerForm);if(!ui.online||ui.busy.has(id))return;saveDraft(form);const draft=ui.drafts.get(id);
 if(!Number.isInteger(draft.choice)&&!draft.text.trim())return;
 ui.busy.add(id);renderDetail();
 try{await api(`/api/cards/${id}/answer`,{version:Number(form.dataset.version),...(draft.text.trim()?{text:draft.text}:{choice:draft.choice})});ui.drafts.delete(id);ui.filter='all';toast('回答已送达，正在等待后续处理。');await refresh(true);}catch(error){toast(error.message);if(error.status===409)await refresh(true);}finally{ui.busy.delete(id);renderDetail();}
});
$('#action-form').addEventListener('submit',async event=>{
 event.preventDefault();const action=ui.action;if(!action||!ui.online)return;
 $('#dialog-submit').disabled=true;$('#dialog-error').hidden=true;
 try{
  if(action.kind==='try'){await api('/api/try',{requestId:action.requestId});ui.before=null;ui.filter='all';ui.selected=null;navigate('work');toast('试跑事件已提交，正在等待 Agent 接单。');}
  else if(action.kind==='resolve'){await api(`/api/cards/${action.id}/resolve`,{version:action.version,reason:$('#resolve-reason').value});ui.filter='all';toast('卡片已结案。');}
  else {await api(`/api/runs/${action.id}/cancel`,{});toast('停止请求已送达，正在等待进程退出。');}
  $('#action-dialog').close();await refresh(true);
 }catch(error){$('#dialog-error').textContent=error.message;$('#dialog-error').hidden=false;if(error.status===409)await refresh(true);}finally{$('#dialog-submit').disabled=false;}
});
$('#action-dialog').addEventListener('close',()=>ui.action=null);
await refresh();
setInterval(()=>{if(!document.hidden)refresh();},3000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
