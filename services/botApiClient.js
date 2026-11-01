const axios = require('axios');
const appConfig = require('../config/app.config');

class BotApiUnavailableError extends Error {
  constructor(message, originalError = null) {
    super(message || 'Bot REST API servisine şu anda ulaşılamıyor.');
    this.name = 'BotApiUnavailableError';
    this.status = 503;
    this.originalError = originalError;
  }
}

class BotApiError extends Error {
  constructor(message, status = 400, data = null) {
    super(message);
    this.name = 'BotApiError';
    this.status = status;
    this.data = data;
  }
}

class BotApiClient {
  constructor() {
    this.client = axios.create({
      baseURL: appConfig.BOT_API_URL,
      timeout: appConfig.API_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Her isteğe otomatik Bearer token ekle
    this.client.interceptors.request.use((req) => {
      if (appConfig.API_SECRET) {
        req.headers['Authorization'] = `Bearer ${appConfig.API_SECRET}`;
      }
      return req;
    });

    // Yanıt ve Hata Yönetimi
    this.client.interceptors.response.use(
      (res) => res,
      (err) => {
        // Ağ / Bağlantı / Zaman Aşımı Hataları
        if (
          !err.response ||
          err.code === 'ECONNREFUSED' ||
          err.code === 'ENOTFOUND' ||
          err.code === 'ECONNABORTED' ||
          err.code === 'ETIMEDOUT' ||
          err.response?.status === 502 ||
          err.response?.status === 503 ||
          err.response?.status === 504
        ) {
          console.error(`[BOT API BAĞLANTI HATASI] ${err.config?.url}:`, err.message);
          throw new BotApiUnavailableError(
            `Bot REST API (${appConfig.BOT_API_URL}) çevrimdışı veya yanıt vermiyor. Lütfen bot servisinin çalıştığından emin olun.`,
            err
          );
        }

        // Botun döndürdüğü yapılandırılmış hata yanıtı
        const errorData = err.response?.data;
        const errorMessage = errorData?.error || errorData?.message || `API Hatası: ${err.message}`;
        const errorStatus = err.response?.status || 500;

        throw new BotApiError(errorMessage, errorStatus, errorData);
      }
    );
  }

  /**
   * Bot API Sağlık Kontrolü
   */
  async getHealth() {
    try {
      const res = await this.client.get('/api/health');
      return res.data;
    } catch (err) {
      if (err instanceof BotApiUnavailableError) {
        return { status: 'offline', botReady: false };
      }
      throw err;
    }
  }

  /**
   * Üyenin rollerini ve hesaplanan yetki seviyesini getirir
   * @param {string} discordId
   */
  async getMemberRoles(discordId) {
    const res = await this.client.get(`/api/member/${discordId}/roles`);
    return res.data;
  }

  /**
   * Üyenin detaylı profilini getirir
   * @param {string} discordId
   */
  async getMemberProfile(discordId) {
    const res = await this.client.get(`/api/member/${discordId}/profile`);
    return res.data;
  }

  /**
   * Tryout Sıralama Tablosunu getirir
   */
  async getTryoutLeaderboard() {
    const res = await this.client.get('/api/tryout/leaderboard');
    return res.data;
  }

  /**
   * VS Top 10 Liderlik Tablosunu getirir
   */
  async getVsTop10() {
    const res = await this.client.get('/api/vs/top10');
    return res.data;
  }

  /**
   * Acil Takviye durumunu ve aktif kayıtlı üye sayısını getirir
   * @param {string|null} actorId
   */
  async getHelpStatus(actorId = null) {
    const headers = {};
    if (actorId) headers['X-Actor-Id'] = actorId;
    const res = await this.client.get('/api/help/status', { headers });
    return res.data;
  }

  /**
   * Acil Takviye Çağrısı Başlatır
   * @param {string} actorId
   */
  async triggerHelpCall(actorId) {
    const res = await this.client.post(
      '/api/help/call',
      {},
      {
        headers: { 'X-Actor-Id': actorId },
      }
    );
    return res.data;
  }

  /**
   * Site İçi Kayıt Başvurusu Oluşturur
   * @param {object} payload - { discordId, realName, gender, robloxInput }
   */
  async createRegistration({ discordId, realName, gender, robloxInput }) {
    const res = await this.client.post('/api/register', {
      discordId,
      realName,
      gender,
      robloxInput,
    });
    return res.data;
  }

  /**
   * Üyenin Kayıt Başvuru Durumunu Sorgular
   * @param {string} discordId
   */
  async getRegistrationStatus(discordId) {
    try {
      const res = await this.client.get(`/api/register/status/${discordId}`);
      return res.data;
    } catch (err) {
      // Eğer /status/:id henüz yoksa fallback olarak profile üzerinden kontrol et
      if (err.status === 404) {
        const prof = await this.getMemberProfile(discordId);
        return {
          userId: discordId,
          status: prof.registration?.registered ? 'approved' : 'unregistered',
          registration: prof.registration,
        };
      }
      throw err;
    }
  }

  /**
   * Yönetim: Üye Arama
   * @param {string} actorId - İşlemi yapan yetkili
   * @param {string} query - Arama kelimesi
   */
  async searchAdminMembers(actorId, query = '') {
    const res = await this.client.get('/api/admin/members', {
      params: { query },
      headers: { 'X-Actor-Id': actorId },
    });
    return res.data;
  }

  /**
   * Yönetim: Tekil Üye Tüm Detayları ve Sicili
   * @param {string} actorId
   * @param {string} memberId
   */
  async getAdminMemberDetail(actorId, memberId) {
    const res = await this.client.get(`/api/admin/members/${memberId}`, {
      headers: { 'X-Actor-Id': actorId },
    });
    return res.data;
  }

  /**
   * Yönetim: Uyarı Ver (Sözlü veya Resmi)
   * @param {string} actorId
   * @param {object} data - { targetUserId, type, reason, ruleCode }
   */
  async applyWarning(actorId, { targetUserId, type, reason, ruleCode }) {
    const res = await this.client.post(
      '/api/admin/warn',
      { targetUserId, type, reason, ruleCode },
      { headers: { 'X-Actor-Id': actorId } }
    );
    return res.data;
  }

  /**
   * Yönetim: Verilen Uyarıya Kanıt Görseli Ekleme
   * @param {string} actorId
   * @param {string|number} warnId
   * @param {string} evidenceUrl
   */
  async attachWarningEvidence(actorId, warnId, evidenceUrl) {
    const res = await this.client.post(
      `/api/admin/warn/${warnId}/evidence`,
      { evidenceUrl },
      { headers: { 'X-Actor-Id': actorId } }
    );
    return res.data;
  }
}

module.exports = {
  botApiClient: new BotApiClient(),
  BotApiUnavailableError,
  BotApiError,
};
