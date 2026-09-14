// AutoHub LocalDiskStorage protocol: generated identities and temporary -> rename promotion.
import { mkdirSync, writeFileSync, renameSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { withinRoot, identifier, itemIndex, requireValue } from './security.mjs';

export class LocalDiskStorage {
  constructor(root) { mkdirSync(root, { recursive: true }); this.root = root; }
  path(taskId, idx, area) {
    identifier(taskId); itemIndex(idx);
    requireValue(['input', 'result'].includes(area), 'Only final files are accessible');
    return withinRoot(this.root, `tasks/${taskId}/${area}/${idx}.txt`, true);
  }
  put(taskId, idx, area, bytes) {
    requireValue(bytes.length > 0 && bytes.length <= 65536, 'File size must be 1..65536 bytes', 413);
    const target = this.path(taskId, idx, area);
    const temporary = withinRoot(this.root, `tasks/${taskId}/tmp/${randomUUID()}.part`, true);
    try {
      writeFileSync(temporary, bytes, { flag: 'wx' });
      renameSync(temporary, target);
    } finally { rmSync(temporary, { force: true }); }
    return `${area}/${idx}.txt`;
  }
  get(taskId, idx, area) {
    const file = this.path(taskId, idx, area);
    requireValue(existsSync(file), 'File not found', 404);
    return readFileSync(file);
  }
}
