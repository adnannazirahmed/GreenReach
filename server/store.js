import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export class Store {
  constructor(path = process.env.DATABASE_PATH || './data/greenreach.db') {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS opportunities (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, url TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(project_id,url));
      CREATE INDEX IF NOT EXISTS opportunities_project ON opportunities(project_id);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, project_id TEXT, data TEXT NOT NULL);`);
  }
  projects() { return this.db.prepare('SELECT data FROM projects ORDER BY rowid').all().map(r => JSON.parse(r.data)); }
  project(id) { const row = this.db.prepare('SELECT data FROM projects WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; }
  saveProject(p) { this.db.prepare('INSERT INTO projects VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(p.id, JSON.stringify(p)); return p; }
  items(pid) { return this.db.prepare('SELECT data FROM opportunities WHERE project_id=? ORDER BY rowid DESC').all(pid).map(r => JSON.parse(r.data)); }
  item(id) { const r = this.db.prepare('SELECT data FROM opportunities WHERE id=?').get(id); return r ? JSON.parse(r.data) : null; }
  saveItem(item) { this.db.prepare('UPDATE opportunities SET data=? WHERE id=?').run(JSON.stringify(item), item.id); return item; }
  insert(item) {
    return this.db.prepare('INSERT OR IGNORE INTO opportunities VALUES (?,?,?,?)').run(item.id, item.projectId, item.url, JSON.stringify(item)).changes > 0;
  }
  transaction(fn) { this.db.exec('BEGIN'); try { const value = fn(); this.db.exec('COMMIT'); return value; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  deleteProject(pid) { this.transaction(() => { this.db.prepare('DELETE FROM opportunities WHERE project_id=?').run(pid); this.db.prepare('DELETE FROM events WHERE project_id=?').run(pid); this.db.prepare('DELETE FROM projects WHERE id=?').run(pid); }); }
  deleteItem(id) { this.db.prepare('DELETE FROM opportunities WHERE id=?').run(id); }
  event(pid, text, kind = 'activity') { const e = { text, kind, at: new Date().toISOString() }; this.db.prepare('INSERT INTO events(project_id,data) VALUES (?,?)').run(pid, JSON.stringify(e)); return e; }
  events(pid) { return this.db.prepare('SELECT data FROM events WHERE project_id=? ORDER BY id DESC LIMIT 60').all(pid).map(r => JSON.parse(r.data)); }
  close() { this.db.close(); }
}
