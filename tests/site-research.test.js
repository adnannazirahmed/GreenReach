import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { researchWebsite, researchUrls } from '../server/site-research.js';

const publicDns = async () => [{ address: '8.8.8.8', family: 4 }];

function fakeHttps({ responseFor, tricklePath } = {}) {
  const requests = [];
  const pinnedAddresses = [];
  const requestImpl = (url, options, onResponse) => {
    requests.push(url.pathname);
    options.lookup(url.hostname, {}, (error, address) => { if (!error) pinnedAddresses.push(address); });
    const req = new EventEmitter();
    let drip;
    req.destroy = error => {
      clearInterval(drip);
      if (error) queueMicrotask(() => req.emit('error', error));
      return req;
    };
    req.end = () => queueMicrotask(() => {
      const plan = responseFor(url);
      const res = new EventEmitter();
      res.statusCode = plan.status ?? 200;
      res.headers = { 'content-type': url.pathname === '/robots.txt' ? 'text/plain' : 'text/html' };
      res.resume = () => {};
      res.destroy = () => {};
      onResponse(res);
      if (url.pathname === tricklePath) drip = setInterval(() => res.emit('data', Buffer.from('x')), 5);
      else if (plan.body !== undefined) {
        res.emit('data', Buffer.from(plan.body));
        res.emit('end');
      }
    });
    return req;
  };
  return { requestImpl, requests, pinnedAddresses };
}

test('research pins requests to validated public DNS and limits crawling to same-host relevant pages', async () => {
  const { requestImpl, requests, pinnedAddresses } = fakeHttps({ responseFor: url => {
    if (url.pathname === '/robots.txt') return { body: 'User-agent: *\nAllow: /' };
    if (url.pathname === '/') return { body: '<title>GreenReach</title><main>Reddit listening for small SaaS teams.</main><a href="/pricing">Pricing</a><a href="https://other.example/private">External</a>' };
    return { body: '<title>Pricing</title><main>Open source pricing.</main>' };
  } });
  const result = await researchWebsite('https://example.com', { lookup: publicDns, requestImpl });
  assert.deepEqual(requests, ['/robots.txt', '/', '/pricing']);
  assert.deepEqual(pinnedAddresses, ['8.8.8.8', '8.8.8.8', '8.8.8.8']);
  assert.equal(result.pages.length, 2);
  assert.match(result.context, /Reddit listening/);
  assert.match(result.context, /Open source pricing/);
  assert.doesNotMatch(result.context, /External/);
});

test('research blocks DNS answers containing any private address before making requests', async () => {
  const { requestImpl, requests } = fakeHttps({ responseFor: () => ({ body: '' }) });
  await assert.rejects(researchWebsite('https://example.com', {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }], requestImpl,
  }), error => error.status === 400 && /private or reserved/.test(error.message));
  assert.deepEqual(requests, []);
});

test('research rejects expanded reserved IPv6 answers and accepts globally reachable IPv6 exceptions', async () => {
  const blocked = fakeHttps({ responseFor: () => ({ body: '' }) });
  for (const address of [
    '2001:0000:0000:0000:0000:0000:0000:0001', // expanded Teredo
    '2001:0002:0000:0000:0000:0000:0000:0001', // benchmarking range
    '2001:0001:0000:0000:0000:0000:0000:0004', // unassigned IETF range
  ]) {
    await assert.rejects(researchWebsite('https://example.com', {
      lookup: async () => [{ address, family: 6 }], requestImpl: blocked.requestImpl,
    }), error => error.status === 400 && /private or reserved/.test(error.message));
  }
  assert.deepEqual(blocked.requests, []);

  for (const address of ['2001:1::1', '2001:1::2', '2001:1::3', '2001:3::1', '2001:4:112::1', '2001:20::1', '2001:30::1', '2606:4700:4700::1111']) {
    const publicV6 = fakeHttps({ responseFor: url => url.pathname === '/robots.txt'
      ? { body: 'User-agent: *\nAllow: /' } : { body: '<main>Public IPv6 site.</main>' } });
    const result = await researchWebsite('https://example.com', {
      lookup: async () => [{ address, family: 6 }], requestImpl: publicV6.requestImpl,
    });
    assert.match(result.context, /Public IPv6 site/);
    assert.ok(publicV6.pinnedAddresses.every(pinned => pinned === address));
  }
});

test('research puts a total deadline on DNS resolution', async () => {
  await assert.rejects(researchWebsite('https://example.com', { lookup: () => new Promise(() => {}), totalTimeoutMs: 20 }),
    error => error.status === 504 && /total time limit/.test(error.message));
});

test('research rejects redirects and oversized pages', async () => {
  const redirect = fakeHttps({ responseFor: url => url.pathname === '/robots.txt' ? { status: 302 } : { body: '<main>Home</main>' } });
  await assert.rejects(researchWebsite('https://example.com', { lookup: publicDns, requestImpl: redirect.requestImpl }), error => error.status === 400);

  const oversized = fakeHttps({ responseFor: url => url.pathname === '/robots.txt' ? { body: 'User-agent: *\nAllow: /' } : { body: 'x'.repeat(1_000_001) } });
  await assert.rejects(researchWebsite('https://example.com', { lookup: publicDns, requestImpl: oversized.requestImpl }), error => error.status === 502 && /1 MB/.test(error.message));
});

test('research rejects a trickling page at its absolute request deadline', async () => {
  const transport = fakeHttps({ responseFor: url => url.pathname === '/robots.txt' ? { body: 'User-agent: *\nAllow: /' } : {}, tricklePath: '/' });
  await assert.rejects(researchWebsite('https://example.com', { lookup: publicDns, requestImpl: transport.requestImpl, totalTimeoutMs: 80 }),
    error => error.status === 504 && /timed out|total time limit/.test(error.message));
});

test('web sweep fetches only exact approved hosts and robots-allowed HTTPS pages', async () => {
  const { requestImpl, requests, pinnedAddresses } = fakeHttps({ responseFor: url => {
    if (url.pathname === '/robots.txt') return { body: 'User-agent: *\nDisallow: /blocked' };
    return { body: `<title>${url.hostname}</title><main>Public customer discussion about an unmet need.</main>` };
  } });
  const result = await researchUrls([
    'https://forum.example.org/t/pain', 'https://forum.example.org/blocked/thread',
    'https://evil.example.net/private', 'http://forum.example.org/insecure',
  ], ['forum.example.org'], { lookup: publicDns, requestImpl });
  assert.deepEqual(requests, ['/robots.txt', '/t/pain']);
  assert.equal(result.pages.length, 1);
  assert.match(result.pages[0].text, /unmet need/);
  assert.deepEqual(pinnedAddresses, ['8.8.8.8', '8.8.8.8']);
});

test('web sweep rejects any host that resolves to a private address before requesting it', async () => {
  const { requestImpl, requests } = fakeHttps({ responseFor: () => ({ body: '' }) });
  await assert.rejects(researchUrls(['https://forum.example.org/thread'], ['forum.example.org'], {
    lookup: async () => [{ address: '10.0.0.8', family: 4 }], requestImpl,
  }), error => error.status === 400 && /private or reserved/.test(error.message));
  assert.deepEqual(requests, []);
});

test('web extraction recognizes discussion metadata and produces a quality signal', async () => {
  const structured = JSON.stringify({ '@context': 'https://schema.org', '@type': 'DiscussionForumPosting', headline: 'A better workflow', datePublished: '2026-10-12T10:00:00Z', author: { '@type': 'Person', name: 'Founder' } });
  const html = `<html><head><title>Looking for a tool</title><meta content="A detailed public discussion" property="og:description"><script type="application/ld+json">${structured}</script></head><body><main><h1>Looking for a tool</h1><p>Our small team has tried several project tools and the current workflow is too expensive and frustrating. We need a practical alternative that handles client updates and deadlines without adding more complexity.</p></main></body></html>`;
  const { requestImpl } = fakeHttps({ responseFor: url => url.pathname === '/robots.txt' ? { body: 'User-agent: *\nAllow: /' } : { body: html } });
  const result = await researchUrls(['https://forum.example.org/thread/project-tools'], ['forum.example.org'], { lookup: publicDns, requestImpl });
  assert.equal(result.pages[0].pageType, 'discussion');
  assert.equal(result.pages[0].author, 'Founder');
  assert.equal(result.pages[0].publishedAt, '2026-10-12T10:00:00.000Z');
  assert.ok(result.pages[0].extractionQuality >= 50);
  assert.doesNotMatch(result.pages[0].text, /schema.org|application\/ld\+json/);
});

test('web sweep never fetches Blind, even if a legacy project contains it', async () => {
  let lookups = 0;
  const result = await researchUrls(['https://www.teamblind.com/post/example'], ['teamblind.com', 'www.teamblind.com'], {
    lookup: async () => { lookups++; return [{ address: '8.8.8.8', family: 4 }]; },
  });
  assert.equal(result.pages.length, 0);
  assert.equal(lookups, 0);
});

test('robots parser prefers the GreenReach group over wildcard rules', async () => {
  const { requestImpl, requests } = fakeHttps({ responseFor: url => url.pathname === '/robots.txt'
    ? { body: 'User-agent: *\nDisallow: /\nUser-agent: GreenReach\nAllow: /thread/\nDisallow: /thread/private' }
    : { body: '<main><p>This is enough public content to test group precedence and a compliant robots allow rule in the crawler.</p></main>' } });
  const result = await researchUrls(['https://forum.example.org/thread/public', 'https://forum.example.org/thread/private'], ['forum.example.org'], { lookup: publicDns, requestImpl });
  assert.equal(result.pages.length, 1);
  assert.deepEqual(requests, ['/robots.txt', '/thread/public']);
});
