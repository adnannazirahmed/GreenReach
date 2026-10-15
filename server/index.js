import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { Store } from './store.js';
import { seed } from './seed.js';
import { id, now, str, AppError, projectInput, opportunityInput, csv } from './domain.js';
import { capabilities, discover, draftReply, aiAnalyze, suggestKeywords } from './providers.js';
import { researchWebsite } from './site-research.js';
import { CredentialVault } from './credential-vault.js';
import { mergeDiscovery, normalizeOpportunity, possibleDuplicateGroups, recalculateOpportunity, reviewHash, reviewStatus } from './recommendations.js';

const STATIC = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/styles.css', ['styles.css', 'text/css']], ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]]);
function equal(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export function createApp({ store = new Store(), env = process.env, fetcher = fetch, demo = true } = {}) {
  if (demo) seed(store);
  const credentialVault = new CredentialVault(store, env);
  const providerEnv = () => ({ ...env, ...credentialVault.all() });
  const busy = new Set();
  const siteBusy = new Set();
  const aiJobs = new Map();
  let aiActive = 0;
  const aiWaiters = [];
  async function withAiSlot(task) {
    if (aiActive >= 2) await new Promise(resolve => aiWaiters.push(resolve));
    else aiActive++;
    try { return await task(); }
    finally { const next = aiWaiters.shift(); if (next) next(); else aiActive--; }
  }
  const requireProject = pid => { const p = store.project(pid); if (!p) throw new AppError('Project not found.', 404); return p; };
  const requireItem = iid => { const i = store.item(iid); if (!i) throw new AppError('Opportunity not found.', 404); return i; };
  const projectItems = pid => {
    const project = requireProject(pid);
    const items = store.items(pid).map(item => recalculateOpportunity(item, project));
    const groups = possibleDuplicateGroups(items);
    return items.map(item => ({ ...item, possibleDuplicateIds: (groups.get(item.id) || []).filter(id => id !== item.id) }));
  };
  const reviewCandidates = pid => {
    const project = requireProject(pid);
    const items = store.items(pid).map(item => recalculateOpportunity(item, project));
    const groups = possibleDuplicateGroups(items);
    const seenGroups = new Set();
    return items.filter(item => !item.sample && !item.analysis.ignored && item.feedback !== 'not_relevant' && ['new', 'reviewing'].includes(item.status) && reviewStatus(item, project) !== 'current')
      .sort((a, b) => b.analysis.score - a.analysis.score)
      .filter(item => {
        const group = groups.get(item.id);
        if (!group) return true;
        const key = [...group].sort().join(':');
        if (seenGroups.has(key)) return false;
        seenGroups.add(key);
        return true;
      });
  };
  function startAiReview(pid) {
    const project = requireProject(pid);
    if (project.sample) throw new AppError('Create your own project before reviewing conversations with AI.');
    if (!capabilities(providerEnv()).ai) throw new AppError('Configure OpenAI or Ollama in Settings before reviewing with AI.');
    if (aiJobs.get(pid)?.status === 'running') throw new AppError('An AI review is already active for this project.', 409);
    const selected = reviewCandidates(pid).slice(0, 20);
    const job = { id: id(), status: selected.length ? 'running' : 'completed', total: selected.length, completed: 0, failed: 0, errors: [], startedAt: now(), finishedAt: null };
    aiJobs.set(pid, job);
    if (!selected.length) { job.finishedAt = now(); return { ...job }; }
    const deadline = Date.now() + 300_000;
    let cursor = 0;
    const worker = async () => {
      while (cursor < selected.length && Date.now() < deadline) {
        const candidate = selected[cursor++];
        try {
          await withAiSlot(async () => {
            const remaining = deadline - Date.now();
            if (remaining <= 0) return;
            const item = requireItem(candidate.id), currentProject = requireProject(pid);
            const review = await aiAnalyze(item, currentProject, providerEnv(), fetcher, Math.min(30000, remaining));
            if (!review) throw new AppError('AI provider became unavailable during review.');
            review.inputHash = reviewHash(item, currentProject);
            const latest = requireItem(item.id);
            store.saveItem(recalculateOpportunity({ ...latest, aiReview: review }, requireProject(pid)));
            job.completed++;
          });
        } catch (error) {
          job.failed++;
          job.errors.push({ opportunityId: candidate.id, message: error instanceof AppError ? error.message : 'AI review failed.' });
        }
      }
    };
    void Promise.all([worker(), worker()]).finally(() => {
      job.status = 'completed'; job.finishedAt = now();
      job.remaining = job.total - job.completed - job.failed;
      store.event(pid, `AI review completed: ${job.completed} reviewed, ${job.failed} failed${job.remaining ? `, ${job.remaining} not started before the time limit` : ''}.`);
    });
    return { ...job };
  }
  async function sync(pid, provider) {
    const p = requireProject(pid);
    if (p.sample) throw new AppError('Create your own project to discover real conversations. The demo stays fictional.');
    if (busy.has(pid)) throw new AppError('A discovery run is already active for this project.', 409);
    busy.add(pid);
    try {
      const result = await discover(p, provider, providerEnv(), fetcher);
      let inserted = 0, updated = 0;
      // All requests succeed before data is committed, so a failed run cannot look successful.
      store.transaction(() => {
        const existing = new Map(store.items(pid).map(i => [i.url, i]));
        for (const item of result.items) {
          if (item.analysis.ignored) continue;
          const prior = existing.get(item.url);
          if (prior) {
            const merged = mergeDiscovery(prior, item, p);
            store.saveItem(merged); existing.set(item.url, merged); updated++;
          } else { const next = recalculateOpportunity(normalizeOpportunity(item), p); store.insert(next); existing.set(item.url, next); inserted++; }
        }
        // Re-read project so a concurrent settings edit survives a slow network request.
        const latest = store.project(pid);
        if (!latest) throw new AppError('Project was deleted during discovery.', 409);
        store.saveProject({ ...latest, lastSyncAt: now() });
        const sourceName = ({ reddit: 'Reddit', google: 'Google', web: 'Web sweep', hackernews: 'Hacker News', stackexchange: 'Stack Exchange', github: 'GitHub', devto: 'DEV Community' })[provider] || provider;
        store.event(pid, `${sourceName} discovery: ${inserted} new, ${updated} refreshed, ${result.queries} queries.`, 'sync');
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
      if (url.pathname === '/api/config' && method === 'GET') return send({ ...capabilities(providerEnv()), credentialStatus: credentialVault.status(env), savedCredentialStatus: credentialVault.savedStatus(), busy: [...busy] });
      if (url.pathname === '/api/config/credentials' && method === 'PATCH') {
        const data = await body(req), values = data.credentials ?? {}, clear = data.clear ?? [];
        const limits = { REDDIT_ACCESS_TOKEN: 4096, REDDIT_CLIENT_ID: 512, REDDIT_CLIENT_SECRET: 512, REDDIT_USER_AGENT: 256, SERPAPI_KEY: 512, GITHUB_TOKEN: 512, OPENAI_API_KEY: 512, OPENAI_MODEL: 120, OPENAI_BASE_URL: 500 };
        if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some(key => !Object.hasOwn(limits, key))) throw new AppError('Use supported provider credential fields only.');
        if (!Array.isArray(clear) || clear.length > Object.keys(limits).length || !clear.every(key => typeof key === 'string' && Object.hasOwn(limits, key))) throw new AppError('Choose valid saved credentials to clear.');
        const pending = [];
        for (const [name, raw] of Object.entries(values)) {
          if (typeof raw !== 'string' || raw.length > limits[name]) throw new AppError(`${name} must be text at most ${limits[name]} characters long.`);
          const value = raw.trim();
          if (!value) continue;
          if (clear.includes(name)) throw new AppError(`Do not enter and clear ${name} in the same request.`);
          if (name === 'OPENAI_BASE_URL') {
            let parsed; try { parsed = new URL(value); } catch { throw new AppError('OPENAI_BASE_URL must be a valid HTTPS origin.'); }
            if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new AppError('OPENAI_BASE_URL must be an HTTPS origin without credentials, a path, or query parameters.');
          }
          pending.push([name, value]);
        }
        store.transaction(() => {
          for (const [name, value] of pending) credentialVault.set(name, value);
          for (const name of clear) credentialVault.delete(name);
        });
        return send({ ...capabilities(providerEnv()), credentialStatus: credentialVault.status(env), savedCredentialStatus: credentialVault.savedStatus(), busy: [...busy] });
      }
      if (url.pathname === '/api/projects' && method === 'GET') return send(store.projects());
      if (url.pathname === '/api/projects' && method === 'POST') {
        const data = await body(req); const p = store.saveProject({ ...projectInput(data), id: id(), createdAt: now(), sample: false }); store.event(p.id, 'Project created. Add conversations or connect a discovery provider.'); return send(p, 201);
      }
      if (parts[1] === 'projects' && parts[2]) {
        const pid = parts[2], p = requireProject(pid), action = parts[3];
        if (!action && method === 'GET') return send(p);
        if (!action && method === 'PATCH') {
          const data = projectInput(await body(req), p);
          store.transaction(() => { store.saveProject(data); for (const i of store.items(pid)) store.saveItem(recalculateOpportunity(i, data)); });
          store.event(pid, 'Project settings updated. Scores recalculated; changed AI reviews need refresh.'); return send(data);
        }
        if (!action && method === 'DELETE') { if (busy.has(pid) || siteBusy.has(pid) || aiJobs.get(pid)?.status === 'running') throw new AppError('Wait for active research or AI review to finish before deleting this project.', 409); store.deleteProject(pid); aiJobs.delete(pid); return send({ ok: true }); }
        if (action === 'opportunities' && method === 'GET') return send(projectItems(pid));
        if (action === 'events' && method === 'GET') return send(store.events(pid));
        if (action === 'sync' && method === 'POST') return send(await sync(pid, (await body(req)).provider));
        if (action === 'ai-review' && method === 'GET') return send({ ...(aiJobs.get(pid) || { status: 'idle', total: 0, completed: 0, failed: 0, errors: [] }), eligibleCount: reviewCandidates(pid).length });
        if (action === 'ai-review' && method === 'POST') { await body(req); return send(startAiReview(pid), 202); }
        if (action === 'keywords' && method === 'POST') { await body(req); return send(await suggestKeywords(p, providerEnv(), fetcher)); }
        if (action === 'research' && method === 'POST') {
          await body(req);
          if (p.sample) throw new AppError('Create your own project before researching a website.');
          if (siteBusy.has(pid)) throw new AppError('Website research is already active for this project.', 409);
          siteBusy.add(pid);
          try {
            const result = await researchWebsite(p.website);
            store.event(pid, `Website research extracted ${result.pages.length} public pages.`);
            return send(result);
          } catch (error) {
            store.event(pid, error instanceof AppError ? error.message : 'Website research failed.', 'error');
            throw error;
          } finally { siteBusy.delete(pid); }
        }
        if (action === 'import' && method === 'POST') {
          if (p.sample) throw new AppError('Create a project to import real conversations.');
          const data = await body(req);
          if (!Array.isArray(data.items) || !data.items.length || data.items.length > 200) throw new AppError('Import 1–200 items per request.');
          const items = data.items.map(i => { if (!i || typeof i !== 'object' || Array.isArray(i)) throw new AppError('Each import item must be an object.'); return recalculateOpportunity(opportunityInput(i, p), p); });
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
        if (!action && method === 'GET') return send(recalculateOpportunity(item, p));
        if (!action && method === 'DELETE') { store.deleteItem(iid); return send({ ok: true }); }
        if (!action && method === 'PATCH') {
          const d = await body(req), next = { ...item };
          if ('status' in d) { if (!['new', 'reviewing', 'replied', 'dismissed'].includes(d.status)) throw new AppError('Invalid status.'); next.status = d.status; }
          if ('saved' in d) { if (typeof d.saved !== 'boolean') throw new AppError('saved must be boolean.'); next.saved = d.saved; }
          if ('feedback' in d) { if (![null, 'useful', 'not_relevant'].includes(d.feedback)) throw new AppError('Invalid recommendation feedback.'); next.feedback = d.feedback; }
          for (const key of ['draft', 'notes']) if (key in d) next[key] = str(d[key], key, 15000);
          if ('contactStage' in d) { if (!['none', 'interested', 'contacted', 'responded', 'converted'].includes(d.contactStage)) throw new AppError('Invalid pipeline stage.'); next.contactStage = d.contactStage; }
          next.updatedAt = now(); store.saveItem(recalculateOpportunity(next, p));
          if (d.status && item.status !== d.status) store.event(p.id, `Marked “${item.title}” as ${d.status}.`);
          return send(recalculateOpportunity(next, p));
        }
        if (action === 'draft' && method === 'POST') {
          await body(req); const draft = await draftReply(item, p, providerEnv(), fetcher);
          const latest = requireItem(iid); const next = { ...latest, draft: draft.text, draftMethod: draft.method, status: latest.status === 'new' ? 'reviewing' : latest.status };
          store.saveItem(next); store.event(p.id, `${draft.method === 'template' ? 'Template' : 'AI'} draft created for “${item.title}”.`); return send(next);
        }
        if (action === 'analyze' && method === 'POST') {
          await body(req);
          const review = await withAiSlot(() => aiAnalyze(item, p, providerEnv(), fetcher));
          if (review) review.inputHash = reviewHash(item, p);
          const latest = requireItem(iid);
          return send(store.saveItem(recalculateOpportunity({ ...latest, aiReview: review || latest.aiReview }, requireProject(p.id))));
        }
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
        for (const provider of ['reddit', 'google'].filter(k => capabilities(providerEnv())[k])) { try { await sync(p.id, provider); } catch { /* error recorded in activity log */ } }
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
