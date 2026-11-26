/**
 * ==============================================================================
 * 🔔 PIYADE WORLD — SİTE (GOOGLE) ÜYESİ UYARI BİLDİRİM KARTI (SSR + CANLI SSE)
 * ==============================================================================
 * - Sunucu tarafından basılan kapatılabilir bildirim kartlarını yönetir.
 * - Üye siteyi kullanırken canlı SSE (piyade:site-warning veya /api/uyari-bildirimleri/akis)
 *   ile gelen yeni uyarı/yaptırım bildirimlerini anında ekranda gösterir.
 * - Kanıt dosyaları/bağlantıları hiçbir zaman üyeye gösterilmez.
 * - Sıfır innerHTML, tüm alanlar textContent ile güvenli oluşturulur.
 * ==============================================================================
 */
(function () {
  'use strict';

  const container = document.getElementById('siteWarningNoticesContainer');
  if (!container) return;

  const lang = container.getAttribute('data-lang') === 'en' ? 'en' : 'tr';
  const localeTag = lang === 'en' ? 'en-US' : 'tr-TR';
  const csrfToken = container.getAttribute('data-csrf') || '';
  let i18n = {};
  try {
    i18n = JSON.parse(container.getAttribute('data-i18n') || '{}');
  } catch (_) {
    i18n = {};
  }

  function refreshVisibility() {
    const hasCards = Boolean(container.querySelector('.site-warn-notice-card'));
    container.hidden = !hasCards;
  }

  async function dismissNotice(noticeId, cardEl, btnEl) {
    if (!noticeId) return;
    if (btnEl) btnEl.disabled = true;
    try {
      const resp = await fetch(`/api/uyari-bildirimleri/${encodeURIComponent(noticeId)}/kapat`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRF-Token': csrfToken,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ _csrf: csrfToken }),
      });
      if (resp.ok || resp.status === 404) {
        if (cardEl) cardEl.remove();
        refreshVisibility();
        return;
      }
    } catch (_) {}
    if (btnEl) btnEl.disabled = false;
  }

  function buildNoticeCardEl(n) {
    if (!n || !n.id) return null;
    const isVerbal = n.type === 'verbal';
    const ruleTitle = lang === 'en' ? n.ruleTitleEn || n.ruleTitleTr || '' : n.ruleTitleTr || '';
    const sanctionLabel =
      lang === 'en' ? n.sanctionLabelEn || n.sanctionLabelTr || '' : n.sanctionLabelTr || '';
    const expiresText = n.sanctionExpiresAt
      ? new Date(n.sanctionExpiresAt).toLocaleString(localeTag, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '';

    const severityClass =
      n.sanctionKind === 'account_suspend' || n.sanctionKind === 'permanent_ban'
        ? 'site-warn-notice-card--danger'
        : n.sanctionKind === 'chat_mute'
          ? 'site-warn-notice-card--warning'
          : isVerbal
            ? 'site-warn-notice-card--info'
            : 'site-warn-notice-card--warning';

    const card = document.createElement('article');
    card.className = `glass-card site-warn-notice-card ${severityClass}`;
    card.setAttribute('data-notice-id', String(n.id));

    const head = document.createElement('div');
    head.className = 'site-warn-notice-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'site-warn-notice-title-wrap';
    const icon = document.createElement('span');
    icon.className = 'site-warn-notice-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = isVerbal ? '🗣️' : '⚠️';

    const titleCol = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.className = 'site-warn-notice-heading';
    h2.textContent = isVerbal
      ? i18n.headingVerbal || 'Sözlü Uyarı Bildirimi'
      : i18n.headingOfficial || 'Resmi Uyarı Bildirimi';

    const sub = document.createElement('div');
    sub.className = 'site-warn-notice-sub';
    if (n.ruleCode) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-danger';
      badge.textContent = String(n.ruleCode);
      const tSpan = document.createElement('span');
      tSpan.textContent = ruleTitle;
      sub.append(badge, tSpan);
    } else {
      const badge = document.createElement('span');
      badge.className = 'badge badge-warning';
      badge.textContent = i18n.verbalRuleFallback || 'Sözlü Uyarı';
      sub.appendChild(badge);
    }
    titleCol.append(h2, sub);
    titleWrap.append(icon, titleCol);

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'btn btn-secondary btn-xs site-warn-notice-dismiss-btn';
    dismissBtn.setAttribute('data-dismiss-notice-id', String(n.id));
    dismissBtn.setAttribute('aria-label', i18n.dismissBtn || 'Anladım / Kapat');
    dismissBtn.textContent = `✕ ${i18n.dismissBtn || 'Anladım / Kapat'}`;
    dismissBtn.addEventListener('click', () => dismissNotice(n.id, card, dismissBtn));

    head.append(titleWrap, dismissBtn);

    const grid = document.createElement('div');
    grid.className = 'site-warn-notice-grid';

    const addField = (labelText, valueText) => {
      const box = document.createElement('div');
      box.className = 'site-warn-notice-field';
      const lbl = document.createElement('span');
      lbl.className = 'site-warn-notice-label';
      lbl.textContent = labelText;
      const val = document.createElement('p');
      val.className = 'site-warn-notice-value';
      val.textContent = valueText;
      box.append(lbl, val);
      grid.appendChild(box);
    };

    addField(i18n.reasonLabel || 'Gerekçe', n.reason || i18n.noReasonFallback || '-');
    addField(
      i18n.pointsLabel || 'Verilen Puan',
      `+${Number(n.pointsAdded) || 0} ${i18n.pointsWord || 'Puan'} (${Number(n.totalPoints) || 0})`
    );
    addField(i18n.sanctionLabel || 'Yaptırım', sanctionLabel || '-');
    if (expiresText) {
      addField(i18n.expiresLabel || 'Bitiş Tarihi', expiresText);
    }

    const foot = document.createElement('div');
    foot.className = 'site-warn-notice-foot';
    const rulesA = document.createElement('a');
    rulesA.href = '/kurallar';
    rulesA.className = 'site-warn-notice-rules-link';
    rulesA.textContent = `📜 ${i18n.rulesLink || 'Genel Kurallar'}`;
    foot.appendChild(rulesA);

    card.append(head, grid, foot);
    return card;
  }

  function showLiveNotice(notice) {
    if (!notice || !notice.id) return;
    if (container.querySelector(`[data-notice-id="${CSS.escape(String(notice.id))}"]`)) return;
    const card = buildNoticeCardEl(notice);
    if (!card) return;
    container.prepend(card);
    refreshVisibility();
  }

  // Sunucu tarafından basılmış mevcut kapat düğmelerini bağla
  container.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-dismiss-notice-id]');
    if (!btn) return;
    const nid = btn.getAttribute('data-dismiss-notice-id');
    const card = btn.closest('.site-warn-notice-card');
    dismissNotice(nid, card, btn);
  });

  // chat.js veya chat-badge.js SSE bağlantısından iletilen canlı uyarı olayları
  window.addEventListener('piyade:site-warning', (ev) => {
    if (ev && ev.detail) {
      showLiveNotice(ev.detail);
    }
  });

  window.addEventListener('piyade:account-suspended', (ev) => {
    const target = (ev && ev.detail && ev.detail.redirectUrl) || '/giris/askida';
    if (window.location.pathname !== target) {
      window.location.assign(target);
    }
  });

  // Sohbet SSE'si aktif olmayacaksa hafif bildirim SSE akışına bağlan
  const chatSseExpected = container.getAttribute('data-chat-sse-expected') === '1';
  let fallbackSse = null;
  if (!chatSseExpected && typeof window.EventSource === 'function') {
    try {
      fallbackSse = new EventSource('/api/uyari-bildirimleri/akis');
      fallbackSse.addEventListener('site_warning', (ev) => {
        try {
          showLiveNotice(JSON.parse(ev.data || '{}'));
        } catch (_) {}
      });
      fallbackSse.addEventListener('account_suspended', (ev) => {
        try {
          const d = JSON.parse(ev.data || '{}');
          if (window.location.pathname !== (d.redirectUrl || '/giris/askida')) {
            window.location.assign(d.redirectUrl || '/giris/askida');
          }
        } catch (_) {}
      });
      fallbackSse.addEventListener('disconnect', () => {
        if (fallbackSse) fallbackSse.close();
      });
    } catch (_) {}
  }

  window.addEventListener('beforeunload', () => {
    if (fallbackSse) fallbackSse.close();
  });
})();
