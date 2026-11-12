const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const warriorsConfig = require('../config/warriors.config');

const {
  SEED_WARRIORS,
  ROBLOX_USERNAME_REGEX,
  CUSTOM_IMAGE_FILENAME_REGEX,
  LIMITS,
} = warriorsConfig;

class WarriorsStore {
  constructor(options = {}) {
    this._customDir = options.dirPath || null;
    this._cachedData = null;
  }

  /**
   * Railway Volume bağlıysa RAILWAY_VOLUME_MOUNT_PATH altındaki 'data' klasörünü,
   * tanımlı değilse çalışma dizini altındaki 'data' klasörünü döndürür.
   */
  resolveDataDir(envObj = process.env) {
    if (this._customDir) return this._customDir;
    const overrideDir =
      envObj && typeof envObj.WARRIORS_DATA_DIR === 'string'
        ? envObj.WARRIORS_DATA_DIR.trim()
        : '';
    if (overrideDir) return overrideDir;

    const volumeMountPath =
      envObj && typeof envObj.RAILWAY_VOLUME_MOUNT_PATH === 'string'
        ? envObj.RAILWAY_VOLUME_MOUNT_PATH.trim()
        : '';
    if (volumeMountPath) {
      return path.join(volumeMountPath, 'data');
    }
    return path.join(process.cwd(), 'data');
  }

  getPaths() {
    const dataDir = this.resolveDataDir();
    return {
      dataDir,
      jsonPath: path.join(dataDir, 'warriors.json'),
      bakPath: path.join(dataDir, 'warriors.json.bak'),
      imagesDir: path.join(dataDir, 'warriors'),
      avatarCachePath: path.join(dataDir, 'roblox-avatars-cache.json'),
    };
  }

  _ensureDirs() {
    const { dataDir, imagesDir } = this.getPaths();
    try {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
      return true;
    } catch (err) {
      console.error('[WARRIORS STORE] Klasör oluşturma hatası:', err.message);
      return false;
    }
  }

  _cloneSeedPayload() {
    const nowIso = new Date().toISOString();
    return {
      version: 1,
      updatedAt: nowIso,
      warriors: SEED_WARRIORS.map((item, idx) => ({
        id: item.id,
        robloxUsername: item.robloxUsername,
        kills: item.kills,
        order: idx + 1,
        imageMode: item.imageMode === 'custom' ? 'custom' : 'roblox',
        customImageFile: item.customImageFile || null,
        robloxUserId: Number.isInteger(item.robloxUserId) && item.robloxUserId > 0 ? item.robloxUserId : null,
      })),
      history: [],
    };
  }

  /**
   * Okunan JSON payload'ının şemasını doğrular. Bozuksa null döner.
   */
  _sanitizeParsedStore(parsed) {
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.warriors)) {
      return null;
    }
    if (
      parsed.warriors.length < LIMITS.minWarriors ||
      parsed.warriors.length > LIMITS.maxWarriors
    ) {
      return null;
    }

    const cleanWarriors = [];
    const seenNames = new Set();

    for (let i = 0; i < parsed.warriors.length; i++) {
      const row = parsed.warriors[i];
      if (!row || typeof row !== 'object') return null;

      const nameCheck = this.validateRobloxUsername(row.robloxUsername);
      if (!nameCheck.valid) return null;

      const lower = nameCheck.value.toLowerCase();
      if (seenNames.has(lower)) return null;
      seenNames.add(lower);

      const killsCheck = this.parseKillCount(row.kills);
      if (!killsCheck.valid) return null;

      const rawId = typeof row.id === 'string' && /^[A-Za-z0-9_-]{2,24}$/.test(row.id)
        ? row.id
        : `w_${crypto.randomBytes(3).toString('hex')}`;

      const imageMode = row.imageMode === 'custom' ? 'custom' : 'roblox';
      const customImageFile =
        imageMode === 'custom' &&
        typeof row.customImageFile === 'string' &&
        CUSTOM_IMAGE_FILENAME_REGEX.test(row.customImageFile)
          ? row.customImageFile
          : null;

      const robloxUserId =
        Number.isInteger(row.robloxUserId) && row.robloxUserId > 0
          ? row.robloxUserId
          : null;

      cleanWarriors.push({
        id: rawId,
        robloxUsername: nameCheck.value,
        kills: killsCheck.value,
        order: i + 1,
        imageMode: customImageFile ? 'custom' : 'roblox',
        customImageFile,
        robloxUserId,
      });
    }

    const version = Number.isInteger(parsed.version) && parsed.version >= 1 ? parsed.version : 1;
    const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString();
    const history = Array.isArray(parsed.history)
      ? parsed.history.slice(-LIMITS.maxHistoryEntries)
      : [];

    return {
      version,
      updatedAt,
      warriors: cleanWarriors,
      history,
    };
  }

  _tryReadStoreFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) return { exists: false, data: null };
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const clean = this._sanitizeParsedStore(parsed);
      return { exists: true, data: clean };
    } catch (_) {
      return { exists: true, data: null };
    }
  }

  /**
   * Atomik dosya yazımı: geçici dosyaya yaz, ardından hedef dosya adına rename et.
   */
  _writeFileAtomic(targetPath, contentBufferOrString) {
    this._ensureDirs();
    const dir = path.dirname(targetPath);
    const tmpPath = path.join(
      dir,
      `.tmp_${path.basename(targetPath)}_${process.pid}_${crypto.randomBytes(6).toString('hex')}`
    );
    try {
      fs.writeFileSync(tmpPath, contentBufferOrString, { encoding: typeof contentBufferOrString === 'string' ? 'utf8' : undefined });
      fs.renameSync(tmpPath, targetPath);
      return true;
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch (_) {}
      console.error(`[WARRIORS STORE] Atomik yazma hatası (${path.basename(targetPath)}):`, err.message);
      return false;
    }
  }

  /**
   * Kalıcı depoyu okur (bellek önbellekli). Dosya yoksa seed'ten oluşturur; bozuksa yedekten veya seed'ten kurtarır.
   */
  getStore() {
    if (this._cachedData) {
      return this._clonePayload(this._cachedData);
    }

    const { jsonPath, bakPath } = this.getPaths();
    const mainRead = this._tryReadStoreFile(jsonPath);

    if (mainRead.data) {
      this._cachedData = mainRead.data;
      return this._clonePayload(this._cachedData);
    }

    // Ana dosya yok veya bozuk -> yedeği (.bak) dene
    const bakRead = this._tryReadStoreFile(bakPath);
    if (bakRead.data) {
      console.warn('[WARRIORS STORE] Ana dosya eksik/bozuk; warriors.json.bak yedeğinden kurtarıldı.');
      this._writeFileAtomic(jsonPath, JSON.stringify(bakRead.data, null, 2));
      this._cachedData = bakRead.data;
      return this._clonePayload(this._cachedData);
    }

    // Yedek de yok/bozuk -> seed listeden oluştur
    if (mainRead.exists) {
      console.warn('[WARRIORS STORE] Hem ana dosya hem yedek bozuk; seed liste ile sıfırlandı.');
    }
    const seed = this._cloneSeedPayload();
    this._writeFileAtomic(jsonPath, JSON.stringify(seed, null, 2));
    this._cachedData = seed;
    return this._clonePayload(this._cachedData);
  }

  _clonePayload(payload) {
    return {
      version: payload.version,
      updatedAt: payload.updatedAt,
      warriors: payload.warriors.map((w) => ({ ...w })),
      history: (payload.history || []).map((h) => ({ ...h })),
    };
  }

  invalidateCache() {
    this._cachedData = null;
  }

  getWarriors() {
    return this.getStore().warriors;
  }

  /**
   * Roblox kullanıcı adı doğrulaması:
   * 3-20 karakter, sadece harf/rakam/alt çizgi, başta/sonda _ yok, en fazla 1 alt çizgi.
   */
  validateRobloxUsername(raw) {
    const clean = typeof raw === 'string' ? raw.trim() : '';
    if (!clean) {
      return { valid: false, errorKey: 'warriors.errUsernameEmpty', error: 'Roblox kullanıcı adı boş bırakılamaz.' };
    }
    if (!ROBLOX_USERNAME_REGEX.test(clean)) {
      return {
        valid: false,
        errorKey: 'warriors.errUsernameFormat',
        error: `Geçersiz Roblox kullanıcı adı ("${clean}"): 3-20 karakter olmalı, yalnızca harf/rakam ve en fazla bir alt çizgi içermeli, "_" ile başlamamalı veya bitmemelidir.`,
      };
    }
    return { valid: true, value: clean };
  }

  /**
   * Kill sayısı doğrulaması:
   * 0-999999999 arası tam sayı; "13.500" veya "13 500" gelirse nokta/boşluk temizlenir.
   */
  parseKillCount(raw) {
    if (typeof raw === 'number') {
      if (Number.isInteger(raw) && raw >= LIMITS.minKills && raw <= LIMITS.maxKills) {
        return { valid: true, value: raw };
      }
      return {
        valid: false,
        errorKey: 'warriors.errKillsRange',
        error: `Kill sayısı ${LIMITS.minKills} ile ${LIMITS.maxKills} arasında bir tam sayı olmalıdır.`,
      };
    }

    const str = typeof raw === 'string' ? raw.trim() : '';
    if (!str) {
      return { valid: false, errorKey: 'warriors.errKillsEmpty', error: 'Kill sayısı boş bırakılamaz.' };
    }

    // Binlik ayırıcı olarak kullanılan nokta veya boşlukları temizle (örn: "13.500", "13 500")
    const stripped = str.replace(/[\s.\u00A0]+/g, '');
    if (!/^\d+$/.test(stripped)) {
      return {
        valid: false,
        errorKey: 'warriors.errKillsFormat',
        error: `Geçersiz kill sayısı ("${str}"): yalnızca pozitif tam sayı girilebilir.`,
      };
    }

    const parsed = Number.parseInt(stripped, 10);
    if (!Number.isSafeInteger(parsed) || parsed < LIMITS.minKills || parsed > LIMITS.maxKills) {
      return {
        valid: false,
        errorKey: 'warriors.errKillsRange',
        error: `Kill sayısı ${LIMITS.minKills} ile ${LIMITS.maxKills} arasında olmalıdır.`,
      };
    }

    return { valid: true, value: parsed };
  }

  /**
   * Özel yüklenmiş savaşçı görselini güvenli bir şekilde data/warriors/ içine yazar.
   */
  saveCustomImageFile(buffer, safeRandomFileName) {
    if (!CUSTOM_IMAGE_FILENAME_REGEX.test(String(safeRandomFileName || ''))) {
      throw new Error('Geçersiz görsel dosya adı.');
    }
    this._ensureDirs();
    const { imagesDir } = this.getPaths();
    const targetPath = path.join(imagesDir, safeRandomFileName);
    const written = this._writeFileAtomic(targetPath, buffer);
    if (!written) {
      throw new Error('Özel savaşçı görseli diske yazılamadı.');
    }
    return safeRandomFileName;
  }

  /**
   * Yalnızca güvenli hex dosya adlarına izin verir; path traversal'ı engeller.
   */
  resolveCustomImagePath(fileName) {
    const clean = typeof fileName === 'string' ? fileName.trim() : '';
    if (!CUSTOM_IMAGE_FILENAME_REGEX.test(clean)) {
      return null;
    }
    const { imagesDir } = this.getPaths();
    const resolvedBase = path.resolve(imagesDir);
    const resolvedTarget = path.resolve(imagesDir, clean);
    if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
      return null;
    }
    try {
      const stat = fs.statSync(resolvedTarget);
      if (stat.isFile()) return resolvedTarget;
    } catch (_) {}
    return null;
  }

  /**
   * Eski ve yeni liste arasındaki farkları denetim geçmişi için çıkarır.
   */
  _buildDiffSummary(oldList, newList) {
    const changes = [];
    const oldById = new Map(oldList.map((w, idx) => [w.id, { ...w, idx }]));
    const newIds = new Set(newList.map((w) => w.id));

    oldList.forEach((oldItem, oldIdx) => {
      if (!newIds.has(oldItem.id)) {
        changes.push(`#${oldIdx + 1} ${oldItem.robloxUsername} kaldirildi`);
      }
    });

    newList.forEach((newItem, newIdx) => {
      const prev = oldById.get(newItem.id);
      if (!prev) {
        changes.push(`#${newIdx + 1} ${newItem.robloxUsername} (${newItem.kills} kill) eklendi`);
        return;
      }

      if (prev.idx !== newIdx) {
        changes.push(`${newItem.robloxUsername}: sira #${prev.idx + 1} -> #${newIdx + 1}`);
      }
      if (prev.robloxUsername !== newItem.robloxUsername) {
        changes.push(`#${newIdx + 1} isim: ${prev.robloxUsername} -> ${newItem.robloxUsername}`);
      }
      if (prev.kills !== newItem.kills) {
        changes.push(`${newItem.robloxUsername}: kill ${prev.kills} -> ${newItem.kills}`);
      }
      if (prev.imageMode !== newItem.imageMode || prev.customImageFile !== newItem.customImageFile) {
        const fromImg = prev.imageMode === 'custom' ? 'ozel' : 'roblox';
        const toImg = newItem.imageMode === 'custom' ? 'ozel' : 'roblox';
        changes.push(`${newItem.robloxUsername}: gorsel ${fromImg} -> ${toImg}`);
      }
    });

    return changes;
  }

  /**
   * Geliştirici panelinden gelen savaşçı listesini doğrular, yedekler ve atomik olarak kaydeder.
   */
  updateWarriors(rows, options = {}) {
    const current = this.getStore();
    const expectedVersion =
      options.expectedVersion !== undefined && options.expectedVersion !== null && options.expectedVersion !== ''
        ? Number.parseInt(String(options.expectedVersion), 10)
        : null;

    if (expectedVersion !== null && expectedVersion !== current.version) {
      return {
        ok: false,
        statusCode: 409,
        errorKey: 'warriors.errVersionConflict',
        error: 'Başka bir yetkili az önce değişiklik yaptı. Lütfen sayfayı yenileyip tekrar deneyiniz.',
      };
    }

    if (!Array.isArray(rows) || rows.length < LIMITS.minWarriors || rows.length > LIMITS.maxWarriors) {
      return {
        ok: false,
        statusCode: 400,
        errorKey: 'warriors.errCountRange',
        error: `Savaşçı sayısı ${LIMITS.minWarriors} ile ${LIMITS.maxWarriors} arasında olmalıdır.`,
      };
    }

    const existingById = new Map(current.warriors.map((w) => [w.id, w]));
    const resolvedIdsByLower = options.resolvedIdsByLower || new Map();
    const seenLowerNames = new Set();
    const nextWarriors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const nameRes = this.validateRobloxUsername(row.robloxUsername);
      if (!nameRes.valid) {
        return {
          ok: false,
          statusCode: 400,
          errorKey: nameRes.errorKey,
          error: `#${i + 1}: ${nameRes.error}`,
        };
      }

      const lower = nameRes.value.toLowerCase();
      if (seenLowerNames.has(lower)) {
        return {
          ok: false,
          statusCode: 400,
          errorKey: 'warriors.errDuplicateUsername',
          error: `Aynı Roblox kullanıcı adı birden fazla kez yazılamaz ("${nameRes.value}").`,
        };
      }
      seenLowerNames.add(lower);

      const killsRes = this.parseKillCount(row.kills);
      if (!killsRes.valid) {
        return {
          ok: false,
          statusCode: 400,
          errorKey: killsRes.errorKey,
          error: `#${i + 1} (${nameRes.value}): ${killsRes.error}`,
        };
      }

      const existingRow = typeof row.id === 'string' ? existingById.get(row.id) : null;
      const id =
        existingRow
          ? existingRow.id
          : (typeof row.id === 'string' && /^[A-Za-z0-9_-]{2,24}$/.test(row.id)
              ? row.id
              : `w_${crypto.randomBytes(3).toString('hex')}`);

      let imageMode = row.imageMode === 'custom' ? 'custom' : 'roblox';
      let customImageFile = null;

      if (imageMode === 'custom') {
        const candidateFile =
          (typeof row.newCustomImageFile === 'string' && row.newCustomImageFile) ||
          (typeof row.customImageFile === 'string' && row.customImageFile) ||
          (existingRow && existingRow.customImageFile) ||
          null;

        if (candidateFile && CUSTOM_IMAGE_FILENAME_REGEX.test(candidateFile) && this.resolveCustomImagePath(candidateFile)) {
          customImageFile = candidateFile;
        } else {
          // Geçerli özel dosya yoksa Roblox avatar moduna güvenli dönüş
          imageMode = 'roblox';
          customImageFile = null;
        }
      }

      let robloxUserId = null;
      if (resolvedIdsByLower.has(lower)) {
        const foundId = resolvedIdsByLower.get(lower);
        robloxUserId = Number.isInteger(foundId) && foundId > 0 ? foundId : null;
      } else if (existingRow && existingRow.robloxUsername.toLowerCase() === lower) {
        robloxUserId = existingRow.robloxUserId || null;
      }

      nextWarriors.push({
        id,
        robloxUsername: nameRes.value,
        kills: killsRes.value,
        order: i + 1,
        imageMode,
        customImageFile,
        robloxUserId,
      });
    }

    const diffSummary = this._buildDiffSummary(current.warriors, nextWarriors);
    const nowIso = new Date().toISOString();
    const nextVersion = current.version + 1;
    const nextHistory = [...(current.history || [])];

    if (diffSummary.length > 0) {
      nextHistory.push({
        timestamp: nowIso,
        actorId: options.actorId ? String(options.actorId) : 'system',
        actorTag: options.actorTag ? String(options.actorTag).slice(0, 80) : 'Developer',
        fromVersion: current.version,
        toVersion: nextVersion,
        changes: diffSummary,
      });
    }

    const nextPayload = {
      version: nextVersion,
      updatedAt: nowIso,
      warriors: nextWarriors,
      history: nextHistory.slice(-LIMITS.maxHistoryEntries),
    };

    const { jsonPath, bakPath } = this.getPaths();

    // Mevcut geçerli dosyayı kaydetmeden önce .bak olarak yedekle
    if (fs.existsSync(jsonPath)) {
      try {
        const currentRaw = fs.readFileSync(jsonPath, 'utf8');
        this._writeFileAtomic(bakPath, currentRaw);
      } catch (_) {}
    }

    const ok = this._writeFileAtomic(jsonPath, JSON.stringify(nextPayload, null, 2));
    if (!ok) {
      return {
        ok: false,
        statusCode: 500,
        errorKey: 'warriors.errSaveFailed',
        error: 'Değişiklikler kalıcı depoya yazılamadı.',
      };
    }

    this._cachedData = nextPayload;

    return {
      ok: true,
      store: this._clonePayload(nextPayload),
      changes: diffSummary,
    };
  }

  /**
   * Roblox userId bilgisini depoya sessizce işler (versiyonu veya geçmişi gereksiz şişirmeden).
   */
  syncResolvedUserIds(idMapByLowerName) {
    if (!idMapByLowerName || idMapByLowerName.size === 0) return;
    const current = this.getStore();
    let changed = false;

    const updatedWarriors = current.warriors.map((w) => {
      const resolvedId = idMapByLowerName.get(w.robloxUsername.toLowerCase());
      if (Number.isInteger(resolvedId) && resolvedId > 0 && w.robloxUserId !== resolvedId) {
        changed = true;
        return { ...w, robloxUserId: resolvedId };
      }
      return w;
    });

    if (!changed) return;
    const nextPayload = {
      ...current,
      warriors: updatedWarriors,
    };
    const { jsonPath } = this.getPaths();
    if (this._writeFileAtomic(jsonPath, JSON.stringify(nextPayload, null, 2))) {
      this._cachedData = nextPayload;
    }
  }
}

const defaultStore = new WarriorsStore();

module.exports = defaultStore;
module.exports.WarriorsStore = WarriorsStore;
