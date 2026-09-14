import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
function walk(dir) { for(const ent of readdirSync(dir,{withFileTypes:true})) {
  const path=join(dir,ent.name);
  if(ent.isDirectory()) walk(path);
  else if(path.endsWith('.mjs')) execFileSync(process.execPath,['--check',path],{stdio:'inherit',windowsHide:true});
} }
for(const dir of ['server','worker-client','scripts','tests']) walk(dir);
console.log('JavaScript syntax checks passed (no TypeScript runtime or placeholder lint command).');
