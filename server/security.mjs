import { timingSafeEqual } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export function requireValue(ok, message, status = 400) {
  if (!ok) throw Object.assign(new Error(message), { status });
}
export function identifier(value, kind = 'task') {
  const regex = kind === 'task' ? /^t-[a-f0-9]{32}$/ : /^[a-zA-Z][a-zA-Z0-9-]{0,47}$/;
  requireValue(typeof value === 'string' && regex.test(value), 'Invalid identifier');
  return value;
}
export function itemIndex(value) {
  requireValue(/^(0|[1-9][0-9]?)$/.test(String(value)) && Number(value) < 16, 'Invalid item index');
  return Number(value);
}
export function filename(value) {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 100 &&
    !/[\\/:<>"|?*\x00-\x1f]/.test(value) && !value.includes('..') && !/[. ]$/.test(value) &&
    !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value), 'Invalid filename');
  return value;
}
export function secretEqual(actual, expected) {
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected) || typeof actual !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
// Resolve every existing component; reject junctions/symlinks before any write.
// The OS account and filesystem root are trusted: hostile same-account mutation is out of scope.
export function withinRoot(root, rel, createParents = false) {
  requireValue(typeof rel === 'string' && rel && !isAbsolute(rel) && !rel.includes('\\') &&
    !rel.includes(':') && rel.split('/').every(p => p && p !== '.' && p !== '..'), 'Unsafe relative path');
  requireValue(!lstatSync(root).isSymbolicLink(), 'Linked storage root denied');
  const canonical = realpathSync.native(root);
  const target = resolve(canonical, rel);
  const delta = relative(canonical, target);
  requireValue(delta && !isAbsolute(delta) && delta !== '..' && !delta.startsWith(`..${sep}`), 'Path escapes workspace');
  let current = canonical;
  const pieces = rel.split('/');
  for (let i = 0; i < pieces.length; i++) {
    current = resolve(current, pieces[i]);
    const entry = lstatSync(current, { throwIfNoEntry: false });
    if (entry) {
      requireValue(!entry.isSymbolicLink(), 'Linked path denied');
    } else if (createParents && i < pieces.length - 1) mkdirSync(current);
  }
  return target;
}

export async function bodyBytes(req, limit = 65536) {
  const declared = req.headers['content-length'];
  requireValue(declared === undefined || /^\d+$/.test(declared) && Number(declared) <= limit, 'Body too large', 413);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    requireValue(size <= limit, 'Body too large', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function jsonBody(req) {
  try {
    const bytes = await bodyBytes(req, 16384);
    const value = bytes.length ? JSON.parse(bytes.toString('utf8')) : {};
    requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Object required');
    return value;
  } catch (error) {
    if (error instanceof SyntaxError) requireValue(false, 'Invalid JSON');
    throw error;
  }
}
