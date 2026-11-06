// Deterministic local worker used only by the isolated acceptance environment.
import {readFile} from 'node:fs/promises';
import {setTimeout} from 'node:timers/promises';
const context=JSON.parse(await readFile(process.env.AGENT_AUTOLOOP_CONTEXT,'utf8'));
if(context.events.some(e=>e.type==='try.slow')) {await setTimeout(60000);console.log('慢任务完成。');}
else if(context.answers.length) {const a=context.answers.at(-1);console.log(`你选了${a.text??a.options[a.choice]}，MVP 验收通过。`);}
else console.log('问了一个问题。\n\n```agent-autoloop\n'+JSON.stringify({ask:[{title:'MVP 验收：选一个颜色',text:'这是隔离测试任务，不调用付费模型。',options:['蓝色','绿色'],key:'mvp-color'}]})+'\n```');
