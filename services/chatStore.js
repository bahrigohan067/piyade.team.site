const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chatConfig = require('../config/chat.config');

const DISCORD_ID_RE = /^\d{15,25}$/;
const CHAT_USER_ID_RE = /^(?:\d{15,25}|g_m_[A-Za-z0-9]{6,48})$/;
const CONV_ID_RE = /^(\d{15,25}|g_m_[A-Za-z0-9]{6,48})_(\d{15,25}|g_m_[A-Za-z0-9]{6,48})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

let idSeqCounter = 0;
let lastIdTs = 0;

/**
 * İki kullanıcı kimliğinden (Discord ID veya Google üye kimliği g_m_...) deterministik sohbet kimliği üretir.
 * URL'den gelen ham convId değerine asla güvenilmez; her zaman bu fonksiyonla türetilir.
 */
function makeConvId(idA, idB) {
  const a = String(idA || '').trim();
  const b = String(idB || '').trim();
  if (!CHAT_USER_ID_RE.test(a) || !CHAT_USER_ID_RE.test(b) || a === b) {
    return null;
  }
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function parseConvId(convId) {
  if (typeof convId !== 'string') return null;
  const match = CONV_ID_RE.exec(convId);
  if (!match) return null;
  const a = match[1];
  const b = match[2];
  if (a === b) return null;
  return a < b ? [a, b] : [b, a];
}

function isValidDiscordId(id) {
  return typeof id === 'string' && DISCORD_ID_RE.test(id.trim());
}

function isValidChatUserId(id) {
  return typeof id === 'string' && CHAT_USER_ID_RE.test(id.trim());
}

/**
 * Zamana göre sıralanabilir, ULID benzeri benzersiz mesaj kimliği üretir.
 */
function generateMessageId(nowTs = Date.now()) {
  const ts = Number.isFinite(nowTs) ? Math.floor(nowTs) : Date.now();
  if (ts === lastIdTs) {
    idSeqCounter = (idSeqCounter + 1) % 46656;
  } else {
    lastIdTs = ts;
    idSeqCounter = 0;
  }
  const tsPart = ts.toString(36).padStart(10, '0');
  const seqPart = idSeqCounter.toString(36).padStart(3, '0');
  const randPart = crypto.randomBytes(4).toString('hex');
  return `m_${tsPart}_${seqPart}_${randPart}`;
}

/**
 * Mesaj metnindeki kontrol ve sıfır genişlikli / yön değiştirme karakterlerini temizler.
 */
function sanitizeChatText(raw, maxLen = chatConfig.LIMITS.MAX_MESSAGE_LENGTH) {
  if (typeof raw !== 'string') return '';
  // Satır sonlarını normalize et
  let text = raw.replace(/\r\n?/g, '\n');
  // Kontrol karakterlerini (\n ve \t hariç) kaldır
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
  // Sıfır genişlikli ve bidi yön kandırma karakterlerini temizle
  text = text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, '');
  text = text.trim();
  if (text.length > maxLen) {
    text = text.slice(0, maxLen).trim();
  }
  return text;
}

/**
 * Europe/Istanbul zaman diliminde YYYY-MM-DD ve saat bilgisini döndürür.
 */
function getIstanbulDateParts(nowTs = Date.now()) {
  const dt = new Date(nowTs);
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(dt).map((p) => [p.type, p.value]));
    return {
      dateStr: `${parts.year}-${parts.month}-${parts.day}`,
      hour: Number(parts.hour) || 0,
      minute: Number(parts.minute) || 0,
      second: Number(parts.second) || 0,
    };
  } catch (_) {
    // UTC+3 sabit yedek (Europe/Istanbul 2016'dan beri kalıcı UTC+3)
    const tr = new Date(nowTs + 3 * 3600 * 1000);
    const y = tr.getUTCFullYear();
    const m = String(tr.getUTCMonth() + 1).padStart(2, '0');
    const d = String(tr.getUTCDate()).padStart(2, '0');
    return {
      dateStr: `${y}-${m}-${d}`,
      hour: tr.getUTCHours(),
      minute: tr.getUTCMinutes(),
      second: tr.getUTCSeconds(),
    };
  }
}

/**
 * Sıradaki 03:00 Europe/Istanbul zaman damgasını (ms) hesaplar.
 */
function getNextCleanupTimestamp(nowTs = Date.now()) {
  // Türkiye kalıcı UTC+3 (GMT+3) saat dilimindedir; 03:00 TR = 00:00 UTC.
  const trOffsetMs = 3 * 3600 * 1000;
  const trNow = new Date(nowTs + trOffsetMs);
  const nextTr = new Date(
    Date.UTC(trNow.getUTCFullYear(), trNow.getUTCMonth(), trNow.getUTCDate(), 3, 0, 0, 0)
  );
  let targetUtcMs = nextTr.getTime() - trOffsetMs;
  if (targetUtcMs <= nowTs + 1000) {
    targetUtcMs += DAY_MS;
  }
  return targetUtcMs;
}

function defaultProfile() {
  return {
    ringId: chatConfig.DEFAULT_RING_ID,
    ring: null,
    readReceipts: true,
    notify: {
      browser: false,
      sound: false,
      preview: false,
    },
    whoCanMessage: 'everyone',
    requireMessageRequest: false,
    blocked: [],
    consent: null,
    newConvDates: [],
    reportDates: [],
    dailyUpload: { day: '', bytes: 0 },
    updatedAt: 0,
  };
}

function normalizeProfile(raw) {
  const base = defaultProfile();
  if (!raw || typeof raw !== 'object') return base;

  const ringSelection = chatConfig.validateRingSelection({
    ringId: raw.ringId || chatConfig.DEFAULT_RING_ID,
    ring: raw.ring || null,
  });

  const notifyRaw = raw.notify && typeof raw.notify === 'object' ? raw.notify : {};
  const blocked = Array.isArray(raw.blocked)
    ? [...new Set(raw.blocked.map((x) => String(x || '').trim()).filter((id) => CHAT_USER_ID_RE.test(id)))]
    : [];

  let consent = null;
  if (raw.consent && typeof raw.consent === 'object' && typeof raw.consent.version === 'string') {
    consent = {
      version: raw.consent.version.slice(0, 32),
      at: Number(raw.consent.at) || Date.now(),
    };
  }

  return {
    ringId: ringSelection.valid ? ringSelection.ringId : chatConfig.DEFAULT_RING_ID,
    ring: ringSelection.valid ? ringSelection.ring : null,
    readReceipts: raw.readReceipts !== false,
    notify: {
      browser: Boolean(notifyRaw.browser),
      sound: Boolean(notifyRaw.sound),
      preview: Boolean(notifyRaw.preview),
    },
    whoCanMessage: raw.whoCanMessage === 'nobody' ? 'nobody' : 'everyone',
    requireMessageRequest: Boolean(raw.requireMessageRequest),
    blocked,
    consent,
    newConvDates: Array.isArray(raw.newConvDates)
      ? raw.newConvDates.filter((t) => Number.isFinite(Number(t))).map(Number).slice(-50)
      : [],
    reportDates: Array.isArray(raw.reportDates)
      ? raw.reportDates.filter((t) => Number.isFinite(Number(t))).map(Number).slice(-50)
      : [],
    dailyUpload:
      raw.dailyUpload && typeof raw.dailyUpload === 'object'
        ? {
            day: typeof raw.dailyUpload.day === 'string' ? raw.dailyUpload.day.slice(0, 16) : '',
            bytes: Math.max(0, Number(raw.dailyUpload.bytes) || 0),
          }
        : { day: '', bytes: 0 },
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

function defaultConvState(convId) {
  return {
    convId,
    lastRead: {},
    lastDelivered: {},
    createdAt: 0,
    createdBy: null,
    requestStatus: 'accepted', // 'accepted' | 'pending' | 'declined'
    requestFrom: null,
  };
}

function normalizeConvState(convId, raw) {
  const base = defaultConvState(convId);
  if (!raw || typeof raw !== 'object') return base;
  const lastRead = {};
  if (raw.lastRead && typeof raw.lastRead === 'object') {
    for (const [k, v] of Object.entries(raw.lastRead)) {
      if (CHAT_USER_ID_RE.test(k) && Number.isFinite(Number(v))) {
        lastRead[k] = Number(v);
      }
    }
  }
  const lastDelivered = {};
  if (raw.lastDelivered && typeof raw.lastDelivered === 'object') {
    for (const [k, v] of Object.entries(raw.lastDelivered)) {
      if (CHAT_USER_ID_RE.test(k) && Number.isFinite(Number(v))) {
        lastDelivered[k] = Number(v);
      }
    }
  }
  return {
    convId,
    lastRead,
    lastDelivered,
    createdAt: Number(raw.createdAt) || 0,
    createdBy: typeof raw.createdBy === 'string' && CHAT_USER_ID_RE.test(raw.createdBy) ? raw.createdBy : null,
    requestStatus:
      raw.requestStatus === 'pending' || raw.requestStatus === 'declined' ? raw.requestStatus : 'accepted',
    requestFrom:
      typeof raw.requestFrom === 'string' && CHAT_USER_ID_RE.test(raw.requestFrom) ? raw.requestFrom : null,
  };
}

/**
 * Atomik JSON dosya yazıcı (.bak yedek + tmp + rename).
 */
function writeJsonAtomic(filePath, dataObj, { keepBackup = true } = {}) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const payload = JSON.stringify(dataObj);
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, payload, { encoding: 'utf8', mode: 0o600 });

  if (keepBackup && fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, `${filePath}.bak`);
    } catch (_) {}
  }

  fs.renameSync(tmpPath, filePath);
}

/**
 * Bozuk JSON dosyası durumunda .bak yedeğinden toparlanan güvenli okuyucu.
 */
function readJsonWithBackupRecovery(filePath, fallbackValue) {
  const tryRead = (target) => {
    if (!fs.existsSync(target)) return { ok: false, missing: true };
    try {
      const raw = fs.readFileSync(target, 'utf8');
      if (!raw.trim()) return { ok: false, corrupt: true };
      return { ok: true, data: JSON.parse(raw) };
    } catch (_) {
      return { ok: false, corrupt: true };
    }
  };

  const primary = tryRead(filePath);
  if (primary.ok) return { data: primary.data, recovered: false };

  const bakPath = `${filePath}.bak`;
  const backup = tryRead(bakPath);
  if (backup.ok) {
    console.warn(`[CHAT DEPO] Bozuk JSON dosyası yedekten onarıldı: ${path.basename(filePath)}`);
    try {
      writeJsonAtomic(filePath, backup.data, { keepBackup: false });
    } catch (_) {}
    return { data: backup.data, recovered: true };
  }

  if (primary.corrupt) {
    console.warn(`[CHAT DEPO] Bozuk JSON dosyası varsayılan değerle sıfırlandı: ${path.basename(filePath)}`);
  }
  return { data: fallbackValue, recovered: Boolean(primary.corrupt) };
}

/**
 * Değiştirilebilir depolama arayüzüne sahip dosya tabanlı Sohbet Deposu.
 * İleride SQLite / PostgreSQL adaptörüne geçmek için yalnızca bu sınıfın arayüz metodları değiştirilebilir.
 */
class ChatStore {
  static resolveDefaultBaseDir(envObj = process.env) {
    const vol =
      envObj && typeof envObj.RAILWAY_VOLUME_MOUNT_PATH === 'string'
        ? envObj.RAILWAY_VOLUME_MOUNT_PATH.trim()
        : '';
    if (vol) {
      return { dir: path.join(vol, 'chat'), isRailwayVolume: true };
    }
    return { dir: path.join(process.cwd(), '.chat-data'), isRailwayVolume: false };
  }

  constructor(options = {}) {
    const envObj = options.env || process.env;
    const resolved = options.baseDir
      ? { dir: options.baseDir, isRailwayVolume: Boolean(options.isRailwayVolume) }
      : ChatStore.resolveDefaultBaseDir(envObj);

    this.baseDir = resolved.dir;
    this.isRailwayVolume = resolved.isRailwayVolume;
    this.conversationsDir = path.join(this.baseDir, 'conversations');
    this.filesDir = path.join(this.baseDir, 'files');
    this.tmpDir = path.join(this.baseDir, 'tmp');
    this.usersFile = path.join(this.baseDir, 'users.json');
    this.metaFile = path.join(this.baseDir, 'meta.json');
    this.filesMetaFile = path.join(this.filesDir, 'meta.json');

    this.users = new Map();
    this.meta = { lastCleanupAt: 0, lastCleanupDate: '' };
    this.fileMeta = new Map(); // attachmentId -> metadata (Parça 3)
    this.convStates = new Map(); // convId -> state
    this.convCache = new Map(); // convId -> { messages: [], clientIds: Map<string, string>, lastMessage, lastActivityAt }
    this.convIndex = new Map(); // convId -> { convId, participants: [a, b], lastMessage, lastActivityAt, msgCount }

    this._cleanupRunning = false;
    this._cleanupTimer = null;
    this._startupCatchupTimer = null;
    this._usersDirty = false;
    this._filesMetaDirty = false;

    if (!this.isRailwayVolume && !options.silentWarning && !options.baseDir) {
      console.warn(
        `⚠️ [CHAT DEPO] RAILWAY_VOLUME_MOUNT_PATH tanımlı değil; sohbet verileri yerel klasörde tutuluyor (${this.baseDir}).`
      );
    }

    this._ensureDirs();
    this._loadUsers();
    this._loadMeta();
    this._loadFilesMeta();
    this._indexExistingConversations();
  }

  _ensureDirs() {
    for (const d of [this.baseDir, this.conversationsDir, this.filesDir, this.tmpDir]) {
      try {
        if (!fs.existsSync(d)) {
          fs.mkdirSync(d, { recursive: true, mode: 0o700 });
        }
      } catch (_) {}
    }
  }

  _loadUsers() {
    const { data } = readJsonWithBackupRecovery(this.usersFile, {});
    this.users.clear();
    if (data && typeof data === 'object') {
      for (const [uid, raw] of Object.entries(data)) {
        if (CHAT_USER_ID_RE.test(uid)) {
          this.users.set(uid, normalizeProfile(raw));
        }
      }
    }
  }

  _saveUsersSync() {
    const out = {};
    for (const [uid, prof] of this.users.entries()) {
      out[uid] = prof;
    }
    writeJsonAtomic(this.usersFile, out, { keepBackup: true });
    this._usersDirty = false;
  }

  _loadMeta() {
    const { data } = readJsonWithBackupRecovery(this.metaFile, { lastCleanupAt: 0, lastCleanupDate: '' });
    this.meta = {
      lastCleanupAt: Number(data && data.lastCleanupAt) || 0,
      lastCleanupDate: typeof (data && data.lastCleanupDate) === 'string' ? data.lastCleanupDate : '',
    };
  }

  _saveMetaSync() {
    writeJsonAtomic(this.metaFile, this.meta, { keepBackup: true });
  }

  _loadFilesMeta() {
    const { data } = readJsonWithBackupRecovery(this.filesMetaFile, {});
    this.fileMeta.clear();
    if (data && typeof data === 'object') {
      for (const [fid, entry] of Object.entries(data)) {
        if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
          this.fileMeta.set(fid, entry);
        }
      }
    }
  }

  _saveFilesMetaSync() {
    const out = {};
    for (const [fid, entry] of this.fileMeta.entries()) {
      out[fid] = entry;
    }
    writeJsonAtomic(this.filesMetaFile, out, { keepBackup: true });
    this._filesMetaDirty = false;
  }

  _getConvJsonlPath(convId) {
    return path.join(this.conversationsDir, `${convId}.jsonl`);
  }

  _getConvStatePath(convId) {
    return path.join(this.conversationsDir, `${convId}.state.json`);
  }

  _loadConvState(convId) {
    if (this.convStates.has(convId)) {
      return this.convStates.get(convId);
    }
    const { data } = readJsonWithBackupRecovery(this._getConvStatePath(convId), null);
    const state = normalizeConvState(convId, data);
    this.convStates.set(convId, state);
    return state;
  }

  _saveConvStateSync(convId, state) {
    this.convStates.set(convId, state);
    writeJsonAtomic(this._getConvStatePath(convId), state, { keepBackup: true });
  }

  /**
   * JSONL dosyasındaki tüm satırları okur ve silme/moderatör kaldırma olaylarını (tombstone) uygular.
   */
  _readAllMessagesFromDisk(convId) {
    const filePath = this._getConvJsonlPath(convId);
    if (!fs.existsSync(filePath)) return [];
    let raw = '';
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
      return [];
    }
    const lines = raw.split('\n');
    const msgMap = new Map();
    const order = [];
    let corruptLines = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let ev;
      try {
        ev = JSON.parse(trimmed);
      } catch (_) {
        corruptLines += 1;
        continue;
      }
      if (!ev || typeof ev !== 'object') continue;

      if (ev.kind === 'delete' && typeof ev.targetId === 'string') {
        const target = msgMap.get(ev.targetId);
        if (target) {
          target.deleted = true;
          target.deletedAt = Number(ev.ts) || Date.now();
          target.deletedBy = ev.by || target.from;
          target.modRemoved = Boolean(ev.modRemoved);
          target.text = '';
          target.attachments = [];
        }
      } else if (ev.id && (ev.kind === 'msg' || !ev.kind)) {
        const msgObj = {
          id: String(ev.id),
          from: String(ev.from || ''),
          ts: Number(ev.ts) || 0,
          text: typeof ev.text === 'string' ? ev.text : '',
          attachments: Array.isArray(ev.attachments) ? ev.attachments : [],
          replyTo: ev.replyTo || null,
          clientId: typeof ev.clientId === 'string' ? ev.clientId : null,
          deleted: Boolean(ev.deleted),
          modRemoved: Boolean(ev.modRemoved),
          system: Boolean(ev.system),
          systemType: ev.systemType || null,
        };
        if (!msgMap.has(msgObj.id)) {
          order.push(msgObj.id);
        }
        msgMap.set(msgObj.id, msgObj);
      }
    }

    if (corruptLines > 0) {
      console.warn(`[CHAT DEPO] Bir sohbet dosyasında ${corruptLines} bozuk satır atlandı.`);
    }

    return order.map((id) => msgMap.get(id)).filter(Boolean);
  }

  _updateConvCacheAndIndex(convId, allMessages) {
    const participants = parseConvId(convId);
    if (!participants) return;
    const maxCache = chatConfig.LIMITS.MAX_MEMORY_MESSAGES_PER_CONV || 120;
    const tail = allMessages.slice(-maxCache);
    const clientIds = new Map();
    for (const m of tail) {
      if (m.clientId && m.from) {
        clientIds.set(`${m.from}:${m.clientId}`, m.id);
      }
    }
    const lastMessage = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null;
    const lastActivityAt = lastMessage ? lastMessage.ts : 0;

    this.convCache.set(convId, {
      messages: tail,
      hasFullHistory: allMessages.length <= maxCache,
      clientIds,
    });

    if (allMessages.length > 0) {
      this.convIndex.set(convId, {
        convId,
        participants,
        lastMessage: lastMessage ? { ...lastMessage } : null,
        lastActivityAt,
        msgCount: allMessages.length,
      });
    } else {
      this.convIndex.delete(convId);
    }
  }

  _indexExistingConversations() {
    this.convIndex.clear();
    this.convCache.clear();
    let entries = [];
    try {
      entries = fs.readdirSync(this.conversationsDir);
    } catch (_) {
      return;
    }

    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      const convId = name.slice(0, -6);
      if (!parseConvId(convId)) continue;
      const all = this._readAllMessagesFromDisk(convId);
      this._loadConvState(convId);
      this._updateConvCacheAndIndex(convId, all);
    }
  }

  // ==========================================================================
  // 1. KULLANICI PROFİLİ, ONAY VE ENGELLEME
  // ==========================================================================

  getProfile(userId) {
    const uid = String(userId || '').trim();
    if (!CHAT_USER_ID_RE.test(uid)) return defaultProfile();
    const existing = this.users.get(uid);
    if (!existing) return defaultProfile();
    return {
      ...existing,
      notify: { ...existing.notify },
      blocked: [...existing.blocked],
      ring: existing.ring ? { ...existing.ring, colors: [...existing.ring.colors] } : null,
      consent: existing.consent ? { ...existing.consent } : null,
      dailyUpload: existing.dailyUpload ? { ...existing.dailyUpload } : { day: '', bytes: 0 },
    };
  }

  setProfile(userId, patch = {}) {
    const uid = String(userId || '').trim();
    if (!CHAT_USER_ID_RE.test(uid)) {
      throw new Error('Geçersiz kullanıcı kimliği.');
    }
    const current = this.getProfile(uid);
    const merged = {
      ...current,
      updatedAt: Date.now(),
    };

    if (patch.ringId !== undefined || patch.ring !== undefined) {
      const ringCheck = chatConfig.validateRingSelection({
        ringId: patch.ringId,
        ring: patch.ring,
      });
      if (!ringCheck.valid) {
        const err = new Error(ringCheck.error || 'Geçersiz halka seçimi.');
        err.code = 'INVALID_RING';
        throw err;
      }
      merged.ringId = ringCheck.ringId;
      merged.ring = ringCheck.ring;
    }

    if (typeof patch.readReceipts === 'boolean') {
      merged.readReceipts = patch.readReceipts;
    }

    if (patch.notify && typeof patch.notify === 'object') {
      merged.notify = {
        browser:
          typeof patch.notify.browser === 'boolean' ? patch.notify.browser : merged.notify.browser,
        sound: typeof patch.notify.sound === 'boolean' ? patch.notify.sound : merged.notify.sound,
        preview:
          typeof patch.notify.preview === 'boolean' ? patch.notify.preview : merged.notify.preview,
      };
    }

    if (patch.whoCanMessage === 'everyone' || patch.whoCanMessage === 'nobody') {
      merged.whoCanMessage = patch.whoCanMessage;
    }

    if (typeof patch.requireMessageRequest === 'boolean') {
      merged.requireMessageRequest = patch.requireMessageRequest;
    }

    const normalized = normalizeProfile(merged);
    this.users.set(uid, normalized);
    this._saveUsersSync();
    return this.getProfile(uid);
  }

  getPublicRingForUser(userId) {
    const prof = this.getProfile(userId);
    return chatConfig.resolveEffectiveRing(prof);
  }

  hasValidConsent(userId, requiredVersion = chatConfig.POLICY_VERSION) {
    const prof = this.getProfile(userId);
    return Boolean(prof.consent && prof.consent.version === String(requiredVersion));
  }

  recordConsent(userId, version = chatConfig.POLICY_VERSION, nowTs = Date.now()) {
    const uid = String(userId || '').trim();
    if (!CHAT_USER_ID_RE.test(uid)) throw new Error('Geçersiz kullanıcı kimliği.');
    const prof = this.getProfile(uid);
    prof.consent = { version: String(version), at: Number(nowTs) || Date.now() };
    prof.updatedAt = Date.now();
    this.users.set(uid, normalizeProfile(prof));
    this._saveUsersSync();
    return this.getProfile(uid);
  }

  blockUser(userId, targetId) {
    const uid = String(userId || '').trim();
    const tid = String(targetId || '').trim();
    if (!CHAT_USER_ID_RE.test(uid) || !CHAT_USER_ID_RE.test(tid) || uid === tid) {
      throw new Error('Geçersiz engelleme hedefi.');
    }
    const prof = this.getProfile(uid);
    if (!prof.blocked.includes(tid)) {
      prof.blocked.push(tid);
      prof.updatedAt = Date.now();
      this.users.set(uid, normalizeProfile(prof));
      this._saveUsersSync();
    }
    return this.getProfile(uid);
  }

  unblockUser(userId, targetId) {
    const uid = String(userId || '').trim();
    const tid = String(targetId || '').trim();
    if (!CHAT_USER_ID_RE.test(uid) || !CHAT_USER_ID_RE.test(tid)) {
      throw new Error('Geçersiz kullanıcı kimliği.');
    }
    const prof = this.getProfile(uid);
    prof.blocked = prof.blocked.filter((id) => id !== tid);
    prof.updatedAt = Date.now();
    this.users.set(uid, normalizeProfile(prof));
    this._saveUsersSync();
    return this.getProfile(uid);
  }

  isBlockedBetween(idA, idB) {
    const a = String(idA || '').trim();
    const b = String(idB || '').trim();
    const profA = this.users.get(a);
    const profB = this.users.get(b);
    const blockedByA = Boolean(profA && Array.isArray(profA.blocked) && profA.blocked.includes(b));
    const blockedByB = Boolean(profB && Array.isArray(profB.blocked) && profB.blocked.includes(a));
    return { blockedByA, blockedByB, any: blockedByA || blockedByB };
  }

  canStartNewConversation(userId, nowTs = Date.now()) {
    const prof = this.getProfile(userId);
    const cutoff = nowTs - DAY_MS;
    const recent = (prof.newConvDates || []).filter((t) => t > cutoff);
    return recent.length < chatConfig.LIMITS.MAX_NEW_CONVERSATIONS_PER_DAY;
  }

  recordNewConversation(userId, nowTs = Date.now()) {
    const uid = String(userId || '').trim();
    const prof = this.getProfile(uid);
    const cutoff = nowTs - DAY_MS;
    prof.newConvDates = (prof.newConvDates || []).filter((t) => t > cutoff);
    prof.newConvDates.push(nowTs);
    this.users.set(uid, normalizeProfile(prof));
    this._saveUsersSync();
  }

  canSubmitReport(userId, nowTs = Date.now()) {
    const prof = this.getProfile(userId);
    const cutoff = nowTs - DAY_MS;
    const recent = (prof.reportDates || []).filter((t) => t > cutoff);
    return recent.length < chatConfig.LIMITS.MAX_REPORTS_PER_DAY;
  }

  recordReportSubmission(userId, nowTs = Date.now()) {
    const uid = String(userId || '').trim();
    const prof = this.getProfile(uid);
    const cutoff = nowTs - DAY_MS;
    prof.reportDates = (prof.reportDates || []).filter((t) => t > cutoff);
    prof.reportDates.push(nowTs);
    this.users.set(uid, normalizeProfile(prof));
    this._saveUsersSync();
  }

  // ==========================================================================
  // 2. MESAJLAR VE SOHBET DURUMU
  // ==========================================================================

  conversationExists(convId) {
    return this.convIndex.has(convId) || fs.existsSync(this._getConvJsonlPath(convId));
  }

  getConvState(convId) {
    return { ...this._loadConvState(convId) };
  }

  setConvRequestStatus(convId, status, requestFrom = null) {
    const state = this._loadConvState(convId);
    state.requestStatus = status;
    if (requestFrom !== undefined) {
      state.requestFrom = requestFrom;
    }
    this._saveConvStateSync(convId, state);
    return { ...state };
  }

  /**
   * Sohbete yeni bir mesaj satırı ekler (append-only JSONL).
   * Aynı kullanıcıdan aynı clientId geldiyse çift gönderimi önler.
   */
  appendMessage(
    convId,
    { from, text = '', attachments = [], replyTo = null, clientId = null, ts = Date.now(), system = false, systemType = null }
  ) {
    const participants = parseConvId(convId);
    if (!participants) {
      throw new Error('Geçersiz sohbet kimliği.');
    }
    const cleanFrom = String(from || '').trim();
    if (!system && !participants.includes(cleanFrom)) {
      throw new Error('Kullanıcı bu sohbetin katılımcısı değil.');
    }

    const cleanClientId =
      typeof clientId === 'string' && clientId.trim() ? clientId.trim().slice(0, 80) : null;

    // clientId çift gönderim kontrolü
    if (cleanClientId) {
      const cached = this.convCache.get(convId);
      const dedupKey = `${cleanFrom}:${cleanClientId}`;
      if (cached && cached.clientIds && cached.clientIds.has(dedupKey)) {
        const existingId = cached.clientIds.get(dedupKey);
        const existingMsg = cached.messages.find((m) => m.id === existingId);
        if (existingMsg) {
          return { duplicate: true, message: { ...existingMsg }, isNewConversation: false };
        }
      }
      // Önbellekte yoksa diskteki son satırlarda kontrol et
      if (fs.existsSync(this._getConvJsonlPath(convId))) {
        const all = this._readAllMessagesFromDisk(convId);
        const dup = all.find((m) => m.from === cleanFrom && m.clientId === cleanClientId);
        if (dup) {
          this._updateConvCacheAndIndex(convId, all);
          return { duplicate: true, message: { ...dup }, isNewConversation: false };
        }
      }
    }

    const cleanText = sanitizeChatText(text);
    const safeAttachments = Array.isArray(attachments) ? attachments : [];
    if (!cleanText && safeAttachments.length === 0) {
      const err = new Error('Boş mesaj gönderilemez.');
      err.code = 'EMPTY_MESSAGE';
      throw err;
    }

    const isNewConversation = !this.conversationExists(convId);
    const nowTs = Number.isFinite(Number(ts)) ? Number(ts) : Date.now();
    const message = {
      kind: 'msg',
      id: generateMessageId(nowTs),
      from: cleanFrom,
      ts: nowTs,
      text: cleanText,
      attachments: safeAttachments,
      replyTo: typeof replyTo === 'string' && replyTo.trim() ? replyTo.trim().slice(0, 64) : null,
      clientId: cleanClientId,
      deleted: false,
      modRemoved: false,
      system: Boolean(system),
      systemType: systemType || null,
    };

    this._ensureDirs();
    const filePath = this._getConvJsonlPath(convId);
    const lineBuf = Buffer.from(`${JSON.stringify(message)}\n`, 'utf8');
    fs.appendFileSync(filePath, lineBuf, { mode: 0o600 });

    // State dosyasını başlat/güncelle
    const state = this._loadConvState(convId);
    if (!state.createdAt) {
      state.createdAt = nowTs;
      state.createdBy = system ? null : cleanFrom;
    }
    if (!system) {
      // Gönderen kendi mesajını okumuş sayılır
      state.lastRead[cleanFrom] = Math.max(state.lastRead[cleanFrom] || 0, nowTs);
      state.lastDelivered[cleanFrom] = Math.max(state.lastDelivered[cleanFrom] || 0, nowTs);
    }
    this._saveConvStateSync(convId, state);

    // Bellek önbelleğini ve dizini güncelle
    let cached = this.convCache.get(convId);
    if (!cached) {
      cached = { messages: [], hasFullHistory: true, clientIds: new Map() };
      this.convCache.set(convId, cached);
    }
    const storedMsg = {
      id: message.id,
      from: message.from,
      ts: message.ts,
      text: message.text,
      attachments: message.attachments,
      replyTo: message.replyTo,
      clientId: message.clientId,
      deleted: false,
      modRemoved: false,
      system: message.system,
      systemType: message.systemType,
    };
    cached.messages.push(storedMsg);
    if (cleanClientId) {
      cached.clientIds.set(`${cleanFrom}:${cleanClientId}`, storedMsg.id);
    }
    const maxCache = chatConfig.LIMITS.MAX_MEMORY_MESSAGES_PER_CONV || 120;
    if (cached.messages.length > maxCache) {
      cached.messages.splice(0, cached.messages.length - maxCache);
      cached.hasFullHistory = false;
    }

    const prevIndex = this.convIndex.get(convId);
    this.convIndex.set(convId, {
      convId,
      participants,
      lastMessage: { ...storedMsg },
      lastActivityAt: nowTs,
      msgCount: (prevIndex ? prevIndex.msgCount : 0) + 1,
    });

    return { duplicate: false, message: storedMsg, isNewConversation };
  }

  /**
   * Mesajı tombstone olayıyla siler (kullanıcı veya moderatör kaldırması).
   */
  deleteMessage(convId, msgId, { by, modRemoved = false, nowTs = Date.now() } = {}) {
    if (!parseConvId(convId)) {
      return { ok: false, code: 'INVALID_CONV' };
    }
    const all = this._readAllMessagesFromDisk(convId);
    const target = all.find((m) => m.id === msgId);
    if (!target) {
      return { ok: false, code: 'NOT_FOUND' };
    }
    if (!modRemoved && target.from !== String(by || '')) {
      return { ok: false, code: 'FORBIDDEN' };
    }
    if (target.deleted && (!modRemoved || target.modRemoved)) {
      return { ok: true, alreadyDeleted: true, message: target, deletedAttachmentIds: [] };
    }

    const deletedAttachmentIds = Array.isArray(target.attachments)
      ? target.attachments.map((a) => (typeof a === 'string' ? a : a && a.id)).filter(Boolean)
      : [];

    const tombstone = {
      kind: 'delete',
      targetId: target.id,
      by: String(by || ''),
      ts: Number(nowTs) || Date.now(),
      modRemoved: Boolean(modRemoved),
    };
    fs.appendFileSync(this._getConvJsonlPath(convId), `${JSON.stringify(tombstone)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });

    target.deleted = true;
    target.modRemoved = Boolean(modRemoved);
    target.deletedAt = tombstone.ts;
    target.deletedBy = tombstone.by;
    target.text = '';
    target.attachments = [];

    this._updateConvCacheAndIndex(convId, all);

    return {
      ok: true,
      alreadyDeleted: false,
      message: { ...target },
      deletedAttachmentIds,
    };
  }

  /**
   * Mesaj geçmişini sayfalı (before / after / limit) döndürür.
   */
  getMessages(convId, { before = null, after = null, limit = chatConfig.LIMITS.DEFAULT_PAGE_LIMIT } = {}) {
    const safeLimit = Math.min(
      chatConfig.LIMITS.MAX_PAGE_LIMIT,
      Math.max(1, Number.parseInt(String(limit || chatConfig.LIMITS.DEFAULT_PAGE_LIMIT), 10) || 40)
    );
    const state = this._loadConvState(convId);

    let all;
    const cached = this.convCache.get(convId);
    if (cached && cached.hasFullHistory) {
      all = cached.messages;
    } else {
      all = this._readAllMessagesFromDisk(convId);
      if (all.length > 0) {
        this._updateConvCacheAndIndex(convId, all);
      }
    }

    if (after) {
      const afterNum = Number(after);
      let idx = -1;
      if (typeof after === 'string' && after.startsWith('m_')) {
        idx = all.findIndex((m) => m.id === after);
      }
      let filtered;
      if (idx >= 0) {
        filtered = all.slice(idx + 1);
      } else if (Number.isFinite(afterNum) && afterNum > 0) {
        filtered = all.filter((m) => m.ts > afterNum);
      } else {
        filtered = [];
      }
      const slice = filtered.slice(0, safeLimit);
      return {
        messages: slice.map((m) => ({ ...m })),
        hasMore: filtered.length > slice.length,
        state: { ...state },
      };
    }

    let endIdx = all.length;
    if (before) {
      if (typeof before === 'string' && before.startsWith('m_')) {
        const idx = all.findIndex((m) => m.id === before);
        if (idx >= 0) {
          endIdx = idx;
        }
      } else {
        const beforeNum = Number(before);
        if (Number.isFinite(beforeNum) && beforeNum > 0) {
          endIdx = all.findIndex((m) => m.ts >= beforeNum);
          if (endIdx < 0) endIdx = all.length;
        }
      }
    }

    const startIdx = Math.max(0, endIdx - safeLimit);
    const slice = all.slice(startIdx, endIdx);
    return {
      messages: slice.map((m) => ({ ...m })),
      hasMore: startIdx > 0,
      state: { ...state },
    };
  }

  getMessageById(convId, msgId) {
    const all = this._readAllMessagesFromDisk(convId);
    const found = all.find((m) => m.id === msgId);
    return found ? { ...found } : null;
  }

  /**
   * Parça 4 (Raporlama / Otomatik İşaret) için belirli bir mesaj etrafındaki anlık görüntü penceresini çıkarır.
   */
  getContextWindow(convId, targetMsgId = null, { totalCount = 30, radius = null } = {}) {
    const all = this._readAllMessagesFromDisk(convId);
    if (all.length === 0) return [];
    if (!targetMsgId) {
      return all.slice(-Math.max(1, totalCount)).map((m) => ({ ...m }));
    }
    const idx = all.findIndex((m) => m.id === targetMsgId);
    if (idx < 0) {
      return all.slice(-Math.max(1, totalCount)).map((m) => ({ ...m }));
    }
    if (Number.isFinite(radius) && radius >= 0) {
      const start = Math.max(0, idx - radius);
      const end = Math.min(all.length, idx + radius + 1);
      return all.slice(start, end).map((m) => ({ ...m }));
    }
    const halfBefore = Math.floor(totalCount * 0.7);
    let start = Math.max(0, idx - halfBefore);
    let end = Math.min(all.length, start + totalCount);
    if (end - start < totalCount) {
      start = Math.max(0, end - totalCount);
    }
    return all.slice(start, end).map((m) => ({ ...m }));
  }

  markDelivered(convId, userId, upToTs = Date.now()) {
    const participants = parseConvId(convId);
    const uid = String(userId || '').trim();
    if (!participants || !participants.includes(uid)) return null;
    const state = this._loadConvState(convId);
    const ts = Number(upToTs) || Date.now();
    if (ts > (state.lastDelivered[uid] || 0)) {
      state.lastDelivered[uid] = ts;
      this._saveConvStateSync(convId, state);
    }
    return { ...state };
  }

  markRead(convId, userId, upToTs = Date.now()) {
    const participants = parseConvId(convId);
    const uid = String(userId || '').trim();
    if (!participants || !participants.includes(uid)) return null;
    const state = this._loadConvState(convId);
    const ts = Number(upToTs) || Date.now();
    let changed = false;
    if (ts > (state.lastRead[uid] || 0)) {
      state.lastRead[uid] = ts;
      changed = true;
    }
    if (ts > (state.lastDelivered[uid] || 0)) {
      state.lastDelivered[uid] = ts;
      changed = true;
    }
    if (changed) {
      this._saveConvStateSync(convId, state);
    }
    return { ...state };
  }

  /**
   * Bir sohbette kullanıcının okunmamış mesaj sayısını hesaplar.
   */
  getUnreadCountForConv(convId, userId) {
    const uid = String(userId || '').trim();
    const state = this._loadConvState(convId);
    const lastReadTs = state.lastRead[uid] || 0;
    const cached = this.convCache.get(convId);
    let msgs;
    if (cached && cached.messages.length > 0 && (cached.hasFullHistory || cached.messages[0].ts <= lastReadTs)) {
      msgs = cached.messages;
    } else {
      msgs = this._readAllMessagesFromDisk(convId);
    }
    let count = 0;
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const m = msgs[i];
      if (m.ts <= lastReadTs) break;
      if (!m.deleted && m.from !== uid) {
        count += 1;
      }
    }
    return count;
  }

  listConversations(userId) {
    const uid = String(userId || '').trim();
    if (!CHAT_USER_ID_RE.test(uid)) return [];
    const results = [];

    for (const entry of this.convIndex.values()) {
      if (!entry.participants.includes(uid)) continue;
      const otherId = entry.participants[0] === uid ? entry.participants[1] : entry.participants[0];
      const state = this._loadConvState(entry.convId);
      const unreadCount = this.getUnreadCountForConv(entry.convId, uid);
      results.push({
        convId: entry.convId,
        otherId,
        lastMessage: entry.lastMessage ? { ...entry.lastMessage } : null,
        lastActivityAt: entry.lastActivityAt || 0,
        unreadCount,
        state: { ...state },
      });
    }

    results.sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
    return results;
  }

  getTotalUnreadCount(userId) {
    const uid = String(userId || '').trim();
    if (!CHAT_USER_ID_RE.test(uid)) return 0;
    const myProf = this.getProfile(uid);
    const blockedSet = new Set(myProf.blocked || []);
    let total = 0;
    for (const entry of this.convIndex.values()) {
      if (!entry.participants.includes(uid)) continue;
      const otherId = entry.participants[0] === uid ? entry.participants[1] : entry.participants[0];
      if (blockedSet.has(otherId)) continue;
      const state = this._loadConvState(entry.convId);
      if (state.requestStatus === 'declined') continue;
      total += this.getUnreadCountForConv(entry.convId, uid);
    }
    return total;
  }

  // ==========================================================================
  // 3. DOSYA METADATA VE KOTA KANCALARI (Parça 3 tarafından genişletilir)
  // ==========================================================================

  registerFileMeta(metaObj) {
    if (!metaObj || !metaObj.id) return null;
    this.fileMeta.set(metaObj.id, { ...metaObj });
    this._saveFilesMetaSync();
    return this.fileMeta.get(metaObj.id);
  }

  getFileMeta(fileId) {
    return this.fileMeta.get(String(fileId || '')) || null;
  }

  markFilePreserved(fileId, caseId) {
    const meta = this.fileMeta.get(String(fileId || ''));
    if (!meta) return false;
    const list = Array.isArray(meta.preservedByCases) ? meta.preservedByCases : [];
    if (caseId && !list.includes(caseId)) list.push(caseId);
    meta.preserved = true;
    meta.preservedByCases = list;
    this._saveFilesMetaSync();
    return true;
  }

  unpreserveFileForCase(fileId, caseId) {
    const meta = this.fileMeta.get(String(fileId || ''));
    if (!meta) return false;
    const list = Array.isArray(meta.preservedByCases)
      ? meta.preservedByCases.filter((c) => c !== caseId)
      : [];
    meta.preservedByCases = list;
    meta.preserved = list.length > 0;
    this._saveFilesMetaSync();
    return true;
  }

  isFilePreserved(fileId) {
    const meta = this.fileMeta.get(String(fileId || ''));
    return Boolean(meta && meta.preserved);
  }

  deleteFileIfUnpreserved(fileId) {
    const meta = this.fileMeta.get(String(fileId || ''));
    if (!meta) return false;
    if (meta.preserved) return false;
    try {
      const diskPath = path.join(this.filesDir, meta.storedName || `${meta.id}.${meta.ext || 'bin'}`);
      if (fs.existsSync(diskPath)) {
        fs.unlinkSync(diskPath);
      }
    } catch (_) {}
    this.fileMeta.delete(meta.id);
    this._saveFilesMetaSync();
    return true;
  }

  getDailyUploadBytes(userId, nowTs = Date.now()) {
    const prof = this.getProfile(userId);
    const today = getIstanbulDateParts(nowTs).dateStr;
    if (!prof.dailyUpload || prof.dailyUpload.day !== today) return 0;
    return Number(prof.dailyUpload.bytes) || 0;
  }

  addDailyUploadBytes(userId, bytes, nowTs = Date.now()) {
    const uid = String(userId || '').trim();
    const prof = this.getProfile(uid);
    const today = getIstanbulDateParts(nowTs).dateStr;
    const current = prof.dailyUpload && prof.dailyUpload.day === today ? Number(prof.dailyUpload.bytes) || 0 : 0;
    prof.dailyUpload = { day: today, bytes: current + Math.max(0, Number(bytes) || 0) };
    this.users.set(uid, normalizeProfile(prof));
    this._saveUsersSync();
    return prof.dailyUpload.bytes;
  }

  getAttachmentsForCase(attachmentIds = []) {
    return (Array.isArray(attachmentIds) ? attachmentIds : [])
      .map((id) => this.getFileMeta(id))
      .filter(Boolean);
  }

  // ==========================================================================
  // 4. 30 GÜNLÜK SAKLAMA TEMİZLİĞİ VE ZAMANLAYICI
  // ==========================================================================

  /**
   * 30 günden eski mesajları siler, boş sohbetleri kaldırır, korunmayan ekleri temizler.
   * Atomik yeniden yazım ve tek kilit kullanır; konsola yalnızca toplam sayıları yazar.
   */
  runRetentionCleanup({
    retentionDays = chatConfig.RETENTION_DAYS,
    nowTs = Date.now(),
    isAttachmentPreserved = null,
    silent = false,
  } = {}) {
    if (this._cleanupRunning) {
      return { skipped: true, reason: 'locked' };
    }
    this._cleanupRunning = true;
    const stats = {
      expiredMessages: 0,
      removedConversations: 0,
      removedFiles: 0,
      removedOrphanFiles: 0,
      removedTmpFiles: 0,
      errors: 0,
    };

    try {
      const cutoffTs = nowTs - Math.max(1, Number(retentionDays) || 30) * DAY_MS;
      const checkPreserved = (attId) => {
        if (typeof isAttachmentPreserved === 'function' && isAttachmentPreserved(attId)) return true;
        return this.isFilePreserved(attId);
      };

      const referencedFileIds = new Set();
      let entries = [];
      try {
        entries = fs.readdirSync(this.conversationsDir);
      } catch (_) {
        entries = [];
      }

      for (const name of entries) {
        if (!name.endsWith('.jsonl')) continue;
        const convId = name.slice(0, -6);
        if (!parseConvId(convId)) continue;
        const jsonlPath = this._getConvJsonlPath(convId);

        try {
          const all = this._readAllMessagesFromDisk(convId);
          const kept = [];
          let expiredHere = 0;

          for (const msg of all) {
            if (msg.ts < cutoffTs) {
              expiredHere += 1;
              if (Array.isArray(msg.attachments)) {
                for (const att of msg.attachments) {
                  const attId = typeof att === 'string' ? att : att && att.id;
                  if (attId && !checkPreserved(attId)) {
                    if (this.deleteFileIfUnpreserved(attId)) {
                      stats.removedFiles += 1;
                    }
                  }
                }
              }
            } else {
              kept.push(msg);
              if (!msg.deleted && Array.isArray(msg.attachments)) {
                for (const att of msg.attachments) {
                  const attId = typeof att === 'string' ? att : att && att.id;
                  if (attId) referencedFileIds.add(attId);
                }
              }
            }
          }

          if (expiredHere > 0 || kept.length === 0) {
            stats.expiredMessages += expiredHere;
            if (kept.length === 0) {
              // Boş sohbeti kaldır
              for (const p of [
                jsonlPath,
                this._getConvStatePath(convId),
                `${this._getConvStatePath(convId)}.bak`,
              ]) {
                try {
                  if (fs.existsSync(p)) fs.unlinkSync(p);
                } catch (_) {}
              }
              this.convCache.delete(convId);
              this.convIndex.delete(convId);
              this.convStates.delete(convId);
              stats.removedConversations += 1;
            } else {
              // Sıkıştırılmış JSONL'yi atomik olarak yeniden yaz
              const tmpPath = `${jsonlPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
              const content =
                kept
                  .map((m) =>
                    JSON.stringify({
                      kind: 'msg',
                      id: m.id,
                      from: m.from,
                      ts: m.ts,
                      text: m.text,
                      attachments: m.attachments,
                      replyTo: m.replyTo,
                      clientId: m.clientId,
                      deleted: Boolean(m.deleted),
                      modRemoved: Boolean(m.modRemoved),
                      system: Boolean(m.system),
                      systemType: m.systemType || null,
                    })
                  )
                  .join('\n') + '\n';
              fs.writeFileSync(tmpPath, content, { encoding: 'utf8', mode: 0o600 });
              fs.renameSync(tmpPath, jsonlPath);
              this._updateConvCacheAndIndex(convId, kept);
            }
          }
        } catch (_) {
          stats.errors += 1;
        }
      }

      // Parça 3: Sahipsiz veya süresi dolmuş (mesaja bağlanmamış) dosyaları temizle
      stats.removedOrphanFiles += this.cleanupOrphanFiles({ nowTs, referencedFileIds, checkPreserved });

      // Parça 3: 1 saatten eski yarım tmp dosyalarını temizle
      stats.removedTmpFiles += this.cleanupTmpFiles({ nowTs });

      const istanbul = getIstanbulDateParts(nowTs);
      this.meta.lastCleanupAt = nowTs;
      this.meta.lastCleanupDate = istanbul.dateStr;
      this._saveMetaSync();

      if (!silent) {
        console.log(
          `🧹 [CHAT TEMİZLİK] Süresi dolan mesaj: ${stats.expiredMessages} | Boş sohbet: ${stats.removedConversations} | Silinen ek: ${stats.removedFiles} | Sahipsiz dosya: ${stats.removedOrphanFiles} | Geçici dosya: ${stats.removedTmpFiles}`
        );
      }

      return { skipped: false, ...stats };
    } finally {
      this._cleanupRunning = false;
    }
  }

  cleanupOrphanFiles({ nowTs = Date.now(), referencedFileIds = null, checkPreserved = null } = {}) {
    let removed = 0;
    const isPres = checkPreserved || ((id) => this.isFilePreserved(id));
    const graceMs = 2 * 60 * 60 * 1000; // Yüklenmiş ama henüz mesaja eklenmemiş taze dosyaya 2 saat tolerans

    // 1) Meta'da olup diskten veya mesajlardan kopmuş dosyalar
    for (const [fid, meta] of [...this.fileMeta.entries()]) {
      if (isPres(fid)) continue;
      const age = nowTs - (Number(meta.createdAt) || 0);
      const isAttached = Boolean(meta.msgId) && (!referencedFileIds || referencedFileIds.has(fid));
      const isExpiredUnattached = !meta.msgId && age > graceMs;
      const isUnreferencedAttached = Boolean(meta.msgId) && referencedFileIds && !referencedFileIds.has(fid);
      if (isExpiredUnattached || isUnreferencedAttached) {
        if (this.deleteFileIfUnpreserved(fid)) {
          removed += 1;
        }
      }
    }

    // 2) Diskte olup meta'sı hiç olmayan sahipsiz dosyalar
    try {
      const diskFiles = fs.readdirSync(this.filesDir);
      const knownStored = new Set();
      for (const meta of this.fileMeta.values()) {
        if (meta.storedName) knownStored.add(meta.storedName);
      }
      for (const fname of diskFiles) {
        if (fname === 'meta.json' || fname === 'meta.json.bak' || fname.endsWith('.tmp')) continue;
        if (knownStored.has(fname)) continue;
        const full = path.join(this.filesDir, fname);
        try {
          const st = fs.statSync(full);
          if (st.isFile() && nowTs - st.mtimeMs > 10 * 1000) {
            fs.unlinkSync(full);
            removed += 1;
          }
        } catch (_) {}
      }
    } catch (_) {}

    return removed;
  }

  cleanupTmpFiles({ nowTs = Date.now(), ttlMs = chatConfig.FILES.TMP_TTL_MS } = {}) {
    let removed = 0;
    try {
      const items = fs.readdirSync(this.tmpDir);
      for (const name of items) {
        const full = path.join(this.tmpDir, name);
        try {
          const st = fs.statSync(full);
          if (st.isFile() && nowTs - st.mtimeMs >= ttlMs) {
            fs.unlinkSync(full);
            removed += 1;
          }
        } catch (_) {}
      }
    } catch (_) {}
    return removed;
  }

  startCleanupScheduler({ onAfterCleanup = null } = {}) {
    this.stopCleanupScheduler();

    // Açılışta bugünkü 03:00 (Europe/Istanbul) temizliği kaçırıldıysa telafi et
    const now = Date.now();
    const parts = getIstanbulDateParts(now);
    const shouldCatchUp =
      parts.hour >= 3 && this.meta.lastCleanupDate !== parts.dateStr;

    if (shouldCatchUp) {
      this._startupCatchupTimer = setTimeout(() => {
        try {
          const res = this.runRetentionCleanup();
          if (typeof onAfterCleanup === 'function') onAfterCleanup(res);
        } catch (_) {}
      }, 2000);
      if (this._startupCatchupTimer.unref) this._startupCatchupTimer.unref();
    }

    const scheduleNext = () => {
      const nextTs = getNextCleanupTimestamp(Date.now());
      const delayMs = Math.max(5000, Math.min(nextTs - Date.now(), 24 * 3600 * 1000));
      this._cleanupTimer = setTimeout(() => {
        try {
          const res = this.runRetentionCleanup();
          if (typeof onAfterCleanup === 'function') onAfterCleanup(res);
        } catch (_) {}
        scheduleNext();
      }, delayMs);
      if (this._cleanupTimer.unref) this._cleanupTimer.unref();
    };

    scheduleNext();
  }

  stopCleanupScheduler() {
    if (this._cleanupTimer) {
      clearTimeout(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    if (this._startupCatchupTimer) {
      clearTimeout(this._startupCatchupTimer);
      this._startupCatchupTimer = null;
    }
  }

  getRetentionInfo(nowTs = Date.now()) {
    return {
      retentionDays: chatConfig.RETENTION_DAYS,
      lastCleanupAt: this.meta.lastCleanupAt || null,
      nextCleanupAt: getNextCleanupTimestamp(nowTs),
    };
  }

  /**
   * Hesap silme (KVKK / Hesabımı Sil) işlemi için kullanıcının sohbet profilini,
   * diğer kullanıcıların engelleme listelerindeki izini, gönderdiği tüm mesajları ve
   * moderasyon vakalarınca korunmayan dosyalarını kalıcı olarak temizler.
   * Moderasyon vakalarındaki anlık görüntüler ve korunan ekler vaka saklama süresi
   * boyunca dokunulmadan kalır.
   */
  purgeUserData(userId) {
    const uid = String(userId || '').trim();
    const summary = {
      removedProfile: false,
      removedFromBlocklists: 0,
      removedMessages: 0,
      removedConversations: 0,
      removedFiles: 0,
    };
    if (!CHAT_USER_ID_RE.test(uid)) return summary;

    // 1) Kendi sohbet profilini ve diğer kullanıcıların engelleme listelerindeki izini sil
    let usersChanged = false;
    if (this.users.delete(uid)) {
      summary.removedProfile = true;
      usersChanged = true;
    }
    for (const [otherUid, prof] of this.users.entries()) {
      if (prof && Array.isArray(prof.blocked) && prof.blocked.includes(uid)) {
        prof.blocked = prof.blocked.filter((id) => id !== uid);
        this.users.set(otherUid, prof);
        summary.removedFromBlocklists += 1;
        usersChanged = true;
      }
    }
    if (usersChanged) {
      this._saveUsersSync();
    }

    // 2) Katılımcı olduğu tüm sohbetlerde kendi mesajlarını ve korunmayan eklerini sil
    let entries = [];
    try {
      entries = fs.readdirSync(this.conversationsDir);
    } catch (_) {
      entries = [];
    }

    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      const convId = name.slice(0, -6);
      const participants = parseConvId(convId);
      if (!participants || !participants.includes(uid)) continue;

      const jsonlPath = this._getConvJsonlPath(convId);
      const all = this._readAllMessagesFromDisk(convId);
      const kept = [];

      for (const msg of all) {
        if (msg.from === uid) {
          summary.removedMessages += 1;
          if (Array.isArray(msg.attachments)) {
            for (const att of msg.attachments) {
              const attId = typeof att === 'string' ? att : att && att.id;
              if (attId && this.deleteFileIfUnpreserved(attId)) {
                summary.removedFiles += 1;
              }
            }
          }
        } else {
          kept.push(msg);
        }
      }

      if (kept.length === 0) {
        for (const p of [
          jsonlPath,
          this._getConvStatePath(convId),
          `${this._getConvStatePath(convId)}.bak`,
        ]) {
          try {
            if (fs.existsSync(p)) fs.unlinkSync(p);
          } catch (_) {}
        }
        this.convCache.delete(convId);
        this.convIndex.delete(convId);
        this.convStates.delete(convId);
        summary.removedConversations += 1;
      } else {
        const tmpPath = `${jsonlPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        const content =
          kept
            .map((m) =>
              JSON.stringify({
                kind: 'msg',
                id: m.id,
                from: m.from,
                ts: m.ts,
                text: m.text,
                attachments: m.attachments,
                replyTo: m.replyTo,
                clientId: m.clientId,
                deleted: Boolean(m.deleted),
                modRemoved: Boolean(m.modRemoved),
                system: Boolean(m.system),
                systemType: m.systemType || null,
              })
            )
            .join('\n') + '\n';
        fs.writeFileSync(tmpPath, content, { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(tmpPath, jsonlPath);

        const state = this._loadConvState(convId);
        delete state.lastRead[uid];
        delete state.lastDelivered[uid];
        if (state.createdBy === uid) state.createdBy = null;
        if (state.requestFrom === uid) state.requestFrom = null;
        this._saveConvStateSync(convId, state);
        this._updateConvCacheAndIndex(convId, kept);
      }
    }

    // 3) Kullanıcının yüklediği ancak henüz mesaja bağlanmamış korunmayan dosyaları sil
    for (const [fid, meta] of [...this.fileMeta.entries()]) {
      if (meta && meta.uploaderId === uid && !meta.preserved) {
        if (this.deleteFileIfUnpreserved(fid)) {
          summary.removedFiles += 1;
        }
      }
    }

    return summary;
  }

  flush() {
    this.stopCleanupScheduler();
    try {
      this._saveUsersSync();
    } catch (_) {}
    try {
      this._saveMetaSync();
    } catch (_) {}
    try {
      this._saveFilesMetaSync();
    } catch (_) {}
  }
}

let defaultStoreInstance = null;

function getChatStore(options = null) {
  if (options && options.baseDir) {
    return new ChatStore(options);
  }
  if (!defaultStoreInstance) {
    defaultStoreInstance = new ChatStore();
  }
  return defaultStoreInstance;
}

function setDefaultChatStore(store) {
  if (defaultStoreInstance && defaultStoreInstance !== store) {
    defaultStoreInstance.stopCleanupScheduler();
  }
  defaultStoreInstance = store;
}

module.exports = {
  ChatStore,
  getChatStore,
  setDefaultChatStore,
  makeConvId,
  parseConvId,
  isValidDiscordId,
  isValidChatUserId,
  generateMessageId,
  sanitizeChatText,
  getIstanbulDateParts,
  getNextCleanupTimestamp,
  writeJsonAtomic,
  readJsonWithBackupRecovery,
};
