#!/usr/bin/env node
/**
 * Railway Temiz Kurulum ve Açılış Doğrulama Betiği (verify:clean)
 *
 * Bu betik yalnızca Node.js yerleşik modüllerini kullanır:
 * 1. Projedeki tüm .js dosyalarında require()/import ifadelerini tarar ve
 *    kullanılan her üçüncü parti paketin package.json -> "dependencies" altında olduğunu doğrular.
 * 2. Mevcut node_modules klasörünü siler ve "npm ci --omit=dev" ile Railway üretim kurulumunu taklit eder.
 * 3. Eksik ortam değişkeni durumunda uygulamanın secret sızdırmadan yalnızca değişken adlarını yazıp
 *    kod 1 ile çıktığını doğrular.
 * 4. RAILWAY_VOLUME_MOUNT_PATH ile oturum deposu (services/sessionStore.js) yol çözümlemesini doğrular.
 * 5. Sahte (FAKE) ortam değişkenleriyle "node server.js" sürecini başlatır ve GET / isteğinin
 *    HTTP 200 OK döndüğünü doğrular.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execSync, spawn } = require('child_process');
const { builtinModules } = require('module');

const ROOT_DIR = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT_DIR, 'package.json');
const SERVER_PATH = path.join(ROOT_DIR, 'server.js');
const NODE_MODULES_DIR = path.join(ROOT_DIR, 'node_modules');

function logStep(step, msg) {
  console.log(`\n[${step}] ${msg}`);
}

function walkJsFiles(dir, fileList = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.sessions') {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsFiles(fullPath, fileList);
    } else if (entry.name.endsWith('.js')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function verifyDependenciesInPackageJson() {
  logStep('1/5', 'Projedeki tüm require() / import ifadeleri taranıyor...');
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const deps = Object.keys(pkg.dependencies || {});
  const devDeps = Object.keys(pkg.devDependencies || {});
  const builtins = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));

  const jsFiles = walkJsFiles(ROOT_DIR);
  const reqRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const impRegex = /import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;

  const thirdPartyUsed = new Map();

  for (const file of jsFiles) {
    const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf8');
    const specs = [];
    let match;
    while ((match = reqRegex.exec(content)) !== null) specs.push(match[1]);
    while ((match = impRegex.exec(content)) !== null) specs.push(match[1]);

    for (const spec of specs) {
      if (spec.startsWith('.') || spec.startsWith('/')) continue;
      const clean = spec.replace(/^node:/, '');
      const pkgName = clean.startsWith('@')
        ? clean.split('/').slice(0, 2).join('/')
        : clean.split('/')[0];
      if (builtins.has(pkgName)) continue;
      if (!thirdPartyUsed.has(pkgName)) thirdPartyUsed.set(pkgName, []);
      thirdPartyUsed.get(pkgName).push(rel);
    }
  }

  const missingDeps = [];
  const misplacedInDev = [];

  for (const [modName, files] of thirdPartyUsed.entries()) {
    if (!deps.includes(modName)) {
      missingDeps.push(`${modName} (kullanıldığı yer: ${files.join(', ')})`);
    }
    if (devDeps.includes(modName)) {
      misplacedInDev.push(`${modName} (devDependencies altında kalmış!)`);
    }
  }

  if (missingDeps.length > 0 || misplacedInDev.length > 0) {
    console.error('❌ Paket doğrulama hatası:');
    missingDeps.forEach((m) => console.error(`  - Eksik paket: ${m}`));
    misplacedInDev.forEach((m) => console.error(`  - Yanlış yerde: ${m}`));
    process.exit(1);
  }

  console.log(`✅ Taranan JS dosyası: ${jsFiles.length}`);
  console.log(`✅ Doğrulanan çalışma zamanı paketleri (${deps.length}): ${deps.join(', ')}`);
}

function runCleanInstall() {
  logStep('2/5', 'Railway temiz kurulum simülasyonu: node_modules siliniyor ve "npm ci --omit=dev" çalıştırılıyor...');
  if (fs.existsSync(NODE_MODULES_DIR)) {
    fs.rmSync(NODE_MODULES_DIR, { recursive: true, force: true });
    console.log('  • Mevcut node_modules silindi.');
  }

  const output = execSync('npm ci --omit=dev', {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log(output.trim());
  console.log('✅ "npm ci --omit=dev" başarıyla tamamlandı.');
}

function verifyMissingEnvBehavior() {
  logStep('3/5', 'Eksik ortam değişkeni (ENV) açılış doğrulaması test ediliyor...');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_PATH], {
      cwd: ROOT_DIR,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        NODE_ENV: 'production',
        PORT: '3099',
        BASE_URL: 'http://localhost:3099',
        BOT_API_URL: 'http://localhost:3098',
        DISCORD_CLIENT_ID: '',
        DISCORD_CLIENT_SECRET: '',
        SESSION_SECRET: 'short',
        API_SECRET: '',
      },
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (code !== 1) {
        return reject(new Error(`Eksik ENV ile sunucu çıkış kodu 1 olmalıydı, alınan: ${code}`));
      }
      if (
        !stderr.includes('DISCORD_CLIENT_ID') ||
        !stderr.includes('DISCORD_CLIENT_SECRET') ||
        !stderr.includes('SESSION_SECRET') ||
        !stderr.includes('API_SECRET')
      ) {
        return reject(new Error(`Eksik ENV hata çıktısı beklenen değişken adlarını içermiyor:\n${stderr}`));
      }
      if (stderr.includes('short')) {
        return reject(new Error('Güvenlik İhlali: Hatalı SESSION_SECRET değeri loglara yazıldı!'));
      }
      console.log('✅ Eksik ENV durumunda yalnızca değişken adları loglandı ve kod 1 ile güvenli çıkış yapıldı.');
      resolve();
    });
  });
}

function verifySessionStoreVolumePath() {
  logStep('4/5', 'Oturum deposu (services/sessionStore.js) RAILWAY_VOLUME_MOUNT_PATH kontrolü yapılıyor...');
  const PersistentSessionStore = require(path.join(ROOT_DIR, 'services', 'sessionStore'));

  const railwayResolved = PersistentSessionStore.resolveDefaultDir({
    RAILWAY_VOLUME_MOUNT_PATH: '/data/railway-volume',
  });
  const expectedRailwayPath = path.join('/data/railway-volume', 'sessions');
  if (railwayResolved !== expectedRailwayPath) {
    throw new Error(`Beklenen Volume yolu "${expectedRailwayPath}", alınan: "${railwayResolved}"`);
  }

  const localResolved = PersistentSessionStore.resolveDefaultDir({});
  const expectedLocalPath = path.join( process.cwd(), '.sessions');
  if (localResolved !== expectedLocalPath) {
    throw new Error(`Beklenen yerel yol "${expectedLocalPath}", alınan: "${localResolved}"`);
  }

  console.log(`✅ RAILWAY_VOLUME_MOUNT_PATH aktifken oturum yolu: ${railwayResolved}`);
  console.log(`✅ RAILWAY_VOLUME_MOUNT_PATH yokken yerel oturum yolu: ${localResolved}`);
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('HTTP GET zaman aşımı (5000ms)'));
    });
  });
}

function verifyServerStartupWithFakeEnv() {
  logStep('5/5', 'Sahte (FAKE) ortam değişkenleriyle "node server.js" başlatılıyor ve GET / 200 OK doğrulanıyor...');
  const tempVolumeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-vol-'));
  const testPort = 3099;

  return new Promise((resolve, reject) => {
    const fakeEnv = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_ENV: 'production',
      PORT: String(testPort),
      BASE_URL: `http://localhost:${testPort}`,
      BOT_API_URL: 'http://localhost:3098',
      DISCORD_CLIENT_ID: '123456789012345678',
      DISCORD_CLIENT_SECRET: 'fake_discord_client_secret_for_clean_verify',
      SESSION_SECRET: 'fake_session_secret_minimum_16_characters_long',
      API_SECRET: 'fake_bot_api_secret_for_clean_verify',
      RAILWAY_VOLUME_MOUNT_PATH: tempVolumeDir,
    };

    const serverProc = spawn(process.execPath, [SERVER_PATH], {
      cwd: ROOT_DIR,
      env: fakeEnv,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const cleanup = () => {
      try {
        serverProc.kill('SIGTERM');
      } catch (_) {}
      try {
        fs.rmSync(tempVolumeDir, { recursive: true, force: true });
      } catch (_) {}
    };

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Sunucu 10 saniye içinde açılmadı.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    }, 10000);

    serverProc.stdout.on('data', async (chunk) => {
      stdout += chunk.toString();
      if (!settled && stdout.includes(`http://localhost:${testPort}`)) {
        try {
          const homeRes = await httpGet(`http://localhost:${testPort}/`);
          const healthRes = await httpGet(`http://localhost:${testPort}/health`);

          if (homeRes.statusCode !== 200) {
            throw new Error(`GET / beklenen 200, alınan: ${homeRes.statusCode}`);
          }
          if (healthRes.statusCode !== 200) {
            throw new Error(`GET /health beklenen 200, alınan: ${healthRes.statusCode}`);
          }

          const expectedSessionDir = path.join(tempVolumeDir, 'sessions');
          if (!fs.existsSync(expectedSessionDir)) {
            throw new Error(`Volume oturum klasörü oluşturulmadı: ${expectedSessionDir}`);
          }

          settled = true;
          clearTimeout(timeoutId);
          console.log(`✅ Sunucu açıldı (PID: ${serverProc.pid})`);
          console.log(`✅ GET http://localhost:${testPort}/ -> HTTP ${homeRes.statusCode} OK (${homeRes.body.length} byte)`);
          console.log(`✅ GET http://localhost:${testPort}/health -> HTTP ${healthRes.statusCode} OK`);
          console.log(`✅ Railway Volume oturum klasörü doğrulandı: ${expectedSessionDir}`);
          cleanup();
          resolve();
        } catch (err) {
          settled = true;
          clearTimeout(timeoutId);
          cleanup();
          reject(err);
        }
      }
    });

    serverProc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    serverProc.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        cleanup();
        reject(new Error(`Sunucu beklenmedik şekilde kapandı (kod: ${code}).\nSTDERR:\n${stderr}`));
      }
    });
  });
}

(async () => {
  try {
    console.log('================================================================');
    console.log('🚀 PIYADE TEAM | RAILWAY TEMİZ KURULUM DOĞRULAMA TESTİ (verify:clean)');
    console.log('================================================================');
    verifyDependenciesInPackageJson();
    runCleanInstall();
    await verifyMissingEnvBehavior();
    verifySessionStoreVolumePath();
    await verifyServerStartupWithFakeEnv();
    console.log('\n================================================================');
    console.log('🎉 TÜM KONTROLLER BAŞARIYLA GEÇTİ! (verify:clean: BAŞARILI)');
    console.log('================================================================');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ [verify:clean BAŞARISIZ]:', err.message || err);
    process.exit(1);
  }
})();
