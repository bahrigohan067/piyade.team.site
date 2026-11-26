/**
 * ==============================================================================
 * 🍪 PIYADE WORLD — ENGELLEMEYEN ZORUNLU ÇEREZ BİLGİ ÇUBUĞU
 * ==============================================================================
 * - Yalnızca "Anladım" düğmesine basıldığında localStorage('piyade_cookie_notice_ack') = '1' yazar.
 * - Sayfayı kilitlemez; ekranın alt kısmında küçük, kapatılabilir bilgi çubuğu olarak görünür.
 * ==============================================================================
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'piyade_cookie_notice_ack';
  const bar = document.getElementById('cookieNoticeBar');
  const ackBtn = document.getElementById('cookieNoticeAckBtn');
  if (!bar || !ackBtn) return;

  let acknowledged = false;
  try {
    acknowledged = localStorage.getItem(STORAGE_KEY) === '1';
  } catch (_) {
    acknowledged = false;
  }

  if (!acknowledged) {
    bar.hidden = false;
    bar.setAttribute('aria-hidden', 'false');
  }

  ackBtn.addEventListener('click', function () {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch (_) {}
    bar.hidden = true;
    bar.setAttribute('aria-hidden', 'true');
  });
})();
