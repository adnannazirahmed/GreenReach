import { createHash } from 'node:crypto';
import { analyze, now } from './domain.js';

const MAX_OBSERVATIONS = 20;
const ORIGIN_WEIGHT = { snippet: 1, import: 2, crawl: 3, api: 4, demo: 2 };

export function sourceForUrl(url, fallback = 'web') {
  const host = new URL(url).hostname.toLowerCase();
  if (host === 'www.reddit.com') return 'reddit';
  if (host === 'news.ycombinator.com') return 'hackernews';
  if (host.endsWith('.stackexchange.com') || ['stackoverflow.com', 'superuser.com', 'serverfault.com', 'askubuntu.com'].includes(host)) return 'stackexchange';
  if (host === 'github.com') return 'github';
  if (host === 'dev.to') return 'devto';
  return fallback === 'import' ? 'import' : 'web';
}

function originFor(source) {
  return source === 'google' ? 'snippet' : source === 'web' ? 'crawl' : source === 'import' ? 'import' : source === 'demo' ? 'demo' : 'api';
}

function observation(item) {
  return { via: item.source || 'import', keyword: item.keyword || '', googlePosition: item.googlePosition || null, seenAt: item.lastSeenAt || item.discoveredAt || now() };
}

export function normalizeOpportunity(item) {
  if (item.recommendationVersion === 1) return item;
  const source = item.source || 'import';
  const legacy = !item.aiReview && item.analysis?.method && item.analysis.method !== 'rules' ? {
    legacy: true, model: item.analysis.method, reason: item.analysis.reason || '', reviewedAt: item.updatedAt || item.discoveredAt || now(),
  } : null;
  return {
    ...item,
    source: item.sample ? source : sourceForUrl(item.url, source),
    textOrigin: item.textOrigin || originFor(source),
    observations: Array.isArray(item.observations) ? item.observations.slice(-MAX_OBSERVATIONS) : [observation(item)],
    aiReview: item.aiReview || legacy,
    feedback: item.feedback || null,
    recommendationVersion: 1,
  };
}

export function reviewHash(item, project) {
  const input = [item.title, item.body, item.textOrigin, project.name, project.description, project.audience, project.keywords, project.competitors];
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export function reviewStatus(item, project) {
  if (!item.aiReview) return 'none';
  if (item.aiReview.legacy) return 'legacy';
  return item.aiReview.inputHash === reviewHash(item, project) ? 'current' : 'stale';
}

export function recalculateOpportunity(item, project) {
  const normalized = normalizeOpportunity(item);
  const rules = analyze(normalized, project);
  const status = reviewStatus(normalized, project);
  const review = normalized.aiReview;
  const analysis = status === 'current' && Number.isInteger(review.relevance) ? {
    ...rules,
    score: rules.ignored ? 0 : Math.round(rules.score * 0.4 + review.relevance * 0.6),
    intent: review.intent,
    sentiment: review.sentiment,
    reason: review.reason,
    ruleReason: rules.reason,
    method: review.model,
  } : rules;
  return { ...normalized, analysis, aiReviewStatus: status };
}

function mergeObservations(prior, incoming) {
  const byRoute = new Map();
  for (const entry of [...(prior.observations || []), ...(incoming.observations || [])]) {
    const key = `${entry.via}:${entry.keyword}`;
    byRoute.set(key, entry);
  }
  return [...byRoute.values()].slice(-MAX_OBSERVATIONS);
}

export function mergeDiscovery(prior, discovered, project) {
  const old = normalizeOpportunity(prior), fresh = normalizeOpportunity(discovered);
  const oldWeight = ORIGIN_WEIGHT[old.textOrigin] || 0;
  const newWeight = ORIGIN_WEIGHT[fresh.textOrigin] || 0;
  const useFreshText = Boolean(fresh.body) && (!old.body || newWeight > oldWeight || (newWeight === oldWeight && fresh.body.length >= old.body.length));
  const useFreshTitle = Boolean(fresh.title) && (newWeight > oldWeight || (newWeight === oldWeight && fresh.title.length >= old.title.length));
  const merged = {
    ...old,
    title: useFreshTitle || !old.title ? fresh.title : old.title,
    body: useFreshText ? fresh.body : old.body,
    textOrigin: useFreshText ? fresh.textOrigin : old.textOrigin,
    source: sourceForUrl(old.url, old.source),
    community: newWeight >= oldWeight ? fresh.community || old.community : old.community,
    author: fresh.author && fresh.author !== 'unknown' ? fresh.author : old.author,
    authorUrl: fresh.authorUrl || old.authorUrl,
    contentLicense: fresh.contentLicense || old.contentLicense,
    comments: Math.max(old.comments || 0, fresh.comments || 0),
    upvotes: Math.max(old.upvotes || 0, fresh.upvotes || 0),
    publishedAt: fresh.publishedAt || old.publishedAt,
    pageType: fresh.pageType !== 'other' ? fresh.pageType : old.pageType,
    extractionQuality: fresh.extractionQuality ?? old.extractionQuality,
    keyword: fresh.keyword || old.keyword,
    googlePosition: fresh.googlePosition || old.googlePosition,
    observations: mergeObservations(old, fresh),
    lastSeenAt: now(),
  };
  return recalculateOpportunity(merged, project);
}

function words(value) {
  return new Set((value || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []);
}
function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  const common = [...a].filter(word => b.has(word)).length;
  return common / (a.size + b.size - common);
}

export function possibleDuplicateGroups(items) {
  const groups = new Map(), buckets = new Map();
  for (const item of items) {
    const title = words(item.title);
    if (title.size < 4) continue;
    const key = [...title].sort()[0];
    const candidates = buckets.get(key) || [];
    let match;
    for (const prior of candidates.slice(-100)) {
      if (prior.url === item.url || similarity(title, prior.titleWords) < 0.85) continue;
      const body = words(item.body), otherBody = words(prior.body);
      if (body.size >= 8 && otherBody.size >= 8 && similarity(body, otherBody) < 0.65) continue;
      match = prior;
      break;
    }
    const group = match ? groups.get(match.id) || [match.id] : null;
    if (group) { group.push(item.id); for (const member of group) groups.set(member, group); }
    candidates.push({ id: item.id, url: item.url, titleWords: title, body: item.body });
    buckets.set(key, candidates);
  }
  return new Map([...groups].map(([id, group]) => [id, [...new Set(group)]]));
}
