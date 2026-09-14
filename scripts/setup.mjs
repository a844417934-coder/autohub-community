import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function setup(file='.local/config.json',ports={port:43170,adminPort:43171}) {
  const target=resolve(file);
  mkdirSync(dirname(target),{recursive:true});
  const config={host:'127.0.0.1',...ports,browserKey:randomBytes(32).toString('hex'),workerKey:randomBytes(32).toString('hex')};
  writeFileSync(target,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
  return config;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  setup(process.argv[2]);
  console.log('Created .local/config.json. Keep both generated keys private. Re-running setup refuses to overwrite.');
}
