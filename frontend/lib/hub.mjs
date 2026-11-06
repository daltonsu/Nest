import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class AppError extends Error {
  constructor(status, message) { super(message); this.status=status; }
}
export function createHub({ home = process.env.AGENT_AUTOLOOP_HOME || join(homedir(),'.agent-autoloop') } = {}) {
  async function config() {
    let data;
    try { data=JSON.parse(await readFile(join(home,'config.json'),'utf8')); }
    catch { throw new AppError(503,'无法读取中台配置，请确认 agent-autoloop 已安装。'); }
    if (!data.owner || !data.url) throw new AppError(503,'中台配置缺少本人身份或服务地址。');
    return data;
  }
  async function call(path, {method='GET',body,identity='owner'}={}) {
    const cfg=await config();
    const key=identity==='source'?cfg.source?.key:cfg.owner;
    if (!key) throw new AppError(409,'尚未配置本机事件来源。');
    let response;
    try {
      response=await fetch(cfg.url.replace(/\/$/,'')+path,{method,headers:{authorization:`Bearer ${key}`,...(body!==undefined&&{'content-type':'application/json'})},...(body!==undefined&&{body:JSON.stringify(body)}),signal:AbortSignal.timeout(8000),redirect:'error'});
    } catch { throw new AppError(503,'连接不到中台。请检查 agent-autoloop 服务是否正在运行。'); }
    let data;
    try {data=await response.json();} catch {throw new AppError(502,'中台没有返回有效的数据。');}
    if (!response.ok) {
      if (response.status===401||response.status===403) throw new AppError(503,'中台身份验证失败，请检查本机配置中的权限。');
      throw new AppError(response.status,typeof data?.error==='string'?data.error:'中台请求未完成。');
    }
    return data;
  }
  return {call,config};
}
