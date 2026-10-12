import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { AppError } from './domain.js';

const ENV_KEY = 'CREDENTIALS_ENCRYPTION_KEY';

function loadKey(path, env) {
  if (env[ENV_KEY]) {
    const key = Buffer.from(env[ENV_KEY], 'base64');
    if (key.length !== 32) throw new Error(`${ENV_KEY} must be a base64-encoded 32-byte key.`);
    return key;
  }
  if (path === ':memory:') return randomBytes(32);
  const keyPath = join(dirname(resolve(path)), 'greenreach.credentials.key');
  try {
    const existing = readFileSync(keyPath);
    if (existing.length !== 32) throw new Error('Stored credentials encryption key has an invalid length.');
    try { chmodSync(keyPath, 0o600); } catch { /* Windows permissions are inherited from the data directory. */ }
    return existing;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const key = randomBytes(32);
  try { writeFileSync(keyPath, key, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; return loadKey(path, env); }
  return key;
}

export class CredentialVault {
  constructor(store, env = process.env) {
    this.store = store;
    this.key = loadKey(store.path, env);
  }
  encrypt(name, value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(name));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }
  decrypt(name, value) {
    try {
      const packed = Buffer.from(value, 'base64');
      if (packed.length < 29 || packed[0] !== 1) throw new Error('Unsupported credential format.');
      const decipher = createDecipheriv('aes-256-gcm', this.key, packed.subarray(1, 13));
      decipher.setAAD(Buffer.from(name));
      decipher.setAuthTag(packed.subarray(13, 29));
      return Buffer.concat([decipher.update(packed.subarray(29)), decipher.final()]).toString('utf8');
    } catch { throw new AppError('Could not decrypt a saved provider credential. Restore the matching credentials key from your backup.', 500); }
  }
  all() { return Object.fromEntries(this.store.credentials().map(({ name, value }) => [name, this.decrypt(name, value)])); }
  status(env = {}) {
    const effective = { ...env, ...this.all() };
    return {
      redditAccessToken: Boolean(effective.REDDIT_ACCESS_TOKEN),
      redditClientId: Boolean(effective.REDDIT_CLIENT_ID),
      redditClientSecret: Boolean(effective.REDDIT_CLIENT_SECRET),
      redditUserAgent: Boolean(effective.REDDIT_USER_AGENT),
      serpApiKey: Boolean(effective.SERPAPI_KEY),
      openAiApiKey: Boolean(effective.OPENAI_API_KEY),
      openAiModel: Boolean(effective.OPENAI_MODEL),
      openAiBaseUrl: Boolean(effective.OPENAI_BASE_URL),
    };
  }
  savedStatus() {
    const saved = new Set(this.store.credentials().map(({ name }) => name));
    return {
      redditAccessToken: saved.has('REDDIT_ACCESS_TOKEN'),
      redditClientId: saved.has('REDDIT_CLIENT_ID'),
      redditClientSecret: saved.has('REDDIT_CLIENT_SECRET'),
      redditUserAgent: saved.has('REDDIT_USER_AGENT'),
      serpApiKey: saved.has('SERPAPI_KEY'),
      openAiApiKey: saved.has('OPENAI_API_KEY'),
      openAiModel: saved.has('OPENAI_MODEL'),
      openAiBaseUrl: saved.has('OPENAI_BASE_URL'),
    };
  }
  set(name, value) { this.store.setCredential(name, this.encrypt(name, value)); }
  delete(name) { this.store.deleteCredential(name); }
}
