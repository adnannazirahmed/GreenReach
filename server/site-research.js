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
  const value = address.toLowerCase().split('%')[0];
  // Only globally routed IPv6 unicast is accepted; reject mapped IPv4 and special ranges.
  return (value.startsWith('2') || value.startsWith('3')) && !/^(?:2001:(?:0|2|10|db8):|2002:|3fff:)/.test(value);
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

function pageText(html) {
  const title = decode((html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const description = decode(html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)?.[1] || '').trim();
  const main = html.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)\s*>/i)?.[1] || html;
  const text = decode(main.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\s*br\b[^>]*>|<\/(?:p|div|li|h[1-6]|section|article)\s*>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[\t\r ]+/g, ' ').replace(/\n\s+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, description, text: text.slice(0, 6000) };
}

function robotsRules(text) {
  const rules = []; let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim(); if (!line.includes(':')) continue;
    const [key, ...valueParts] = line.split(':'); const value = valueParts.join(':').trim();
    if (key.trim().toLowerCase() === 'user-agent') applies = value === '*' || value.toLowerCase() === 'greenreach';
    else if (applies && value && ['allow', 'disallow'].includes(key.trim().toLowerCase())) rules.push({ allow: key.trim().toLowerCase() === 'allow', value });
  }
  return path => {
    const matched = rules.filter(rule => {
      const terminal = rule.value.endsWith('$'), source = terminal ? rule.value.slice(0, -1) : rule.value;
      const pattern = source.split('*').map(part => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')).join('.*');
      return new RegExp(`^${pattern}${terminal ? '$' : ''}`).test(path);
    }).sort((a, b) => b.value.length - a.value.length)[0];
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
  const pages = [{ url: root.href, ...pageText(rootHtml) }];
  const links = crawlChildren ? candidateLinks(rootHtml, root).filter(link => !blocked(link.pathname)) : [];
  for (const link of links) {
    if (pages.length >= MAX_PAGES) break;
    try { pages.push({ url: link.href, ...pageText(await getPage(link)) }); }
    catch (error) { if (error instanceof AppError && (error.status === 400 || error.status === 504)) throw error; }
  }
  const context = pages.map(page => [page.title, page.description, page.text].filter(Boolean).join('\n')).join('\n\n').slice(0, 20000);
  if (!context) throw new AppError('No readable text was found on the website.', 502);
  return { pages: pages.map(({ url, title }) => ({ url, title })), context, chars: context.length };
}
