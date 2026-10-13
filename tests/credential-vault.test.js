import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { CredentialVault } from '../server/credential-vault.js';

const key = Buffer.alloc(32, 0x5a).toString('base64');

function withVault(fn, env = { CREDENTIALS_ENCRYPTION_KEY: key }) {
  const store = new Store(':memory:');
  try { return fn(new CredentialVault(store, env), store); }
  finally { store.close(); }
}

test('credential vault encrypts credentials at rest and decrypts them with the configured key', () => {
  withVault((vault, store) => {
    const secret = 'fixture-provider-token-never-real';
    vault.set('SERPAPI_KEY', secret);

    const saved = store.credentials()[0];
    assert.equal(saved.name, 'SERPAPI_KEY');
    assert.notEqual(saved.value, secret);
    assert.equal(Buffer.from(saved.value, 'base64').length > 29, true);
    assert.equal(vault.all().SERPAPI_KEY, secret);
    assert.equal(vault.decrypt('SERPAPI_KEY', saved.value), secret);
  });
});

test('credential vault uses authenticated encryption and binds ciphertext to its credential name', () => {
  withVault((vault) => {
    const packed = vault.encrypt('OPENAI_API_KEY', 'fixture-openai-secret');
    assert.throws(() => vault.decrypt('SERPAPI_KEY', packed), /Could not decrypt a saved provider credential/);

    const bytes = Buffer.from(packed, 'base64');
    bytes[bytes.length - 1] ^= 1;
    assert.throws(() => vault.decrypt('OPENAI_API_KEY', bytes.toString('base64')), /Could not decrypt a saved provider credential/);
    assert.throws(() => vault.decrypt('OPENAI_API_KEY', 'not-valid-ciphertext'), /Could not decrypt a saved provider credential/);
  });
});

test('credential vault rejects encryption keys that do not decode to exactly 32 bytes', () => {
  const store = new Store(':memory:');
  try {
    assert.throws(() => new CredentialVault(store, { CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(31).toString('base64') }), /must be a base64-encoded 32-byte key/);
    assert.throws(() => new CredentialVault(store, { CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(33).toString('base64') }), /must be a base64-encoded 32-byte key/);
  } finally { store.close(); }
});

test('status reports provider capability without disclosing configured secret values', () => {
  withVault((vault) => {
    const apiSecret = 'fixture-only-secret-do-not-disclose';
    vault.set('SERPAPI_KEY', apiSecret);
    vault.set('OPENAI_API_KEY', 'fixture-only-openai-secret');
    vault.set('OPENAI_MODEL', 'fixture-model');

    const status = vault.status({ REDDIT_CLIENT_ID: 'fixture-client-id' });
    assert.deepEqual(status, {
      redditAccessToken: false,
      redditClientId: true,
      redditClientSecret: false,
      redditUserAgent: false,
      serpApiKey: true,
      openAiApiKey: true,
      openAiModel: true,
      openAiBaseUrl: false,
    });
    assert.ok(Object.values(status).every(value => typeof value === 'boolean'));
    assert.equal(JSON.stringify(status).includes(apiSecret), false);
    assert.equal(JSON.stringify(status).includes('fixture-only-openai-secret'), false);
  });
});

test('savedStatus distinguishes persisted settings from environment-only settings without exposing values', () => {
  withVault((vault) => {
    vault.set('SERPAPI_KEY', 'fixture-serp-secret');
    const saved = vault.savedStatus();
    assert.deepEqual(saved, {
      redditAccessToken: false,
      redditClientId: false,
      redditClientSecret: false,
      redditUserAgent: false,
      serpApiKey: true,
      openAiApiKey: false,
      openAiModel: false,
      openAiBaseUrl: false,
    });
    assert.ok(Object.values(saved).every(value => typeof value === 'boolean'));
    assert.equal(JSON.stringify(saved).includes('fixture-serp-secret'), false);
  });
});

test('deleting a saved credential removes its capability and encrypted record', () => {
  withVault((vault, store) => {
    vault.set('SERPAPI_KEY', 'fixture-serp-secret');
    assert.equal(vault.savedStatus().serpApiKey, true);

    vault.delete('SERPAPI_KEY');
    assert.equal(vault.savedStatus().serpApiKey, false);
    assert.equal(vault.status().serpApiKey, false);
    assert.deepEqual(store.credentials(), []);
  });
});
