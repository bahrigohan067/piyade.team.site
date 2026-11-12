const fs = require('fs');
const axios = require('axios');
const warriorsConfig = require('../config/warriors.config');
const defaultWarriorsStore = require('./warriorsStore');

const { LIMITS } = warriorsConfig;

class RobloxAvatarService {
  constructor(options = {}) {
    this.store = options.store || defaultWarriorsStore;
    this.http = options.httpClient || axios;
    this.memoryCache = new Map(); // lowerUsername -> { userId, resolvedUsername, imageUrl, fetchedAt }
    this.diskLoaded = false;
    this.inFlightPromise = null;
    this.lastFailureAt = 0;
  }

  /**
   * Yalnızca resmi Roblox CDN alt alan adlarına (https://*.rbxcdn.com) izin verir.
   */
  isSafeRobloxCdnUrl(urlStr) {
    if (typeof urlStr !== 'string' || !urlStr.trim()) return false;
    try {
      const parsed = new URL(urlStr.trim());
      if (parsed.protocol !== 'https:') return false;
      const host = parsed.hostname.toLowerCase();
      return host === 'rbxcdn.com' || host.endsWith('.rbxcdn.com');
    } catch (_) {
      return false;
    }
  }

  _loadDiskCacheIfNeeded() {
    if (this.diskLoaded) return;
    this.diskLoaded = true;
    const { avatarCachePath } = this.store.getPaths();
    try {
      if (!fs.existsSync(avatarCachePath)) return;
      const raw = fs.readFileSync(avatarCachePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        Object.entries(parsed).forEach(([key, entry]) => {
          if (!entry || typeof entry !== 'object') return;
          const safeUrl = this.isSafeRobloxCdnUrl(entry.imageUrl) ? entry.imageUrl : null;
          const userId = Number.isInteger(entry.userId) && entry.userId > 0 ? entry.userId : null;
          const fetchedAt = Number.isFinite(entry.fetchedAt) ? entry.fetchedAt : 0;
          this.memoryCache.set(String(key).toLowerCase(), {
            userId,
            resolvedUsername: typeof entry.resolvedUsername === 'string' ? entry.resolvedUsername : null,
            imageUrl: safeUrl,
            fetchedAt,
          });
        });
      }
    } catch (_) {
      // Disk önbelleği bozuksa sessizce bellekten devam et
    }
  }

  _persistDiskCache() {
    try {
      const { avatarCachePath } = this.store.getPaths();
      const serialized = {};
      for (const [k, v] of this.memoryCache.entries()) {
        serialized[k] = v;
      }
      this.store._writeFileAtomic(avatarCachePath, JSON.stringify(serialized, null, 2));
    } catch (_) {}
  }

  _isEntryFresh(entry, nowMs = Date.now()) {
    if (!entry || !Number.isFinite(entry.fetchedAt)) return false;
    return nowMs - entry.fetchedAt < LIMITS.robloxCacheTtlMs;
  }

  /**
   * Roblox API üzerinden kullanıcı adlarından numeric userId ve 420x420 avatar PNG görseli çeker.
   * Her aşama 5 saniye zaman aşımı ile korunur; ağ hatalarında asla fırlatmaz.
   */
  async fetchRobloxProfilesBatch(usernames) {
    const cleanNames = Array.from(
      new Set((usernames || []).map((u) => String(u || '').trim()).filter(Boolean))
    );
    if (cleanNames.length === 0) {
      return { reachable: true, profilesByLower: new Map(), missingUsernames: [] };
    }

    try {
      const usersResp = await this.http.post(
        'https://users.roblox.com/v1/usernames/users',
        {
          usernames: cleanNames,
          excludeBannedUsers: false,
        },
        {
          timeout: LIMITS.robloxTimeoutMs,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        }
      );

      const userDataList =
        usersResp && usersResp.data && Array.isArray(usersResp.data.data)
          ? usersResp.data.data
          : [];

      const profilesByLower = new Map();
      const userIdList = [];

      userDataList.forEach((entry) => {
        if (!entry || typeof entry.requestedUsername !== 'string') return;
        const lower = entry.requestedUsername.toLowerCase();
        const userId = Number.isInteger(entry.id) && entry.id > 0 ? entry.id : null;
        if (!userId) return;

        profilesByLower.set(lower, {
          userId,
          resolvedUsername: typeof entry.name === 'string' ? entry.name : entry.requestedUsername,
          imageUrl: null,
        });
        userIdList.push(userId);
      });

      const missingUsernames = cleanNames.filter((name) => !profilesByLower.has(name.toLowerCase()));

      if (userIdList.length > 0) {
        const thumbUrl =
          `https://thumbnails.roblox.com/v1/users/avatar?userIds=${encodeURIComponent(userIdList.join(','))}` +
          '&size=420x420&format=Png&isCircular=false';

        try {
          const thumbResp = await this.http.get(thumbUrl, {
            timeout: LIMITS.robloxTimeoutMs,
            headers: { Accept: 'application/json' },
          });

          const thumbList =
            thumbResp && thumbResp.data && Array.isArray(thumbResp.data.data)
              ? thumbResp.data.data
              : [];

          thumbList.forEach((thumb) => {
            if (!thumb || !Number.isInteger(thumb.targetId)) return;
            if (thumb.state && thumb.state !== 'Completed') return;
            if (!this.isSafeRobloxCdnUrl(thumb.imageUrl)) return;

            for (const profile of profilesByLower.values()) {
              if (profile.userId === thumb.targetId) {
                profile.imageUrl = thumb.imageUrl;
              }
            }
          });
        } catch (thumbErr) {
          console.warn('[ROBLOX AVATAR] Thumbnail alınamadı (son önbellek/placeholder korunacak):', thumbErr.message);
        }
      }

      // Önbelleği güncelle
      const now = Date.now();
      let cacheMutated = false;
      const syncedIds = new Map();

      for (const [lower, prof] of profilesByLower.entries()) {
        const prev = this.memoryCache.get(lower);
        const safeImageUrl = prof.imageUrl || (prev && prev.imageUrl) || null;
        this.memoryCache.set(lower, {
          userId: prof.userId,
          resolvedUsername: prof.resolvedUsername,
          imageUrl: safeImageUrl,
          fetchedAt: now,
        });
        prof.imageUrl = safeImageUrl;
        syncedIds.set(lower, prof.userId);
        cacheMutated = true;
      }

      if (cacheMutated) {
        this._persistDiskCache();
        this.store.syncResolvedUserIds(syncedIds);
      }

      this.lastFailureAt = 0;
      return {
        reachable: true,
        profilesByLower,
        missingUsernames,
      };
    } catch (err) {
      this.lastFailureAt = Date.now();
      console.warn('[ROBLOX AVATAR] Kullanıcı çözümleme erişim dışı:', err.message);
      return {
        reachable: false,
        profilesByLower: new Map(),
        missingUsernames: [],
      };
    }
  }

  /**
   * Yönetici kaydettiğinde kullanıcı adlarının Roblox varlığını denetler; ağ çökerse engellemez.
   */
  async verifyUsernamesForSave(usernames) {
    this._loadDiskCacheIfNeeded();
    return this.fetchRobloxProfilesBatch(usernames);
  }

  /**
   * Savaşçı listesini görüntülenmeye hazır avatar URL ve numeric userId bilgileriyle zenginleştirir.
   */
  async enrichWarriorsForDisplay(warriors, options = {}) {
    this._loadDiskCacheIfNeeded();
    const forceRefresh = Boolean(options.forceRefresh);
    const now = Date.now();

    const staleUsernames = [];
    for (const w of warriors || []) {
      const lower = w.robloxUsername.toLowerCase();
      const cached = this.memoryCache.get(lower);
      const needsImage = w.imageMode !== 'custom' && (!cached || !cached.imageUrl || !this._isEntryFresh(cached, now));
      const needsUserId = !w.robloxUserId && (!cached || !cached.userId || !this._isEntryFresh(cached, now));

      if (forceRefresh || needsImage || needsUserId) {
        staleUsernames.push(w.robloxUsername);
      }
    }

    const canFetchNow =
      staleUsernames.length > 0 &&
      (forceRefresh || now - this.lastFailureAt >= LIMITS.robloxFailureBackoffMs);

    if (canFetchNow) {
      if (!this.inFlightPromise) {
        this.inFlightPromise = this.fetchRobloxProfilesBatch(staleUsernames).finally(() => {
          this.inFlightPromise = null;
        });
      }
      await this.inFlightPromise;
    }

    return (warriors || []).map((w, idx) => {
      const lower = w.robloxUsername.toLowerCase();
      const cached = this.memoryCache.get(lower);
      const resolvedUserId =
        (Number.isInteger(w.robloxUserId) && w.robloxUserId > 0 ? w.robloxUserId : null) ||
        (cached && Number.isInteger(cached.userId) && cached.userId > 0 ? cached.userId : null);

      let avatarUrl = null;
      let isCustomImage = false;
      let isPlaceholder = false;

      if (w.imageMode === 'custom' && w.customImageFile && this.store.resolveCustomImagePath(w.customImageFile)) {
        avatarUrl = `/savascilar/gorsel/${encodeURIComponent(w.customImageFile)}`;
        isCustomImage = true;
      } else if (cached && this.isSafeRobloxCdnUrl(cached.imageUrl)) {
        avatarUrl = cached.imageUrl;
      } else {
        isPlaceholder = true;
      }

      return {
        ...w,
        rank: idx + 1,
        robloxUserId: resolvedUserId,
        robloxProfileUrl: resolvedUserId ? `https://www.roblox.com/users/${resolvedUserId}/profile` : null,
        avatarUrl,
        isCustomImage,
        isPlaceholder,
      };
    });
  }

  _resetForTests() {
    this.memoryCache.clear();
    this.diskLoaded = false;
    this.inFlightPromise = null;
    this.lastFailureAt = 0;
  }
}

const defaultAvatarService = new RobloxAvatarService();

module.exports = defaultAvatarService;
module.exports.RobloxAvatarService = RobloxAvatarService;
