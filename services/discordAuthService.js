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
   * @param {string} state - CSRF/oturum doğrulama için opsiyonel state
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
    const avatarUrl = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256`
      : `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`;

    return {
      id: user.id,
      username: user.username,
      globalName: user.global_name || user.username,
      discriminator: user.discriminator,
      avatar: user.avatar,
      avatarUrl,
    };
  }
}

module.exports = new DiscordAuthService();
