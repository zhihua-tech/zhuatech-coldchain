/**
 * 上海如静知华信息科技有限公司 https://www.zhuatech.cn/
 * 商业授权或定制开发请微信添加微信号zhuatech或zhuatech2进行咨询。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ColdChainService, createDemoService } from './domain.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.resolve(process.env.COLDCHAIN_DATA_FILE || './data/coldchain.json');
const apiKey = process.env.COLDCHAIN_API_KEY || 'zhuatech-demo-key';
const port = Number(process.env.PORT || 18103);
const service = (() => { try { return new ColdChainService(JSON.parse(fs.readFileSync(dataFile, 'utf8'))); } catch { return createDemoService(); } })();
const persist = () => { fs.mkdirSync(path.dirname(dataFile), { recursive: true }); fs.writeFileSync(dataFile, JSON.stringify(service.dump(), null, 2)); };
persist();

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};
const bodyOf = async (req) => {
  const chunks = [];
  for await (const chunk of req) { chunks.push(chunk); if (chunks.reduce((n, item) => n + item.length, 0) > 1024 * 1024) throw new Error('请求体超过1MB'); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
};
const staticFiles = {
  '/': ['console.html', 'text/html; charset=utf-8'], '/console': ['console.html', 'text/html; charset=utf-8'],
  '/driver': ['client.html', 'text/html; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8']
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (staticFiles[url.pathname]) { const [name, type] = staticFiles[url.pathname]; return send(res, 200, fs.readFileSync(path.join(dirname, '..', 'public', name), 'utf8'), type); }
    if (url.pathname === '/health') return send(res, 200, { status: 'UP', service: 'zhuatech-coldchain' });
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'NOT_FOUND' });
    if (req.headers['x-api-key'] !== apiKey && req.headers['x-device-token'] === undefined) return send(res, 401, { error: 'UNAUTHORIZED' });
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await bodyOf(req) : {};
    const actor = req.headers['x-actor'] || 'api-user';
    let result;
    if (req.method === 'GET' && url.pathname === '/api/dashboard') result = service.dashboard();
    else if (req.method === 'POST' && url.pathname === '/api/assets') result = service.registerAsset(body, actor);
    else if (req.method === 'POST' && url.pathname === '/api/sensors') result = service.registerSensor(body, actor);
    else if (req.method === 'POST' && url.pathname === '/api/shipments') result = service.createShipment(body, actor);
    else {
      const start = url.pathname.match(/^\/api\/shipments\/([^/]+)\/start$/);
      const route = url.pathname.match(/^\/api\/shipments\/([^/]+)\/route-events$/);
      const deliver = url.pathname.match(/^\/api\/shipments\/([^/]+)\/deliver$/);
      const report = url.pathname.match(/^\/api\/shipments\/([^/]+)\/report$/);
      const telemetry = url.pathname.match(/^\/api\/sensors\/([^/]+)\/telemetry$/);
      const ack = url.pathname.match(/^\/api\/alarms\/([^/]+)\/acknowledge$/);
      const resolve = url.pathname.match(/^\/api\/alarms\/([^/]+)\/resolve$/);
      if (req.method === 'POST' && start) result = service.startShipment(start[1], actor);
      else if (req.method === 'POST' && route) result = service.addRouteEvent(route[1], body, actor);
      else if (req.method === 'POST' && deliver) result = service.deliver(deliver[1], body, actor);
      else if (req.method === 'GET' && report) result = service.complianceReport(report[1]);
      else if (req.method === 'POST' && telemetry) result = service.ingestTelemetry(telemetry[1], body);
      else if (req.method === 'POST' && ack) result = service.acknowledgeAlarm(ack[1], body.assignee, actor);
      else if (req.method === 'POST' && resolve) result = service.resolveAlarm(resolve[1], body, actor);
      else return send(res, 404, { error: 'NOT_FOUND' });
    }
    if (req.method !== 'GET') persist();
    return send(res, req.method === 'POST' ? 201 : 200, result);
  } catch (error) {
    return send(res, 400, { error: 'BUSINESS_ERROR', message: error.message });
  }
});

server.listen(port, () => console.log(`ZhuaTech Cold Chain running at http://127.0.0.1:${port}`));
