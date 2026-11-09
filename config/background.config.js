/**
 * ==============================================================================
 * 🌌 AERO SHARDS PARAMETRİK ARKA PLAN YAPILANDIRMASI (BACKGROUND.CONFIG.JS)
 * ==============================================================================
 * Tüm Aero Shards görsel, fizik, etkileşim ve performans parametreleri tek bir
 * merkezden yönetilir. Renkler doğrudan public/css/theme.css içindeki CSS
 * değişkenlerinden okunur (sabit renk kodu yazılmaz).
 *
 * Geliştirme / test ortamında URL sorgu parametreleriyle canlı deneme yapılabilir:
 *   ?bg=vortex&finish=chrome
 *   ?bg=ribbon&finish=satin&mode=attract&tier=high
 *   ?bg=stream&finish=pearl&markers=dots&count=1300
 * ==============================================================================
 */

const BACKGROUND_CONFIG = {
  // 1. DİZİLİM VE YERLEŞİM (Arrangement & Placement)
  // arrangement seçenekleri: 'stream' (akış/full), 'vortex' (girdap/center), 'ribbon' (kurdele/left-right)
  // placement seçenekleri  : 'full', 'left', 'right', 'center'
  arrangement: 'stream',
  placement: 'full',

  // 2. YÜZEY STİLİ VE MATERYAL (Surface Finish & Material)
  // finish / material seçenekleri: 'pearl' (veya 'glass' — yumuşak/opal cam), 'chrome' (aynalı/keskin), 'satin' (mat-saten)
  finish: 'pearl',
  material: 'glass',

  // 3. RENK PALETİ (theme.css içindeki CSS değişken adları)
  colors: {
    shardColorVar: '--aero-shard-color',
    accentColorVar: '--aero-accent-color',
    backgroundColorVar: '--aero-bg-color',
    fallbackGradientVar: '--aero-fallback-gradient',
  },

  // 4. STUDIO GEOMETRİ, AKIŞ VE OPTİK PARAMETRELERİ (React Bits Studio)
  count: 1300,
  shardSize: 1,
  spread: 1,
  twist: 1,
  billow: 1,
  speed: 1,
  scale: 1,
  depthOfField: 0.75,
  glow: 0.35,
  grain: 0.06,
  vignette: 0.3,
  intro: true,
  lightMode: false,

  // 5. İŞARETÇİLER (Markers: 'plus' | 'dots' | 'none')
  markers: 'plus',

  // 6. İMLEÇ VE DOKUNMATİK ETKİLEŞİM (Cursor & Touch Physics)
  mouseInteraction: true,
  mouseMode: 'repel', // 'repel' (itme) | 'attract' (çekme)
  mouseStrength: 0.6,
  pulseOnClick: true, // Tıklama/dokunma dalgası (ripple) açık/kapalı
  holdToGather: true, // Basılı tutunca kıymıkları odakta toplama
  parallax: 0.5,

  // 7. ÇÖZÜNÜRLÜK VE YOĞUNLUK SEVİYELERİ (Quality Tiers & Auto-FPS)
  dpr: 2, // devicePixelRatio üst sınırı
  qualityTiers: {
    high: {
      count: 1300,
      dpr: 2,
      depthOfField: 0.75,
      glow: 0.35,
    },
    medium: {
      count: 750,
      dpr: 1.5,
      depthOfField: 0.5,
      glow: 0.28,
    },
    low: {
      count: 420,
      dpr: 1.0,
      depthOfField: 0,
      glow: 0.2,
    },
  },

  // 8. OTOMATİK PERFORMANS ÖLÇÜMÜ (Auto-Benchmark)
  performance: {
    desktopDefaultTier: 'high',
    mobileDefaultTier: 'medium',
    fpsSampleFrames: 55,
    downgradeFpsThreshold: 44,
    criticalFpsThreshold: 28,
    resizeDebounceMs: 120,
  },
};

module.exports = BACKGROUND_CONFIG;
