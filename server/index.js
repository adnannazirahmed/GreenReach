import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { Store } from './store.js';
import { seed } from './seed.js';
import { id, now, str, AppError, projectInput, opportunityInput, analyze, csv } from './domain.js';
import { capabilities, discover, draftReply, aiAnalyze, suggestKeywords } from './providers.js';

const STATIC = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/styles.css', ['styles.css', 'text/css']], ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]]);
function equal(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export function createApp({ store = new Store(), env = process.env, fetcher = fetch, demo = true } = {}) {
  if (demo) seed(store);
  const busy = new Set();
  const requireProject = pid => { const p = store.project(pid); if (!p) throw new AppError('Project not found.', 404); return p; };
  const requireItem = iid => { const i = store.item(iid); if (!i) throw new AppError('Opportunity not found.', 404); return i; };
  async function sync(pid, provider) {
    const p = requireProject(pid);
    if (p.sample) throw new AppError('Create your own project to discover real conversations. The demo stays fictional.');
    if (busy.has(pid)) throw new AppError('A discovery run is already active for this project.', 409);
    busy.add(pid);
    try {
      const result = await discover(p, provider, env, fetcher);
      let inserted = 0, updated = 0;
      // All requests succeed before data is committed, so a failed run cannot look successful.
      store.transaction(() => {
        const existing = new Map(store.items(pid).map(i => [i.url, i]));
        for (const item of result.items) {
          if (item.analysis.ignored) continue;
          const prior = existing.get(item.url);
          if (prior) {
            const merged = { ...prior, ...(provider === 'reddit' ? { body: item.body, comments: item.comments, upvotes: item.upvotes, publishedAt: item.publishedAt } : { googlePosition: item.googlePosition, keyword: item.keyword }), lastSeenAt: now() };
            merged.analysis = analyze(merged, p); store.saveItem(merged); existing.set(item.url, merged); updated++;
          } else { store.insert(item); existing.set(item.url, item); inserted++; }
        }
        // Re-read project so a concurrent settings edit survives a slow network request.
        const latest = store.project(pid);
        if (!latest) throw new AppError('Project was deleted during discovery.', 409);
        store.saveProject({ ...latest, lastSyncAt: now() });
        store.event(pid, `${provider === 'google' ? 'Google' : 'Reddit'} discovery: ${inserted} new, ${updated} refreshed, ${result.queries} queries.`, 'sync');
      });
      return { inserted, updated, queries: result.queries };
    } catch (e) { store.event(pid, e instanceof AppError ? e.message : 'Discovery failed. Check provider connectivity.', 'error'); throw e; }
    finally { busy.delete(pid); }
  }
  async function body(req) {
    if (!(req.headers['content-type'] || '').includes('application/json')) throw new AppError('Use application/json.', 415);
    let data = ''; for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 2_000_000) throw new AppError('Request exceeds 2 MB.', 413); }
    try { const value = JSON.parse(data || '{}'); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; } catch { throw new AppError('Expected a JSON object.'); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (data, status = 200, type = 'application/json') => { res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(data) : data); };
    try {
      // Validate the Host even on loopback: prevents DNS rebinding against an unauthed local app.
      const host = req.headers.host || '';
      if (!env.APP_TOKEN && !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) throw new AppError('Invalid host.', 403);
      if (req.headers.origin && req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}`) throw new AppError('Cross-origin requests are not allowed.', 403);
      const url = new URL(req.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' || !STATIC.has(url.pathname)) throw new AppError('Not found.', 404);
        const [file, type] = STATIC.get(url.pathname); return send(await readFile(new URL(`../public/${file}`, import.meta.url), 'utf8'), 200, type);
      }
      if (env.APP_TOKEN && !equal(req.headers.authorization || '', `Bearer ${env.APP_TOKEN}`)) throw new AppError('Enter your APP_TOKEN to open this workspace.', 401);
      const method = req.method;
      if (url.pathname === '/api/health' && method === 'GET') return send({ ok: true, version: '0.1.0' });
      if (url.pathname === '/api/config' && method === 'GET') return send({ ...capabilities(env), busy: [...busy] });
      if (url.pathname === '/api/projects' && method === 'GET') return send(store.projects());
      if (url.pathname === '/api/projects' && method === 'POST') {
        const data = await body(req); const p = store.saveProject({ ...projectInput(data), id: id(), createdAt: now(), sample: false }); store.event(p.id, 'Project created. Add conversations or connect a discovery provider.'); return send(p, 201);
      }
      if (parts[1] === 'projects' && parts[2]) {
        const pid = parts[2], p = requireProject(pid), action = parts[3];
        if (!action && method === 'GET') return send(p);
        if (!action && method === 'PATCH') {
          const data = projectInput(await body(req), p);
          store.transaction(() => { store.saveProject(data); for (const i of store.items(pid)) store.saveItem({ ...i, analysis: analyze(i, data) }); });
          store.event(pid, 'Project settings updated. Rules-based scores recalculated.'); return send(data);
        }
        if (!action && method === 'DELETE') { if (busy.has(pid)) throw new AppError('Wait for discovery to finish before deleting this project.', 409); store.deleteProject(pid); return send({ ok: true }); }
        if (action === 'opportunities' && method === 'GET') return send(store.items(pid));
        if (action === 'events' && method === 'GET') return send(store.events(pid));
        if (action === 'sync' && method === 'POST') return send(await sync(pid, (await body(req)).provider));
        if (action === 'keywords' && method === 'POST') { await body(req); return send(await suggestKeywords(p, env, fetcher)); }
        if (action === 'import' && method === 'POST') {
          if (p.sample) throw new AppError('Create a project to import real conversations.');
          const data = await body(req);
          if (!Array.isArray(data.items) || !data.items.length || data.items.length > 200) throw new AppError('Import 1–200 items per request.');
          const items = data.items.map(i => { if (!i || typeof i !== 'object' || Array.isArray(i)) throw new AppError('Each import item must be an object.'); return opportunityInput(i, p); });
          let inserted = 0; store.transaction(() => { for (const i of items) if (store.insert(i)) inserted++; });
          store.event(pid, `Imported ${inserted} conversations; ${items.length - inserted} duplicates skipped.`); return send({ inserted, duplicates: items.length - inserted });
        }
        if (action === 'export' && method === 'GET') {
          const items = store.items(pid);
          if (url.searchParams.get('format') === 'csv') { res.setHeader('Content-Disposition', 'attachment; filename="greenreach.csv"'); return send(csv(items), 200, 'text/csv'); }
          res.setHeader('Content-Disposition', 'attachment; filename="greenreach.json"'); return send({ project: p, items, events: store.events(pid), exportedAt: now() });
        }
      }
      if (parts[1] === 'opportunities' && parts[2]) {
        const iid = parts[2], item = requireItem(iid), p = requireProject(item.projectId), action = parts[3];
        if (!action && method === 'GET') return send(item);
        if (!action && method === 'DELETE') { store.deleteItem(iid); return send({ ok: true }); }
        if (!action && method === 'PATCH') {
          const d = await body(req), next = { ...item };
          if ('status' in d) { if (!['new', 'reviewing', 'replied', 'dismissed'].includes(d.status)) throw new AppError('Invalid status.'); next.status = d.status; }
          if ('saved' in d) { if (typeof d.saved !== 'boolean') throw new AppError('saved must be boolean.'); next.saved = d.saved; }
          for (const key of ['draft', 'notes']) if (key in d) next[key] = str(d[key], key, 15000);
          if ('contactStage' in d) { if (!['none', 'interested', 'contacted', 'responded', 'converted'].includes(d.contactStage)) throw new AppError('Invalid pipeline stage.'); next.contactStage = d.contactStage; }
          next.updatedAt = now(); store.saveItem(next);
          if (d.status && item.status !== d.status) store.event(p.id, `Marked “${item.title}” as ${d.status}.`);
          return send(next);
        }
        if (action === 'draft' && method === 'POST') {
          await body(req); const draft = await draftReply(item, p, env, fetcher);
          const latest = requireItem(iid); const next = { ...latest, draft: draft.text, draftMethod: draft.method, status: latest.status === 'new' ? 'reviewing' : latest.status };
          store.saveItem(next); store.event(p.id, `${draft.method === 'template' ? 'Template' : 'AI'} draft created for “${item.title}”.`); return send(next);
        }
        if (action === 'analyze' && method === 'POST') { await body(req); const analysis = await aiAnalyze(item, p, env, fetcher); return send(store.saveItem({ ...requireItem(iid), analysis })); }
      }
      throw new AppError('Not found.', 404);
    } catch (e) {
      send({ error: e instanceof AppError ? e.message : 'The request failed. Check server/provider connectivity and try again.' }, e.status || 500);
    }
  });
  let timer;
  const minutes = capabilities(env).interval;
  if (minutes > 0) {
    timer = setInterval(async () => {
      for (const p of store.projects().filter(p => p.monitoring && !p.sample)) {
        for (const provider of ['reddit', 'google'].filter(k => capabilities(env)[k])) { try { await sync(p.id, provider); } catch { /* error recorded in activity log */ } }
      }
    }, Math.max(5, minutes) * 60000); timer.unref();
  }
  server.on('close', () => { if (timer) clearInterval(timer); });
  return { server, store, sync };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.env.APP_TOKEN) throw new Error('APP_TOKEN is required when exposing GreenReach beyond loopback.');
  const { server } = createApp();
  server.listen(Number(process.env.PORT) || 4310, host, () => console.log(`GreenReach ready at http://${host}:${server.address().port}`));
}
