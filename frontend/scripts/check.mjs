import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=new URL('..',import.meta.url).pathname;
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.name.startsWith('.'))continue;const path=join(dir,entry.name);if(entry.isDirectory())await walk(path);else if(/\.(?:mjs|js)$/.test(entry.name))execFileSync(process.execPath,['--check',path],{stdio:'inherit'});}}
await walk(root);console.log('全部 JavaScript 语法检查通过。');
