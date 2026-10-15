import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { opportunityInput, projectInput } from '../server/domain.js';
import { mergeDiscovery, normalizeOpportunity, possibleDuplicateGroups, recalculateOpportunity, reviewHash, reviewStatus } from '../server/recommendations.js';
import { Store } from '../server/store.js';

const project = { ...projectInput({ name: 'GreenReach', description: 'Find useful public conversations for a product', audience: 'Small SaaS teams', keywords: ['project management'] }), id: 'project' };
const url = 'https://reddit.com/r/SaaS/comments/abc123/a_title/';
const make = (title, body, source, textOrigin, otherUrl = url) => ({ ...opportunityInput({ title, body, url: otherUrl, keyword: 'project management' }, project), source, textOrigin });

test('discovery preserves full text, workflow state, AI review, and both observations', () => {
  const direct = normalizeOpportunity(make('Project management recommendation', 'I need a project management tool for my agency. We manage several clients and need a simpler workflow that our team can adopt quickly.', 'reddit', 'api'));
  direct.status = 'reviewing'; direct.notes = 'Contact later'; direct.draft = 'Useful draft';
  direct.aiReview = { verdict: 'Recommend', relevance: 90, intent: 'Buying intent', sentiment: 'neutral', evidence: 'I need a project management tool', reason: 'Specific need.', nextStep: 'Answer the question.', model: 'fixture', reviewedAt: new Date().toISOString(), inputHash: reviewHash(direct, project) };
  const google = make('A search title', 'Short search snippet.', 'google', 'snippet'); google.googlePosition = 3;
  const merged = mergeDiscovery(direct, google, project);
  assert.equal(merged.body, direct.body);
  assert.equal(merged.textOrigin, 'api');
  assert.equal(merged.status, 'reviewing'); assert.equal(merged.notes, 'Contact later'); assert.equal(merged.draft, 'Useful draft');
  assert.equal(merged.aiReviewStatus, 'current'); assert.equal(merged.aiReview.verdict, 'Recommend');
  assert.deepEqual(merged.observations.map(o=>o.via), ['reddit', 'google']);
  assert.equal(merged.googlePosition, 3);
  const changed = mergeDiscovery(merged, make('A changed title', 'A different, longer account of the problem. We need a project management tool that supports many clients and our whole team, with useful reporting and a simple workflow.', 'reddit', 'api'), project);
  assert.equal(reviewStatus(changed, project), 'stale');
});

test('a full source response replaces a thin snippet, while Google rank does not raise need score', () => {
  const google = normalizeOpportunity(make('Looking for project management tools', 'Could use a tool.', 'google', 'snippet'));
  const api = make('Looking for project management tools', 'We are trying to replace our project management tool. Our agency needs a simpler way to track projects, deadlines, and client requests across the team.', 'reddit', 'api');
  const merged = mergeDiscovery(google, api, project);
  assert.equal(merged.body, api.body); assert.equal(merged.textOrigin, 'api');
  const ranked = recalculateOpportunity({ ...merged, googlePosition: 1 }, project);
  assert.equal(ranked.analysis.score, recalculateOpportunity({ ...merged, googlePosition: null }, project).analysis.score);
  assert.equal(ranked.analysis.factors.search, undefined);
  const emptyApi = normalizeOpportunity(make('A linked Reddit post', '', 'reddit', 'api'));
  assert.equal(mergeDiscovery(emptyApi, google, project).body, google.body);
});

test('negated intent does not count as a buying request and similar posts remain separate', () => {
  const negated = make('We do not need a project management recommendation', 'Sharing notes about our existing process.', 'reddit', 'api');
  assert.notEqual(recalculateOpportunity(negated, project).analysis.intent, 'Buying intent');
  const generic = make('What tools do you recommend for home repairs?', 'I need a drill and a moisture meter.', 'reddit', 'api');
  assert.notEqual(recalculateOpportunity(generic, project).analysis.intent, 'Buying intent');
  const ideas = make('What project management software ideas should I build?', 'I am brainstorming startup ideas, not shopping for a product.', 'reddit', 'api');
  assert.notEqual(recalculateOpportunity(ideas, project).analysis.intent, 'Buying intent');
  const one = normalizeOpportunity(make('Looking for better project management software for agencies', 'Our agency needs project management software for clients and teams. We want a simpler workflow with deadlines and clear assignments.', 'reddit', 'api'));
  const two = normalizeOpportunity(make('Looking for better project management software for agencies', 'Our agency needs project management software for clients and teams. We want a simpler workflow with deadlines and clear assignments.', 'hackernews', 'api', 'https://news.ycombinator.com/item?id=321'));
  const groups = possibleDuplicateGroups([one, two]);
  assert.deepEqual(groups.get(one.id), [one.id, two.id]);
  assert.notEqual(one.url, two.url);
});

test('existing AI analyses migrate as legacy without losing user edits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'greenreach-recommendations-'));
  try {
    const path = join(dir, 'db.sqlite');
    const store = new Store(path);
    const legacy = opportunityInput({ title: 'Need project management software', body: 'Looking for an alternative.', url }, project);
    legacy.notes = 'Preserve this'; legacy.analysis = { ...legacy.analysis, method: 'openai:old-model', reason: 'Older review' };
    store.db.prepare('INSERT INTO opportunities VALUES (?,?,?,?)').run(legacy.id, project.id, legacy.url, JSON.stringify(legacy));
    store.close();
    const reopened = new Store(path);
    const migrated = reopened.item(legacy.id);
    assert.equal(migrated.notes, 'Preserve this');
    assert.equal(migrated.aiReview.legacy, true);
    assert.equal(reviewStatus(migrated, project), 'legacy');
    assert.equal(migrated.recommendationVersion, 1);
    const reviewed = { ...migrated, aiReview: { verdict: 'Maybe', relevance: 55, intent: 'Discussion', sentiment: 'neutral', evidence: migrated.title, reason: 'Fixture review.', nextStep: 'Read the thread.', model: 'fixture', reviewedAt: new Date().toISOString(), inputHash: reviewHash(migrated, project) } };
    reopened.saveItem(reviewed);
    reopened.close();
    const restarted = new Store(path);
    assert.equal(reviewStatus(restarted.item(legacy.id), project), 'current');
    restarted.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
