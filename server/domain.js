import { randomUUID } from 'node:crypto';

export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function str(value, name, max = 500, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new AppError(`${name} must be ${required ? 'non-empty ' : ''}text, at most ${max} characters.`);
  return value.trim();
}
export function list(value, name, max = 30) {
  if (!Array.isArray(value) || value.length > max) throw new AppError(`${name} must be a list with at most ${max} entries.`);
  return [...new Set(value.map(v => str(v, name, 120, true)))];
}
export function webUrl(value, redditOnly = false) {
  let url;
  try { url = new URL(value); } catch { throw new AppError('Enter a valid HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new AppError('Only HTTPS URLs without credentials or custom ports are supported.');
  if (redditOnly && !['reddit.com', 'www.reddit.com', 'old.reddit.com'].includes(url.hostname)) throw new AppError('Opportunity URLs must point to reddit.com.');
  if (redditOnly) {
    if (!/^\/r\/[\w]+\/comments\/[a-z0-9]+(?:\/|$)/i.test(url.pathname)) throw new AppError('Use a Reddit thread or comment permalink.');
    url.hostname = 'www.reddit.com';
    url.pathname = url.pathname.replace(/\/+$/, '') + '/';
    // Titles can change: canonicalize the slug while retaining comment IDs.
    const parts = url.pathname.split('/');
    parts[5] = '_';
    url.pathname = parts.join('/').replace(/\/+$/, '') + '/';
  }
  url.search = ''; url.hash = '';
  return url.href;
}
export function projectInput(data, previous = {}) {
  if ('monitoring' in data && typeof data.monitoring !== 'boolean') throw new AppError('monitoring must be boolean.');
  const website = data.website ?? previous.website ?? '';
  return {
    ...previous,
    name: str(data.name ?? previous.name, 'Name', 80, true),
    website: typeof website === 'string' && !website.trim() ? '' : webUrl(website),
    description: str(data.description ?? previous.description ?? '', 'Description', 5000),
    audience: str(data.audience ?? previous.audience ?? '', 'Audience', 1000),
    voice: str(data.voice ?? previous.voice ?? 'Helpful, direct, and transparent about affiliation.', 'Voice', 1000),
    keywords: list(data.keywords ?? previous.keywords ?? [], 'Keywords', 20),
    competitors: list(data.competitors ?? previous.competitors ?? [], 'Competitors', 10),
    ignoredSubreddits: list(data.ignoredSubreddits ?? previous.ignoredSubreddits ?? [], 'Ignored subreddits').map(x => x.replace(/^r\//, '').toLowerCase()),
    monitoring: Boolean(data.monitoring ?? previous.monitoring ?? false),
  };
}
export function analyze(item, project) {
  const text = `${item.title} ${item.body}`.toLowerCase();
  const matches = project.keywords.filter(k => text.includes(k.toLowerCase()));
  const brands = [project.name, ...project.competitors].filter(k => text.includes(k.toLowerCase()));
  const buying = /recommend|looking for|alternative|which tool|best .{0,40}(tool|software)|switch|replace|anyone using|what.*use/.test(text);
  const pain = /expensive|frustrat|struggl|broken|problem|hate|missing|too much|can't|cannot/.test(text);
  const positive = /love|excellent|helpful|great|recommend/.test(text);
  const age = item.publishedAt ? Math.max(0, (Date.now() - Date.parse(item.publishedAt)) / 86400000) : null;
  const ignored = project.ignoredSubreddits.includes(item.subreddit.toLowerCase());
  const factors = { relevance: Math.min(35, matches.length * 12 + (brands.length ? 12 : 0)), intent: buying ? 30 : pain ? 18 : 5, freshness: age === null ? 0 : age < 2 ? 15 : age < 14 ? 8 : 2, search: item.googlePosition ? Math.max(0, 15 - item.googlePosition) : 0, engagement: Math.min(5, Math.floor((item.comments || 0) / 5)) };
  return {
    score: ignored ? 0 : Math.min(100, Object.values(factors).reduce((a, b) => a + b, 0)),
    intent: buying ? 'Buying intent' : pain ? 'Pain point' : 'Discussion',
    sentiment: pain ? 'negative' : positive ? 'positive' : 'neutral',
    matches, brands, factors, ignored,
    reason: ignored ? 'Excluded by your subreddit settings.' : `${matches.length ? `Matches ${matches.join(', ')}. ` : ''}${buying ? 'Asks for a recommendation or alternative. ' : pain ? 'Describes a problem or frustration. ' : 'General discussion. '}${item.googlePosition ? `Google organic position ${item.googlePosition} for “${item.keyword}”.` : ''}`.trim(),
    method: 'rules',
  };
}
export function opportunityInput(data, project) {
  const url = webUrl(str(data.url, 'URL', 2000, true), true);
  const number = (v, name, max) => { if (v == null || v === '') return null; if (!Number.isFinite(v) || v < 0 || v > max) throw new AppError(`${name} is outside its allowed range.`); return Math.floor(v); };
  let publishedAt = data.publishedAt || null;
  if (publishedAt && (typeof publishedAt !== 'string' || !Number.isFinite(Date.parse(publishedAt)) || Date.parse(publishedAt) > Date.now() + 86400000)) throw new AppError('Invalid publication date.');
  const item = {
    id: id(), projectId: project.id, url,
    title: str(data.title, 'Title', 500, true), body: str(data.body ?? '', 'Body', 20000),
    subreddit: url.split('/')[4], author: str(data.author ?? 'unknown', 'Author', 80),
    keyword: str(data.keyword ?? '', 'Keyword', 200),
    googlePosition: number(data.googlePosition, 'Google position', 100),
    searchVolume: number(data.searchVolume, 'Search volume', 1e9),
    comments: number(data.comments ?? 0, 'Comments', 1e8),
    upvotes: number(Math.max(0, data.upvotes ?? 0), 'Upvotes', 1e9),
    publishedAt, discoveredAt: now(), source: 'import', sample: false,
    status: 'new', saved: false, notes: '', draft: '', draftMethod: null, contactStage: 'none',
  };
  if (item.googlePosition === 0) throw new AppError('Google position must be 1–100 or null.');
  return { ...item, analysis: analyze(item, project) };
}
export function fallbackDraft(item, project) {
  return `A useful way to evaluate this is to list your must-haves, test one real workflow, and compare the total cost and export options before committing.\n\nFor your question about “${item.title}”, which requirement is the hardest to meet right now?\n\nDisclosure: I'm affiliated with ${project.name}. ${project.description ? `Our focus is: ${project.description.slice(0, 350)} ` : ''}Happy to clarify whether it fits, including where it may not.`;
}
export function csv(items) {
  const fields = ['title', 'url', 'subreddit', 'status', 'score', 'intent', 'sentiment', 'googlePosition', 'keyword', 'source', 'sample', 'draft', 'notes'];
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r\n]/.test(s)) s = "'" + s; return `"${s.replaceAll('"', '""')}"`; };
  return [fields, ...items.map(i => fields.map(k => i[k] ?? i.analysis[k]))].map(row => row.map(cell).join(',')).join('\r\n');
}
