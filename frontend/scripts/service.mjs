import {existsSync,mkdirSync,readFileSync,writeFileSync,realpathSync,unlinkSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import {setTimeout} from 'node:timers/promises';
if(process.platform!=='darwin')throw new Error('自动常驻脚本目前适用于 macOS。其他系统请运行 npm start。');
const root=dirname(dirname(fileURLToPath(import.meta.url))),label='agent-autoloop-web',domain=`gui/${process.getuid()}`;
const plist=join(homedir(),'Library','LaunchAgents',`${label}.plist`);
const action=process.argv[2],program=join(root,'server.mjs');
const home=process.env.AGENT_AUTOLOOP_HOME||join(homedir(),'.agent-autoloop');
const port=Number(process.env.AUTOLOOP_WEB_PORT||3351);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('端口不正确。');
const xml=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const booted=()=>spawnSync('launchctl',['print',`${domain}/${label}`],{stdio:'ignore'}).status===0;
async function stop(){if(booted()){execFileSync('launchctl',['bootout',`${domain}/${label}`]);for(let i=0;i<50&&booted();i++)await setTimeout(100);}}
if(action==='status'){console.log(booted()?'工作台服务正在运行。':'工作台服务未运行。');}
else if(action==='stop'){await stop();console.log('工作台已停止。重新启动：npm run service:install');}
else if(action==='remove'){
 if(existsSync(plist)&&!readFileSync(plist,'utf8').includes(xml(program)))throw new Error('已有其他路径的同名工作台服务，请先核对。');
 await stop();if(existsSync(plist))unlinkSync(plist);console.log('工作台已停止，并取消登录启动。');
}
else if(action==='install'){
 if(existsSync(plist)&&!readFileSync(plist,'utf8').includes(xml(program)))throw new Error('已有其他路径的同名工作台服务，请先核对。');
 let executable=process.execPath;
 const stable='/opt/homebrew/opt/node/bin/node';if(existsSync(stable)&&realpathSync(stable)===realpathSync(executable))executable=stable;
 const logs=join(home,'web-logs');mkdirSync(logs,{recursive:true,mode:0o700});mkdirSync(dirname(plist),{recursive:true});
 await stop();
 writeFileSync(plist,`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(executable)}</string><string>${xml(program)}</string></array><key>WorkingDirectory</key><string>${xml(root)}</string><key>EnvironmentVariables</key><dict><key>AGENT_AUTOLOOP_HOME</key><string>${xml(home)}</string><key>AUTOLOOP_WEB_PORT</key><string>${port}</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${xml(join(logs,'server.log'))}</string><key>StandardErrorPath</key><string>${xml(join(logs,'server.log'))}</string></dict></plist>\n`,{mode:0o600});
 execFileSync('launchctl',['bootstrap',domain,plist]);console.log(`工作台已启用登录后常驻：http://127.0.0.1:${port}`);
}else throw new Error('用法：node scripts/service.mjs install|stop|remove|status');
