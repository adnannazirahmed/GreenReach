import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

async function createProject(page, name) {
  await page.getByRole('button', { name: 'Create a project', exact: true }).click();
  const form = page.locator('#new-project-form');
  await expect(form).toBeVisible();
  await form.locator('[name="name"]').fill(name);
  await form.locator('[name="website"]').fill('https://example.com');
  await form.locator('[name="description"]').fill('A test project for organizing work with small teams.');
  await form.locator('[name="audience"]').fill('Small teams');
  await form.getByRole('button', { name: /^Create project/ }).click();
  await expect(page.getByText('Your workspace is ready.', { exact: false })).toBeVisible();
}

async function importConversation(page, { title, body, url }) {
  await page.getByRole('button', { name: 'Add conversation', exact: true }).click();
  const form = page.locator('#import-form');
  await expect(form).toBeVisible();
  await form.locator('[name="url"]').fill(url);
  await form.locator('[name="title"]').fill(title);
  await form.locator('[name="body"]').fill(body);
  await form.getByRole('button', { name: /^Import conversations/ }).click();
  await expect(page.locator('#toast')).toContainText('1 imported');
  await expect(page.locator('#modal')).not.toHaveAttribute('open', '');
}

test('demo conversations are visibly fictional and cannot be imported into', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Demo workspace', { exact: true })).toBeVisible();
  await expect(page.getByText('Demo workspace · All conversations, rankings, and volumes are fictional.')).toBeVisible();

  const sampleTitle = page.getByRole('button', { name: 'What project management tool actually works for a small agency?', exact: true });
  await sampleTitle.click();
  await expect(page.locator('#detail')).toContainText('Fictional demo');
  await expect(page.locator('#detail')).toContainText('this conversation is fictional');
  await page.getByRole('button', { name: 'Close conversation', exact: true }).click();

  await page.getByRole('button', { name: 'Add conversation', exact: true }).click();
  await expect(page.locator('#modal')).toContainText('Plant the seed.');
  await expect(page.locator('#new-project-form')).toBeVisible();
});

test('create, import, edit, save, and move a conversation through the pipeline', async ({ page }) => {
  const projectName = `E2E workflow ${Date.now()}`;
  const title = `E2E workflow conversation ${Date.now()}`;
  await page.goto('/');
  await createProject(page, projectName);
  await importConversation(page, {
    title,
    body: 'Our small team needs a simple way to organize client projects and deadlines.',
    url: `https://www.reddit.com/r/SaaS/comments/e2e${Date.now()}/workflow_question/`,
  });

  await page.getByRole('button', { name: title, exact: true }).click();
  const detail = page.locator('#detail');
  await detail.getByRole('button', { name: 'Create template', exact: true }).click();
  await expect(detail).toContainText(/template · not AI-generated/i);
  await detail.getByRole('textbox', { name: 'Reply draft' }).fill('Thanks for sharing this. Here is a practical starting point.');
  await detail.locator('#item-notes').fill('Check the community rules before responding.');
  await detail.locator('#item-status').selectOption('replied');
  await detail.locator('#item-stage').selectOption('converted');
  await detail.getByRole('button', { name: 'Save notes & status' }).click();
  await expect(page.locator('#toast')).toContainText('Saved to your workspace');
  await expect(detail.locator('#draft-text')).toHaveValue('Thanks for sharing this. Here is a practical starting point.');
  await expect(detail.locator('#item-notes')).toHaveValue('Check the community rules before responding.');

  await detail.getByRole('button', { name: 'Close conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Reply studio', exact: true }).click();
  await expect(page.locator('.draft-card')).toContainText(title);
  await expect(page.locator('.draft-card')).toContainText('Thanks for sharing this. Here is a practical starting point.');
  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  const pipelineCard = page.locator('.pipeline-card').filter({ hasText: title });
  await expect(pipelineCard).toBeVisible();
  await expect(pipelineCard.getByRole('combobox', { name: 'Move pipeline stage' })).toHaveValue('converted');

  await page.reload();
  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  await expect(page.locator('.pipeline-card').filter({ hasText: title })).toBeVisible();
  await page.getByRole('button', { name: title, exact: true }).click();
  await expect(page.locator('#item-status')).toHaveValue('replied');
  await expect(page.locator('#item-stage')).toHaveValue('converted');
  await expect(page.locator('#item-notes')).toHaveValue('Check the community rules before responding.');
});

test('search and saved filters show the matching conversation and honor unsave', async ({ page }) => {
  await page.goto('/');
  await page.locator('button.nav-item[data-view="opportunities"]').click();
  const search = page.getByRole('textbox', { name: 'Search conversations' });
  await search.fill('alternative to Asana for a 5-person team');
  const card = page.locator('article.opportunity').filter({ hasText: 'Looking for an alternative to Asana for a 5-person team' });
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: 'Save conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(page.locator('article.opportunity').filter({ hasText: 'Looking for an alternative to Asana for a 5-person team' })).toBeVisible();

  await page.locator('article.opportunity').filter({ hasText: 'Looking for an alternative to Asana for a 5-person team' })
    .getByRole('button', { name: 'Unsave conversation', exact: true }).click();
  await expect(page.locator('#feed')).toContainText('A little quiet here, for now.');
});

test('CSV and JSON downloads contain the project conversation and saved draft', async ({ page }) => {
  const projectName = `E2E export ${Date.now()}`;
  const title = `E2E export conversation ${Date.now()}`;
  const draft = 'A portable draft with a useful next step.';
  await page.goto('/');
  await createProject(page, projectName);
  await importConversation(page, {
    title,
    body: 'We are comparing tools for organizing small team projects.',
    url: `https://www.reddit.com/r/SaaS/comments/export${Date.now()}/tool_question/`,
  });
  await page.getByRole('button', { name: title, exact: true }).click();
  const detail = page.locator('#detail');
  await detail.getByRole('textbox', { name: 'Reply draft' }).fill(draft);
  await detail.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.locator('#toast')).toContainText('Saved to your workspace');

  await detail.getByRole('button', { name: 'Close conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Insights', exact: true }).click();
  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-export="csv"]').click(),
  ]);
  expect(csvDownload.suggestedFilename()).toMatch(/\.csv$/);
  const csv = await readFile(await csvDownload.path(), 'utf8');
  expect(csv).toContain(title);
  expect(csv).toContain(draft);

  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-export="json"]').click(),
  ]);
  expect(jsonDownload.suggestedFilename()).toMatch(/\.json$/);
  const exported = JSON.parse(await readFile(await jsonDownload.path(), 'utf8'));
  expect(exported.project.name).toBe(projectName);
  expect(exported.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ title, draft }),
  ]));
});
