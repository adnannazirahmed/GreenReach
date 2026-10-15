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
export function webUrl(value, sourceOnly = false, approvedDomains = []) {
  let url;
  try { url = new URL(value); } catch { throw new AppError('Enter a valid HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new AppError('Only HTTPS URLs without credentials or custom ports are supported.');
  if (sourceOnly) {
    const host = url.hostname.toLowerCase();
    const reddit = ['reddit.com', 'www.reddit.com', 'old.reddit.com'].includes(host);
    const hn = host === 'news.ycombinator.com' && url.pathname === '/item' && /^\d+$/.test(url.searchParams.get('id') || '');
    const stack = /^(?:stackoverflow\.com|superuser\.com|serverfault\.com|askubuntu\.com|[a-z0-9-]+\.stackexchange\.com)$/.test(host) && /^\/questions\/\d+(?:\/|$)/.test(url.pathname);
    const github = host === 'github.com' && /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:issues|discussions)\/\d+(?:\/|$)/.test(url.pathname);
    const devto = host === 'dev.to' && /^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+/.test(url.pathname);
    const approvedWeb = approvedDomains.includes(host) && host !== 'teamblind.com' && !host.endsWith('.teamblind.com');
    if (!(reddit || hn || stack || github || devto || approvedWeb)) throw new AppError('Opportunity URL must point to a supported public conversation source or an approved research domain.');
    if (reddit) {
    if (!/^\/r\/[\w]+\/comments\/[a-z0-9]+(?:\/|$)/i.test(url.pathname)) throw new AppError('Use a Reddit thread or comment permalink.');
    url.hostname = 'www.reddit.com';
    url.pathname = url.pathname.replace(/\/+$/, '') + '/';
    // Titles can change: canonicalize the slug while retaining comment IDs.
    const parts = url.pathname.split('/');
    parts[5] = '_';
    url.pathname = parts.join('/').replace(/\/+$/, '') + '/';
    }
    url.search = hn ? `?id=${url.searchParams.get('id')}` : '';
    url.hash = '';
  } else {
    url.search = ''; url.hash = '';
  }
  return url.href;
}
export function sourceText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|li|pre|h[1-6])\s*>/gi, '\n').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').trim().slice(0, 20000);
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
    researchDomains: [...new Set(list(data.researchDomains ?? previous.researchDomains ?? [], 'Research domains', 10).map(domain => {
      const host = domain.toLowerCase().replace(/^www\./, '');
      if (host.length > 253 || netDomainInvalid(host)) throw new AppError('Research domains must be public hostnames such as community.example.com.');
      if (host === 'teamblind.com' || host.endsWith('.teamblind.com')) throw new AppError('Blind does not permit scraping without explicit TeamBlind permission. Use an authorized API or obtain permission first.');
      return host;
    }))],
    ignoredSubreddits: list(data.ignoredSubreddits ?? previous.ignoredSubreddits ?? [], 'Ignored subreddits').map(x => x.replace(/^r\//, '').toLowerCase()),
    monitoring: Boolean(data.monitoring ?? previous.monitoring ?? false),
  };
}
function netDomainInvalid(host) {
  return !host.includes('.') || host.split('.').some(label => !/^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local');
}
export function analyze(item, project) {
  const text = `${item.title} ${item.body}`.toLowerCase();
  const phrase = value => new RegExp(`(^|[^a-z0-9])${value.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?=$|[^a-z0-9])`, 'i').test(text);
  const matches = project.keywords.filter(phrase);
  const brands = [project.name, ...project.competitors].filter(phrase);
  const buyingPattern = /\b(recommend(?:ation)?|looking for|alternative|which tool|best .{0,40}(?:tool|software)|switch(?:ing)?|replac(?:e|ing)|anyone (?:using|used|tried)|what .{0,30} us(?:e|ing)|vs\.?|versus)\b/;
  const negated = /\b(?:not|never|no longer|don't|do not)\s+(?:need|want|seek|recommend|looking for|switch|replace)\b/;
  const ideaSeeking = /\b(?:saas|software|product|startup|business) ideas? (?:to|i could|i should) build\b|\bwhat (?:saas|micro saas|startup) ideas?\b/.test(text);
  const fitPoints = matches.reduce((total, match) => total + (match.trim().includes(' ') ? 15 : 5), 0) + (brands.length ? 10 : 0);
  const specificFit = matches.some(match => match.trim().includes(' ')) || brands.length > 0;
  const buying = buyingPattern.test(text) && !negated.test(text) && !ideaSeeking && specificFit;
  const pain = /\b(expensive|frustrat\w*|struggl\w*|broken|problem|hate|missing|too much|can't|cannot)\b/.test(text);
  const positive = /love|excellent|helpful|great|recommend/.test(text);
  const age = item.publishedAt ? Math.max(0, (Date.now() - Date.parse(item.publishedAt)) / 86400000) : null;
  const ignored = Boolean(item.subreddit && project.ignoredSubreddits.includes(item.subreddit.toLowerCase()));
  const factors = { relevance: Math.min(45, fitPoints), intent: buying ? 30 : pain ? 18 : 5, freshness: age === null ? 0 : age < 2 ? 15 : age < 14 ? 8 : 2, engagement: Math.min(10, Math.floor((item.comments || 0) / 5)) };
  return {
    score: ignored ? 0 : Math.min(100, Object.values(factors).reduce((a, b) => a + b, 0)),
    intent: buying ? 'Buying intent' : pain ? 'Pain point' : 'Discussion',
    sentiment: pain ? 'negative' : positive ? 'positive' : 'neutral',
    matches, brands, factors, ignored,
    reason: ignored ? 'Excluded by your subreddit settings.' : `${matches.length ? `Product fit: matches ${matches.join(', ')}. ` : 'Product fit: no project keyword match. '}${buying ? 'Expressed need: asks for a recommendation or alternative. ' : ideaSeeking ? 'Expressed need: exploring ideas, not requesting a product. ' : buyingPattern.test(text) && !specificFit ? 'Expressed need: recommendation language, but product fit is unverified. ' : pain ? 'Expressed need: describes a problem. ' : 'Expressed need: general discussion. '}${age === null ? 'Freshness: date unknown. ' : age < 14 ? 'Freshness: recent. ' : 'Freshness: older conversation. '}Engagement: ${item.comments || 0} comments.${item.googlePosition ? ` Google position #${item.googlePosition} is search context, not buying intent.` : ''}`,
    method: 'rules',
  };
}
export function opportunityInput(data, project) {
  const url = webUrl(str(data.url, 'URL', 2000, true), true, project.researchDomains || []);
  const number = (v, name, max) => { if (v == null || v === '') return null; if (!Number.isFinite(v) || v < 0 || v > max) throw new AppError(`${name} is outside its allowed range.`); return Math.floor(v); };
  if (data.pageType != null && !['discussion', 'article', 'listing', 'other'].includes(data.pageType)) throw new AppError('Invalid extracted page type.');
  let publishedAt = data.publishedAt || null;
  if (publishedAt && (typeof publishedAt !== 'string' || !Number.isFinite(Date.parse(publishedAt)) || Date.parse(publishedAt) > Date.now() + 86400000)) throw new AppError('Invalid publication date.');
  const item = {
    id: id(), projectId: project.id, url,
    title: str(data.title, 'Title', 500, true), body: str(data.body ?? '', 'Body', 20000),
    subreddit: new URL(url).hostname === 'www.reddit.com' ? url.split('/')[4] : '',
    community: str(data.community ?? new URL(url).hostname, 'Community', 200),
    author: str(data.author ?? 'unknown', 'Author', 80),
    authorUrl: data.authorUrl ? webUrl(str(data.authorUrl, 'Author URL', 2000, true)) : '',
    contentLicense: str(data.contentLicense ?? '', 'Content license', 80),
    pageType: ['discussion', 'article', 'listing', 'other'].includes(data.pageType) ? data.pageType : 'other',
    extractionQuality: number(data.extractionQuality, 'Extraction quality', 100),
    keyword: str(data.keyword ?? '', 'Keyword', 200),
    googlePosition: number(data.googlePosition, 'Google position', 100),
    searchVolume: number(data.searchVolume, 'Search volume', 1e9),
    comments: number(data.comments ?? 0, 'Comments', 1e8),
    upvotes: number(Math.max(0, data.upvotes ?? 0), 'Upvotes', 1e9),
    publishedAt, discoveredAt: now(), source: 'import', textOrigin: 'import', sample: false,
    status: 'new', saved: false, notes: '', draft: '', draftMethod: null, contactStage: 'none',
  };
  if (item.googlePosition === 0) throw new AppError('Google position must be 1–100 or null.');
  return { ...item, analysis: analyze(item, project) };
}
export function fallbackDraft(item, project) {
  return `A useful way to evaluate this is to list your must-haves, test one real workflow, and compare the total cost and export options before committing.\n\nFor your question about “${item.title}”, which requirement is the hardest to meet right now?\n\nDisclosure: I'm affiliated with ${project.name}. ${project.description ? `Our focus is: ${project.description.slice(0, 350)} ` : ''}Happy to clarify whether it fits, including where it may not.`;
}
export function csv(items) {
  const fields = ['title', 'url', 'source', 'community', 'author', 'authorUrl', 'contentLicense', 'subreddit', 'status', 'score', 'intent', 'sentiment', 'googlePosition', 'keyword', 'sample', 'draft', 'notes'];
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r\n]/.test(s)) s = "'" + s; return `"${s.replaceAll('"', '""')}"`; };
  return [fields, ...items.map(i => fields.map(k => i[k] ?? i.analysis[k]))].map(row => row.map(cell).join(',')).join('\r\n');
}
