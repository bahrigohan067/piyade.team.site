const chatConfig = require('../config/chat.config');

const MAX_BUFFER_PER_USER = 100;
const RECONNECT_METRICS_WINDOW_MS = 60 * 60 * 1000; // Son 1 saat
const ALLOWED_RECONNECT_REASONS = new Set(['timeout', 'other_tab', 'error']);

/**
 * Tek süreçli bellek içi SSE (Server-Sent Events) Dağıtım Merkezi.
 * Not: Birden fazla sunucu kopyası (multi-instance) çalıştırılacaksa
 * ortak bir Pub/Sub kanalı (örn. Redis Pub/Sub) eklenmelidir.
 */
class ChatSseHub {
  constructor() {
    this.clientsByUser = new Map(); // userId -> Set<ClientRecord>
    this.eventSeq = 0;
    this.eventBufferByUser = new Map(); // userId -> Array<{ id, type, data, ts }>
    this.typingLastAt = new Map(); // `${from}:${to}` -> ts
    // Kimliksiz, yalnızca son 1 saatlik yeniden bağlanma sayaçları (Developer teşhis satırı için)
    this.reconnectEvents = []; // Array<{ ts, reason }>
  }

  _pruneReconnectEvents(nowTs = Date.now()) {
    const cutoff = nowTs - RECONNECT_METRICS_WINDOW_MS;
    while (this.reconnectEvents.length > 0 && this.reconnectEvents[0].ts < cutoff) {
      this.reconnectEvents.shift();
    }
    if (this.reconnectEvents.length > 5000) {
      this.reconnectEvents.splice(0, this.reconnectEvents.length - 5000);
    }
  }

  recordReconnectReason(reason, nowTs = Date.now()) {
    const clean = String(reason || '').trim().toLowerCase();
    if (!ALLOWED_RECONNECT_REASONS.has(clean)) return;
    this._pruneReconnectEvents(nowTs);
    this.reconnectEvents.push({ ts: nowTs, reason: clean });
  }

  getActiveConnectionsTotal() {
    let total = 0;
    for (const set of this.clientsByUser.values()) {
      total += set ? set.size : 0;
    }
    return total;
  }

  /**
   * Kimliksiz gerçek zamanlı bağlantı istatistik özeti (ASLA kullanıcı kimliği içermez).
   */
  getDiagnosticsSnapshot(nowTs = Date.now()) {
    this._pruneReconnectEvents(nowTs);
    const reasonBreakdown = { timeout: 0, other_tab: 0, error: 0 };
    for (const ev of this.reconnectEvents) {
      if (ev.reason in reasonBreakdown) {
        reasonBreakdown[ev.reason] += 1;
      }
    }
    return {
      activeConnections: this.getActiveConnectionsTotal(),
      reconnectsLastHour: this.reconnectEvents.length,
      reasonBreakdown,
    };
  }

  _nextEventId() {
    this.eventSeq += 1;
    return this.eventSeq;
  }

  _bufferEvent(userId, record) {
    let list = this.eventBufferByUser.get(userId);
    if (!list) {
      list = [];
      this.eventBufferByUser.set(userId, list);
    }
    list.push(record);
    if (list.length > MAX_BUFFER_PER_USER) {
      list.splice(0, list.length - MAX_BUFFER_PER_USER);
    }
  }

  _formatFrame(record) {
    return `id: ${record.id}\nevent: ${record.type}\ndata: ${JSON.stringify(record.data)}\n\n`;
  }

  getConnectionCount(userId) {
    const set = this.clientsByUser.get(String(userId || ''));
    return set ? set.size : 0;
  }

  isUserConnected(userId) {
    return this.getConnectionCount(userId) > 0;
  }

  /**
   * Yeni bir SSE bağlantısını kaydeder.
   * Kullanıcı başına en çok MAX_SSE_CONNECTIONS_PER_USER (8) bağlantıya izin verir;
   * sınır aşılırsa 429 döngüsü yerine en eski bağlantıyı nazikçe düşürür (replaced_by_other_tab).
   */
  subscribe(userId, req, res, { initialUnread = 0, reason = null, heartbeatMs = null } = {}) {
    const uid = String(userId || '').trim();
    const maxConn = chatConfig.LIMITS.MAX_SSE_CONNECTIONS_PER_USER || 8;
    const rawReason = reason || (req && req.query && req.query.reason) || '';
    if (rawReason) {
      this.recordReconnectReason(rawReason);
    }

    let userSet = this.clientsByUser.get(uid);
    if (userSet && userSet.size >= maxConn) {
      // En eski bağlantıyı bul ve nazikçe kapat (diğer sekmeye devret)
      let oldest = null;
      for (const c of userSet) {
        if (!oldest || c.connectedAt < oldest.connectedAt) {
          oldest = c;
        }
      }
      if (oldest) {
        this.recordReconnectReason('other_tab');
        this._safeWrite(
          oldest,
          `event: disconnect\ndata: ${JSON.stringify({ reason: 'replaced_by_other_tab' })}\n\n`
        );
        this._removeClient(oldest);
      }
      userSet = this.clientsByUser.get(uid);
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    if (!userSet) {
      userSet = new Set();
      this.clientsByUser.set(uid, userSet);
    }

    const client = {
      userId: uid,
      res,
      sessionID: req.sessionID || null,
      connectedAt: Date.now(),
      closed: false,
      heartbeatTimer: null,
    };

    userSet.add(client);

    // İstemci yeniden bağlanma bekleme süresi ve açılış olayı
    this._safeWrite(client, `retry: 3000\n\n`);
    const connectedRec = {
      id: this._nextEventId(),
      type: 'connected',
      data: { unread: initialUnread, ts: Date.now() },
      ts: Date.now(),
    };
    this._safeWrite(client, this._formatFrame(connectedRec));

    // Last-Event-ID yakalama (catch-up)
    const rawLastId = req.headers['last-event-id'] || (req.query && req.query.lastEventId) || '';
    const lastIdNum = Number.parseInt(String(rawLastId).trim(), 10);
    if (Number.isFinite(lastIdNum) && lastIdNum > 0) {
      const buffered = this.eventBufferByUser.get(uid) || [];
      for (const item of buffered) {
        if (item.id > lastIdNum) {
          this._safeWrite(client, this._formatFrame(item));
        }
      }
    }

    // 15 saniyede bir heartbeat (": ping" yorum satırı + istemci bekçisi için hafif ping olayı)
    const hbMs =
      Number.isFinite(Number(heartbeatMs)) && Number(heartbeatMs) > 0
        ? Number(heartbeatMs)
        : chatConfig.LIMITS.SSE_HEARTBEAT_MS || 15000;
    client.heartbeatTimer = setInterval(() => {
      if (client.closed) return;
      this._safeWrite(client, `: ping\n\nevent: ping\ndata: {}\n\n`);
    }, hbMs);
    if (client.heartbeatTimer.unref) {
      client.heartbeatTimer.unref();
    }

    const cleanup = () => {
      this._removeClient(client);
    };

    req.on('close', cleanup);
    req.on('aborted', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);

    return client;
  }

  _safeWrite(client, chunk) {
    if (!client || client.closed || client.res.writableEnded || client.res.destroyed) {
      this._removeClient(client);
      return false;
    }
    try {
      client.res.write(chunk);
      if (typeof client.res.flush === 'function') {
        client.res.flush();
      }
      return true;
    } catch (_) {
      this._removeClient(client);
      return false;
    }
  }

  _removeClient(client) {
    if (!client || client.closed) return;
    client.closed = true;
    if (client.heartbeatTimer) {
      clearInterval(client.heartbeatTimer);
      client.heartbeatTimer = null;
    }
    const set = this.clientsByUser.get(client.userId);
    if (set) {
      set.delete(client);
      if (set.size === 0) {
        this.clientsByUser.delete(client.userId);
      }
    }
    try {
      if (!client.res.writableEnded) client.res.end();
    } catch (_) {}
  }

  /**
   * Belirli bir kullanıcıya SSE olayı gönderir ve Last-Event-ID tamponuna kaydeder.
   */
  sendToUser(userId, type, data = {}, { buffer = true } = {}) {
    const uid = String(userId || '').trim();
    if (!uid) return 0;
    const record = {
      id: this._nextEventId(),
      type,
      data,
      ts: Date.now(),
    };
    if (buffer) {
      this._bufferEvent(uid, record);
    }
    const set = this.clientsByUser.get(uid);
    if (!set || set.size === 0) return 0;

    const frame = this._formatFrame(record);
    let sent = 0;
    for (const client of [...set]) {
      if (this._safeWrite(client, frame)) {
        sent += 1;
      }
    }
    return sent;
  }

  /**
   * Profil halkası değişimini tüm bağlı sohbet istemcilerine canlı yayar.
   */
  broadcastProfileRing(userId, ring) {
    const uid = String(userId || '').trim();
    if (!uid || !ring) return;
    for (const targetUid of [...this.clientsByUser.keys()]) {
      this.sendToUser(targetUid, 'profile', { userId: uid, ring }, { buffer: false });
    }
  }

  /**
   * Grup sohbeti olaylarını (yeni mesaj, yönetici silme vb.) tüm bağlı sohbet üyelerine canlı yayar.
   */
  broadcastGroupEvent(type, data = {}, { excludeUserId = null, buffer = true, computePerUserData = null } = {}) {
    const exclude = excludeUserId ? String(excludeUserId).trim() : null;
    let recipients = 0;
    for (const targetUid of [...this.clientsByUser.keys()]) {
      if (exclude && targetUid === exclude) continue;
      const payload = typeof computePerUserData === 'function' ? computePerUserData(targetUid, data) : data;
      if (payload === null || payload === undefined) continue;
      const sent = this.sendToUser(targetUid, type, payload, { buffer });
      if (sent > 0) recipients += 1;
    }
    return recipients;
  }

  /**
   * Yazıyor göstergesini 3 saniye hız sınırıyla (sunucuda saklamadan) iletir.
   */
  emitTyping(fromUserId, toUserId, convId) {
    const key = `${fromUserId}:${toUserId}`;
    const now = Date.now();
    const last = this.typingLastAt.get(key) || 0;
    const throttleMs = chatConfig.LIMITS.TYPING_THROTTLE_MS || 3000;
    if (now - last < throttleMs) {
      return false;
    }
    this.typingLastAt.set(key, now);
    if (this.typingLastAt.size > 1000) {
      for (const [k, ts] of this.typingLastAt.entries()) {
        if (now - ts > 15000) this.typingLastAt.delete(k);
      }
    }
    this.sendToUser(toUserId, 'typing', { convId, from: fromUserId, ts: now }, { buffer: false });
    return true;
  }

  /**
   * Bir oturum sonlandırıldığında ilgili kullanıcının SSE bağlantılarını kapatır.
   */
  disconnectUser(userId, reason = 'session_closed') {
    const set = this.clientsByUser.get(String(userId || ''));
    if (!set) return;
    for (const client of [...set]) {
      this._safeWrite(client, `event: disconnect\ndata: ${JSON.stringify({ reason })}\n\n`);
      this._removeClient(client);
    }
  }

  closeAll() {
    for (const set of [...this.clientsByUser.values()]) {
      for (const client of [...set]) {
        this._removeClient(client);
      }
    }
    this.clientsByUser.clear();
  }

  resetForTests() {
    this.closeAll();
    this.eventBufferByUser.clear();
    this.typingLastAt.clear();
    this.reconnectEvents = [];
    this.eventSeq = 0;
  }
}

const defaultSseHub = new ChatSseHub();

module.exports = {
  ChatSseHub,
  chatSseHub: defaultSseHub,
};
