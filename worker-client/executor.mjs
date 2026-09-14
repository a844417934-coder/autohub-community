import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { withinRoot, requireValue } from '../server/security.mjs';

// Trusted code chooses this executor. Task data cannot choose code, a shell, or a path.
export async function executeText({ workspace, inputName, outputName }) {
  const input=readFileSync(withinRoot(workspace,inputName));
  requireValue(input.length>0 && input.length<=65536,'Invalid input size');
  let text;
  try { text=new TextDecoder('utf-8',{fatal:true}).decode(input); }
  catch { throw new Error('Demo accepts valid UTF-8 text only'); }
  const result=JSON.stringify({bytes:input.length,lines:text.split(/\r?\n/).length,
    words:text.trim() ? text.trim().split(/\s+/u).length : 0,
    sha256:createHash('sha256').update(input).digest('hex'),uppercase:text.toUpperCase()},null,2)+'\n';
  requireValue(Buffer.byteLength(result)<=65536,'Result exceeds demo size limit');
  writeFileSync(withinRoot(workspace,outputName),result,{flag:'wx'});
  return {outputName};
}
