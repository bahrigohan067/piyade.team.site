/**
 * Yeni oyun eklemek = bu dosyaya bir kayıt eklemek
 *
 * Oyun bazlı roller ve oyun bazlı kayıt sistemi için hazırlık iskeleti.
 * Bu turda hiçbir rota veya şablonda aktif olarak kullanılmaz.
 */

function resolveGameRoleId(envKey, envObj = process.env) {
  const raw = envObj && typeof envObj[envKey] === 'string' ? envObj[envKey].trim() : '';
  return raw || null;
}

function getGamesConfig(envObj = process.env) {
  return [
    {
      id: 'roblox',
      name: { tr: 'Roblox', en: 'Roblox' },
      short: { tr: 'Roblox', en: 'Roblox' },
      icon: '',
      enabled: true,
      roleId: resolveGameRoleId('GAME_ROLE_ROBLOX', envObj),
    },
    {
      id: 'zula',
      name: { tr: 'Zula', en: 'Zula' },
      short: { tr: 'Zula', en: 'Zula' },
      icon: '',
      enabled: true,
      roleId: resolveGameRoleId('GAME_ROLE_ZULA', envObj),
    },
    {
      id: 'minecraft',
      name: { tr: 'TLauncher (Minecraft)', en: 'TLauncher (Minecraft)' },
      short: { tr: 'TLauncher (Minecraft)', en: 'TLauncher (Minecraft)' },
      icon: '',
      enabled: true,
      roleId: resolveGameRoleId('GAME_ROLE_MINECRAFT', envObj),
    },
    {
      id: 'cs2',
      name: { tr: 'CS2', en: 'CS2' },
      short: { tr: 'CS2', en: 'CS2' },
      icon: '',
      enabled: true,
      roleId: resolveGameRoleId('GAME_ROLE_CS2', envObj),
    },
  ];
}

const GAMES = getGamesConfig();

module.exports = {
  GAMES,
  getGamesConfig,
};
