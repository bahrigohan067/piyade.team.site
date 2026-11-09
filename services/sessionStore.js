const fs = require('fs');
const path = require('path');
const session = require('express-session');

/**
 * Express-Session için Production uyumlu Kalıcı Dosya Tabanlı Oturum Deposu (PersistentStore).
 * Varsayılan MemoryStore'un bellek sızıntısı ve yeniden başlatmada oturum kaybı sorunlarını giderir.
 */
class PersistentSessionStore extends session.Store {
  constructor(options = {}) {
    super(options);
    this.dirPath = options.dirPath || path.join(process.cwd(), '.sessions');
    this.filePath = path.join(this.dirPath, 'sessions.json');
    this.ttlMs = options.ttlMs || 24 * 60 * 60 * 1000; // 24 saat
    this.sessions = new Map();
    this._writeTimer = null;

    this._ensureDirectory();
    this._loadFromDisk();

    // Her 10 dakikada bir süresi dolmuş oturumları temizle
    this._pruneTimer = setInterval(() => {
      this.pruneExpired();
    }, options.pruneIntervalMs || 10 * 60 * 1000);
    if (this._pruneTimer.unref) {
      this._pruneTimer.unref();
    }
  }

  _ensureDirectory() {
    try {
      if (!fs.existsSync(this.dirPath)) {
        fs.mkdirSync(this.dirPath, { recursive: true, mode: 0o700 });
      }
    } catch (_) {}
  }

  _loadFromDisk() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, 'utf8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw);
      const now = Date.now();
      for (const [sid, entry] of Object.entries(parsed)) {
        if (entry && entry.expiresAt > now && entry.data) {
          this.sessions.set(sid, entry);
        }
      }
    } catch (_) {
      this.sessions = new Map();
    }
  }

  _scheduleFlush() {
    if (this._writeTimer) return;
    this._writeTimer = setTimeout(() => {
      this._writeTimer = null;
      this._flushToDisk();
    }, 100);
    if (this._writeTimer.unref) {
      this._writeTimer.unref();
    }
  }

  _flushToDisk() {
    try {
      this._ensureDirectory();
      const now = Date.now();
      const serializable = {};
      for (const [sid, entry] of this.sessions.entries()) {
        if (entry.expiresAt > now) {
          serializable[sid] = entry;
        }
      }
      const tmpPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(serializable), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmpPath, this.filePath);
    } catch (_) {}
  }

  _getExpiration(sess) {
    if (sess && sess.cookie && sess.cookie.expires) {
      const exp = new Date(sess.cookie.expires).getTime();
      if (!Number.isNaN(exp)) return exp;
    }
    if (sess && sess.cookie && typeof sess.cookie.maxAge === 'number') {
      return Date.now() + sess.cookie.maxAge;
    }
    return Date.now() + this.ttlMs;
  }

  pruneExpired() {
    const now = Date.now();
    let changed = false;
    for (const [sid, entry] of this.sessions.entries()) {
      if (!entry || entry.expiresAt <= now) {
        this.sessions.delete(sid);
        changed = true;
      }
    }
    if (changed) {
      this._scheduleFlush();
    }
  }

  get(sid, callback) {
    try {
      const entry = this.sessions.get(sid);
      if (!entry) return callback(null, null);

      if (entry.expiresAt <= Date.now()) {
        this.sessions.delete(sid);
        this._scheduleFlush();
        return callback(null, null);
      }

      const sessionObj = JSON.parse(entry.data);
      return callback(null, sessionObj);
    } catch (err) {
      return callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const expiresAt = this._getExpiration(sess);
      this.sessions.set(sid, {
        expiresAt,
        data: JSON.stringify(sess),
      });
      this._scheduleFlush();
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  touch(sid, sess, callback) {
    try {
      const entry = this.sessions.get(sid);
      if (entry) {
        entry.expiresAt = this._getExpiration(sess);
        entry.data = JSON.stringify(sess);
        this._scheduleFlush();
      }
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      this.sessions.delete(sid);
      this._scheduleFlush();
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  length(callback) {
    this.pruneExpired();
    callback(null, this.sessions.size);
  }

  clear(callback) {
    this.sessions.clear();
    this._scheduleFlush();
    if (callback) callback(null);
  }

  all(callback) {
    try {
      this.pruneExpired();
      const result = {};
      for (const [sid, entry] of this.sessions.entries()) {
        result[sid] = JSON.parse(entry.data);
      }
      callback(null, result);
    } catch (err) {
      callback(err);
    }
  }
}

module.exports = PersistentSessionStore;
