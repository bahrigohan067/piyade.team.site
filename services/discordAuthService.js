const axios = require('axios');
const appConfig = require('../config/app.config');

class DiscordAuthService {
  constructor() {
    this.clientId = appConfig.DISCORD_CLIENT_ID;
    this.clientSecret = appConfig.DISCORD_CLIENT_SECRET;
  }

  /**
   * OAuth2 yönlendirme URL'i
   */
  getRedirectUri() {
    return `${appConfig.BASE_URL}/auth/discord/callback`;
  }

  /**
   * Discord Yetkilendirme Bağlantısını oluşturur
   * @param {string} state - CSRF/oturum doğrulama için zorunlu state
   */
  getAuthorizeUrl(state = '') {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.getRedirectUri(),
      response_type: 'code',
      scope: 'identify',
      prompt: 'consent',
    });

    if (state) {
      params.append('state', state);
    }

    return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
  }

  /**
   * routes/auth.js uyumluluğu için takma ad (alias)
   * @param {string} state
   */
  getAuthorizationUrl(state = '') {
    return this.getAuthorizeUrl(state);
  }

  /**
   * Discord'dan dönen yetkilendirme kodunu Access Token ile takas eder
   * @param {string} code
   */
  async exchangeCode(code) {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('DISCORD_CLIENT_ID veya DISCORD_CLIENT_SECRET yapılandırılmamış!');
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.getRedirectUri(),
    });

    const response = await axios.post(
      'https://discord.com/api/oauth2/token',
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000,
      }
    );

    return response.data; // { access_token, token_type, expires_in, refresh_token, scope }
  }

  /**
   * routes/auth.js uyumluluğu için takma ad (alias)
   * @param {string} code
   */
  async exchangeCodeForToken(code) {
    return this.exchangeCode(code);
  }

  /**
   * Discord kullanıcı nesnesinden tam Avatar URL'si üretir
   * @param {object} user
   */
  buildAvatarUrl(user) {
    if (!user) return 'https://cdn.discordapp.com/embed/avatars/0.png';
    if (user.avatarUrl) return user.avatarUrl;
    if (user.avatar && user.id) {
      const ext = String(user.avatar).startsWith('a_') ? 'gif' : 'png';
      return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=256`;
    }
    try {
      const index = Number((BigInt(user.id || '0') >> 22n) % 6n);
      return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
    } catch (_) {
      return 'https://cdn.discordapp.com/embed/avatars/0.png';
    }
  }

  /**
   * Access Token ile Discord kullanıcı profilini çeker
   * @param {string} accessToken
   */
  async fetchUserProfile(accessToken) {
    const response = await axios.get('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 10000,
    });

    const user = response.data;
    const avatarUrl = this.buildAvatarUrl(user);

    return {
      id: user.id,
      username: user.username,
      global_name: user.global_name || user.username,
      globalName: user.global_name || user.username,
      discriminator: user.discriminator,
      avatar: user.avatar,
      avatarUrl,
    };
  }

  /**
   * routes/auth.js uyumluluğu için takma ad (alias)
   * @param {string} accessToken
   */
  async fetchDiscordUser(accessToken) {
    return this.fetchUserProfile(accessToken);
  }
}

module.exports = new DiscordAuthService();
