import { opportunityInput, projectInput, now } from './domain.js';

export function seed(store) {
  if (store.projects().length) return;
  const p = store.saveProject({ ...projectInput({ name: 'Orbit', website: 'https://example.com', description: 'A simple project management workspace for small teams. Plan projects, track tasks, and keep client work organized in one place.', audience: 'Small agencies, founders, and remote teams', keywords: ['project management', 'task management', 'client work', 'small teams'], competitors: ['Asana', 'Monday', 'ClickUp'], ignoredSubreddits: [] }), id: 'demo-orbit', sample: true, createdAt: now() });
  const rows = [
    ['What project management tool actually works for a small agency?', 'We are a team of six juggling client work across spreadsheets. Looking for a project management tool that is simple enough that people actually use it. What would you recommend?', 'SaaS', 2, 38, 87, 1, 'project management', 2400],
    ['Looking for an alternative to Asana for a 5-person team', 'Asana is getting expensive. We mostly need task management, project timelines, and a place to keep client feedback. Any alternatives for small teams?', 'smallbusiness', 1, 24, 52, 2, 'Asana alternative', 1900],
    ['How are you keeping client work organized?', 'Running a small design studio and our project management process is chaos. What do other small teams use for client work without an enterprise setup?', 'freelance', 5, 16, 34, 3, 'client work', 720],
    ['Monday vs ClickUp: which one is less overwhelming?', 'I have tried both demos and there are so many features. Looking for a simple alternative for project management. What is your experience?', 'projectmanagement', 8, 45, 63, 4, 'Monday alternative', 1300],
    ['Our team finally has a workflow that makes sense', 'We love having everything in one place. Orbit has been helpful for our weekly planning. Curious how other small teams structure their week.', 'startups', 15, 12, 41, null, 'small teams', null],
    ['What do you look for when choosing task management software?', 'Collecting opinions for a project. Is it integrations, price, or how quickly you can onboard a team? I am especially interested in small teams.', 'productivity', 22, 19, 29, 7, 'task management', 3600],
    ['ClickUp feels like too much for our studio', 'Frustrated by how long it takes to set up simple client work. We need project management without the complexity. Is there a better option?', 'agency', 30, 31, 48, null, 'ClickUp alternative', null],
    ['A practical guide to weekly planning', 'Our approach to task management for small teams is to start each week with three priorities and leave room for unexpected work.', 'productivity', 48, 8, 112, null, 'task management', null],
  ];
  rows.forEach(([title, body, sub, hours, comments, upvotes, position, keyword, volume], i) => {
    const item = opportunityInput({ title, body, url: `https://www.reddit.com/r/${sub}/comments/demo${i + 1}/example/`, author: ['studio_founder', 'building_in_public', 'designbyday', 'remote_alex'][i % 4], comments, upvotes, publishedAt: new Date(Date.now() - hours * 3600000).toISOString(), googlePosition: position, keyword, searchVolume: volume }, p);
    store.insert({ ...item, source: 'demo', sample: true, saved: i === 2, status: i === 7 ? 'replied' : 'new' });
  });
  store.event(p.id, 'Demo workspace created. Every conversation and metric here is fictional.', 'system');
}
