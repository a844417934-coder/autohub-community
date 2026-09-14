import { readFileSync, mkdirSync, lstatSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { requireValue, withinRoot } from './security.mjs';

export function readConfig(file = '.local/config.json') {
  const full = resolve(file);
  const input = JSON.parse(readFileSync(full, 'utf8'));
  const keys = ['host', 'port', 'adminPort', 'browserKey', 'workerKey', 'server', 'allowedHosts'];
  requireValue(Object.keys(input).every(k => keys.includes(k)), 'Unknown configuration setting');
  const host = input.host ?? '127.0.0.1';
  requireValue(host === '127.0.0.1' || host === '0.0.0.0', 'Unsupported bind address');
  const port = input.port ?? 43170, adminPort = input.adminPort ?? 43171;
  for (const p of [port, adminPort]) requireValue(Number.isInteger(p) && p >= 43000 && p <= 43999, 'Ports must be in the dedicated demo range');
  requireValue(port !== adminPort, 'Ports must differ');
  requireValue(/^[a-f0-9]{64}$/.test(input.browserKey ?? ''), 'Generate a browser key with npm run setup');
  requireValue(!input.workerKey || /^[a-f0-9]{64}$/.test(input.workerKey), 'Invalid Worker key');
  const allowedHosts = input.allowedHosts ?? ['127.0.0.1', 'localhost'];
  requireValue(Array.isArray(allowedHosts) && allowedHosts.length <= 8 && allowedHosts.every(h => typeof h === 'string' && /^[a-zA-Z0-9.-]+$/.test(h)), 'Invalid allowedHosts');
  requireValue(host === '127.0.0.1' || Array.isArray(input.allowedHosts), 'LAN listening requires explicit allowedHosts');
  const server = input.server ?? `http://127.0.0.1:${port}`;
  const url = new URL(server);
  requireValue(url.protocol === 'http:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash && Number(url.port) >= 43000 && Number(url.port) <= 43999, 'Invalid Server URL');
  const base = dirname(full);
  requireValue(!lstatSync(base).isSymbolicLink(), 'Linked configuration directory denied');
  const data = withinRoot(base, 'runtime');
  mkdirSync(data, { recursive: true });
  return { host, port, adminPort, browserKey: input.browserKey, workerKey: input.workerKey ?? '', server: url.origin, allowedHosts, data };
}
