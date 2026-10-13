import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { AppError } from './domain.js';

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 12_000;
const CRAWL_TIMEOUT_MS = 60_000;
const MAX_PAGES = 4;
const RESEARCH_TIMEOUT = 'Website research exceeded its total time limit.';

function publicAddress(address) {
  if (net.isIPv4(address)) {
    const octets = address.split('.').map(Number);
    const [a, b] = octets;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 192 && b === 88 && octets[2] === 99) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51) ||
      (a === 203 && b === 0));
  }
  if (!net.isIPv6(address)) return false;
  const value = ipv6Value(address);
  if (value === null) return false;
  const inPrefix = (prefix, bits) => {
    const prefixValue = ipv6Value(prefix);
    return (value >> BigInt(128 - bits)) === (prefixValue >> BigInt(128 - bits));
  };
  // Only global unicast is accepted. Keep the IANA special-purpose ranges that
  // are not globally reachable out, including expanded/non-canonical spellings.
  if (!inPrefix('2000::', 3)) return false;
  const globallyReachableExceptions = [
    ['2001:1::1', 128], ['2001:1::2', 128], ['2001:1::3', 128],
    ['2001:3::', 32], ['2001:4:112::', 48], ['2001:20::', 28], ['2001:30::', 28],
  ];
  if (inPrefix('2001::', 23) && !globallyReachableExceptions.some(([prefix, bits]) => inPrefix(prefix, bits))) return false;
  return !inPrefix('2001:db8::', 32) && !inPrefix('2002::', 16) && !inPrefix('3fff::', 20);
}

function ipv6Value(address) {
  const value = address.toLowerCase().split('%')[0];
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const parseHalf = half => {
    const groups = half ? half.split(':') : [];
    const dotted = groups.findIndex(group => group.includes('.'));
    if (dotted !== -1) {
      const octets = groups[dotted].split('.').map(Number);
      if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
      groups.splice(dotted, 1, ((octets[0] << 8) | octets[1]).toString(16), ((octets[2] << 8) | octets[3]).toString(16));
    }
    return groups;
  };
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] || '');
  if (!left || !right) return null;
  const groups = [...left, ...right];
  const missing = 8 - groups.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const expanded = halves.length === 2 ? [...left, ...Array(missing).fill('0'), ...right] : groups;
  if (expanded.length !== 8 || expanded.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return expanded.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

async function publicLookup(hostname, lookup = dns.lookup) {
  if (net.isIP(hostname) || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new AppError('Website research only supports public domain names.', 400);
  }
  let records;
  try { records = await lookup(hostname, { all: true, verbatim: true }); }
  catch { throw new AppError('Could not resolve the website hostname.', 502); }
  if (!records.length || records.some(record => !publicAddress(record.address))) {
    throw new AppError('Website research blocked a hostname that resolves to a private or reserved network.', 400);
  }
  return records;
}

function withinDeadline(promise, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new AppError(RESEARCH_TIMEOUT, 504));
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new AppError(RESEARCH_TIMEOUT, 504)), remaining); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function requestPage(url, records, expectedType = 'text/html', requestImpl = https.request, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const address = records[0];
    let req, timer, settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
    const timeoutError = () => new AppError('Website request timed out.', 504);
    try {
      req = requestImpl(url, {
        method: 'GET',
        headers: { 'User-Agent': 'GreenReach/0.2 (public website research)', Accept: 'text/html', 'Accept-Encoding': 'identity' },
        lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
        servername: url.hostname,
        timeout: timeoutMs,
      }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400) { res.destroy?.(); finish(reject, new AppError('Website redirects are not followed. Update the project website to its final HTTPS address.', 400)); return; }
        if (res.statusCode !== 200) { res.resume(); finish(reject, new AppError(`Website returned HTTP ${res.statusCode}.`, 502)); return; }
        const contentType = res.headers['content-type'] || '';
        if (expectedType === 'text/html' ? !/^text\/html(?:;|$)/i.test(contentType) : !/^text\/plain(?:;|$)/i.test(contentType)) { res.resume(); finish(reject, new AppError('Website returned an unsupported content type.', 502)); return; }
        const chunks = []; let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_BYTES) { const error = new AppError('Website page exceeded the 1 MB research limit.', 502); finish(reject, error); req.destroy(error); }
          else chunks.push(chunk);
        });
        res.on('end', () => finish(resolve, Buffer.concat(chunks).toString('utf8')));
        res.on('error', error => finish(reject, error));
      });
    } catch (error) { finish(reject, error); return; }
    timer = setTimeout(() => req.destroy(timeoutError()), timeoutMs);
    req.on('timeout', () => req.destroy(timeoutError()));
    req.on('error', error => finish(reject, error));
    req.end();
  });
}

function codePoint(value, radix = 10) {
  const point = parseInt(value, radix);
  return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd';
}

function decode(text) {
  return text.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#(\d+);/g, (_, n) => codePoint(n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => codePoint(n, 16));
}

function attributes(tag) {
  const result = {};
  const source = tag.replace(/^<\s*[\w:-]+/, '').replace(/\/?\s*>$/, '');
  for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const key = match[1].toLowerCase();
    if (key !== '/') result[key] = decode(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

function structuredData(html) {
  const objects = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/application\/ld\+json/i.test(attributes(`<script ${match[1]}>`).type || '')) continue;
    try {
      const value = JSON.parse(match[2].trim());
      const collect = item => {
        if (Array.isArray(item)) item.forEach(collect);
        else if (item && typeof item === 'object') { objects.push(item); if (item['@graph']) collect(item['@graph']); }
      };
      collect(value);
    } catch { /* Malformed or hostile structured data is ignored as page content. */ }
  }
  return objects;
}

function pageText(html, url) {
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => attributes(match[0]));
  const meta = (...keys) => {
    for (const key of keys) {
      const found = metas.find(tag => (tag.name || tag.property || tag.itemprop || '').toLowerCase() === key);
      if (found?.content) return found.content.trim();
    }
    return '';
  };
  const data = structuredData(html);
  const typeOf = item => (Array.isArray(item?.['@type']) ? item['@type'] : [item?.['@type']]).filter(Boolean).map(type => String(type).split('/').pop().toLowerCase());
  const discussionTypes = new Set(['discussionforumposting', 'qapage', 'question', 'answer']);
  const articleTypes = new Set(['article', 'blogposting', 'newsarticle', 'report', 'review']);
  const itemList = data.some(item => typeOf(item).includes('itemlist'));
  const threadData = data.find(item => typeOf(item).some(type => discussionTypes.has(type)));
  const articleData = data.find(item => typeOf(item).some(type => articleTypes.has(type)));
  const title = decode((html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() || meta('og:title', 'twitter:title');
  const description = meta('description', 'og:description', 'twitter:description');
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1] || html.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i)?.[1] || html;
  const text = decode(main.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|button)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\s*br\b[^>]*>|<\/(?:p|div|li|pre|blockquote|h[1-6]|section|article|tr|td|th|table)\s*>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[\t\r ]+/g, ' ').replace(/\n\s+/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000);
  const authorValue = articleData?.author || threadData?.author || meta('author', 'article:author');
  const authorCandidate = typeof authorValue === 'string' ? authorValue : Array.isArray(authorValue) ? authorValue[0]?.name : authorValue?.name;
  const author = typeof authorCandidate === 'string' ? authorCandidate.trim().slice(0, 80) : '';
  const rawDate = articleData?.datePublished || threadData?.datePublished || meta('article:published_time', 'datepublished', 'date');
  const parsedDate = rawDate && Date.parse(rawDate);
  const publishedAt = Number.isFinite(parsedDate) && parsedDate <= Date.now() + 86400000 ? new Date(parsedDate).toISOString() : null;
  const articleCount = (html.match(/<article\b/gi) || []).length;
  const path = url?.pathname.toLowerCase() || '';
  const pageType = threadData || /\/(?:thread|discussion|questions?|comments?)\//.test(path) ? 'discussion' :
    itemList || articleCount > 2 || /\/(?:search|category|tag)\//.test(path) ? 'listing' :
      articleData || articleCount > 0 ? 'article' : 'other';
  const canonical = html.match(/<link\b[^>]*>/gi)?.map(attributes).find(tag => /canonical/i.test(tag.rel || ''))?.href || '';
  const extractionQuality = Math.min(100, (title ? 15 : 0) + Math.min(45, Math.floor(text.length / 100)) + (description ? 10 : 0) + (/<(?:main|article)\b/i.test(html) ? 15 : 0) + (author ? 5 : 0) + (publishedAt ? 5 : 0) + (canonical ? 5 : 0));
  return { title, description, text, author: author || '', publishedAt, pageType, extractionQuality };
}

function robotsRules(text) {
  const groups = []; let agents = [], rules = [];
  const saveGroup = () => { if (agents.length) groups.push({ agents, rules }); agents = []; rules = []; };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim(); if (!line.includes(':')) continue;
    const [key, ...valueParts] = line.split(':'); const value = valueParts.join(':').trim();
    if (key.trim().toLowerCase() === 'user-agent') {
      if (rules.length) saveGroup();
      agents.push(value.toLowerCase());
    } else if (value && ['allow', 'disallow'].includes(key.trim().toLowerCase())) {
      rules.push({ allow: key.trim().toLowerCase() === 'allow', value });
    }
  }
  saveGroup();
  const named = groups.filter(group => group.agents.some(agent => agent === 'greenreach'));
  const applicable = (named.length ? named : groups.filter(group => group.agents.includes('*'))).flatMap(group => group.rules);
  return path => {
    const matched = applicable.filter(rule => {
      const terminal = rule.value.endsWith('$'), source = terminal ? rule.value.slice(0, -1) : rule.value;
      const pattern = source.split('*').map(part => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')).join('.*');
      return new RegExp(`^${pattern}${terminal ? '$' : ''}`).test(path);
    }).sort((a, b) => b.value.length - a.value.length || Number(b.allow) - Number(a.allow))[0];
    return Boolean(matched && !matched.allow);
  };
}

function candidateLinks(html, base) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    try {
      const url = new URL(decode(match[1]), base);
      if (url.protocol === 'https:' && url.origin === base.origin && !url.username && !url.password && !url.search && !url.hash) links.push(url);
    } catch { /* ignore malformed or non-web links */ }
  }
  const preferred = /\b(about|product|features?|pricing|use-cases?|solutions?|customers?|faq|docs|how-it-works)\b/i;
  return [...new Map(links.map(link => [link.pathname, link])).values()]
    .filter(link => link.pathname !== base.pathname && !/\.(?:pdf|zip|png|jpe?g|gif|svg|css|js)$/i.test(link.pathname))
    .sort((a, b) => Number(preferred.test(b.pathname)) - Number(preferred.test(a.pathname)))
    .slice(0, MAX_PAGES - 1);
}

export async function researchWebsite(website, { lookup = dns.lookup, requestImpl = https.request, totalTimeoutMs = CRAWL_TIMEOUT_MS } = {}) {
  const base = new URL(website);
  if (base.protocol !== 'https:' || base.port || base.username || base.password) throw new AppError('Website research requires a public HTTPS website on port 443.');
  const deadline = Date.now() + totalTimeoutMs;
  const records = await withinDeadline(publicLookup(base.hostname, lookup), deadline);
  const getPage = (url, expectedType = 'text/html') => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.reject(new AppError(RESEARCH_TIMEOUT, 504));
    return withinDeadline(requestPage(url, records, expectedType, requestImpl, Math.min(TIMEOUT_MS, remaining)), deadline);
  };
  const origin = new URL('/', base);
  let blocked = () => false, crawlChildren = true;
  try {
    const robots = await getPage(new URL('/robots.txt', base), 'text/plain');
    blocked = robotsRules(robots);
  } catch (error) {
    if (error instanceof AppError && (error.status === 400 || error.status === 504)) throw error;
    crawlChildren = false; // If robots.txt is unavailable, research only the configured homepage.
  }
  const root = new URL(base.pathname || '/', origin);
  if (blocked(root.pathname)) throw new AppError('robots.txt disallows the configured website path.', 403);
  const rootHtml = await getPage(root);
  const pages = [{ url: root.href, ...pageText(rootHtml, root) }];
  const links = crawlChildren ? candidateLinks(rootHtml, root).filter(link => !blocked(link.pathname)) : [];
  for (const link of links) {
    if (pages.length >= MAX_PAGES) break;
    try { pages.push({ url: link.href, ...pageText(await getPage(link), link) }); }
    catch (error) { if (error instanceof AppError && (error.status === 400 || error.status === 504)) throw error; }
  }
  const context = pages.map(page => [page.title, page.description, page.text].filter(Boolean).join('\n')).join('\n\n').slice(0, 20000);
  if (!context) throw new AppError('No readable text was found on the website.', 502);
  return { pages: pages.map(({ url, title }) => ({ url, title })), context, chars: context.length };
}

// Crawl only URLs returned by search for operator-approved exact hostnames.
// Search discovery is separate so the crawler never follows arbitrary links.
export async function researchUrls(urls, approvedDomains, { lookup = dns.lookup, requestImpl = https.request, totalTimeoutMs = CRAWL_TIMEOUT_MS } = {}) {
  const hosts = new Set(approvedDomains.filter(host => host !== 'teamblind.com' && !host.endsWith('.teamblind.com')));
  const normalized = urls.map(value => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.port || url.username || url.password || !hosts.has(url.hostname.toLowerCase())) return null;
      url.search = ''; url.hash = '';
      return url;
    } catch { return null; }
  }).filter(Boolean);
  const candidates = [...new Map(normalized.map(url => [url.href, url])).values()].slice(0, 8);
  if (!candidates.length) return { pages: [], chars: 0 };
  const deadline = Date.now() + totalTimeoutMs;
  const recordsByHost = new Map(), robotsByHost = new Map();
  const getRecords = async host => {
    if (!recordsByHost.has(host)) recordsByHost.set(host, await withinDeadline(publicLookup(host, lookup), deadline));
    return recordsByHost.get(host);
  };
  const getPage = async (url, expectedType = 'text/html') => {
    const records = await getRecords(url.hostname);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new AppError(RESEARCH_TIMEOUT, 504);
    return withinDeadline(requestPage(url, records, expectedType, requestImpl, Math.min(TIMEOUT_MS, remaining)), deadline);
  };
  const pages = [];
  for (const url of candidates) {
    try {
      const host = url.hostname.toLowerCase();
      let blocked = robotsByHost.get(host);
      if (!blocked) {
        const robots = await getPage(new URL('/robots.txt', url), 'text/plain');
        blocked = robotsRules(robots);
        robotsByHost.set(host, blocked);
      }
      if (blocked(url.pathname)) continue;
      const html = await getPage(url);
      const extracted = pageText(html, url);
      if (extracted.title || extracted.description || extracted.text) pages.push({ url: url.href, ...extracted });
    } catch (error) {
      if (error instanceof AppError && (error.status === 400 || error.status === 504)) throw error;
      // A missing robots.txt or unreadable individual page means skip that result.
    }
  }
  return { pages: pages.map(page => ({ ...page, text: page.text.slice(0, 6000) })), chars: pages.reduce((sum, page) => sum + page.text.length, 0) };
}
