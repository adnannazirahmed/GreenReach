import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { researchWebsite } from '../server/site-research.js';

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
