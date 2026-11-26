/**
 * ==============================================================================
 * 🌐 PIYADE WORLD — SİTE (GOOGLE) ÜYELERİNE UYARI VERME & SİCİL ÖNİZLEME İSTEMCİSİ
 * ==============================================================================
 * - Mevcut Discord Uyarı Ver formundan (adminWarnForm) tamamen bağımsız çalışır.
 * - Yalnızca Google (site) üyelerini arar (/yonetim/site-uyari/api/uyeler).
 * - Seçili üyenin altında sicil önizlemesi (toplam puan, kademe, aktif yaptırım,
 *   son 10 kayıt ve gerekçe zorunlu "İptal Et" işlemi) gösterir.
 * - Sıfır innerHTML (tüm kullanıcı/kayıt verileri textContent ile oluşturulur).
 * - Sıfır sabit #hex renk (tüm renkler theme.css değişkenlerinden).
 * ==============================================================================
 */
(function () {
  'use strict';

  const section = document.getElementById('site-uyari-paneli');
  const form = document.getElementById('siteAdminWarnForm');
  if (!section || !form) return;

  const lang = document.body.getAttribute('data-lang') === 'en' ? 'en' : 'tr';
  const localeTag = lang === 'en' ? 'en-US' : 'tr-TR';

  let i18n = {};
  try {
    i18n = JSON.parse(section.getAttribute('data-site-warn-i18n') || '{}');
  } catch (_) {
    i18n = {};
  }

  const csrfToken = (form.querySelector('input[name="_csrf"]') || {}).value || '';
  const searchInput = document.getElementById('siteWarnMemberSearch');
  const resultsBox = document.getElementById('siteWarnMemberResults');
  const targetInput = document.getElementById('siteTargetMemberId');
  const selectedBadge = document.getElementById('siteSelectedMemberBadge');
  const historyBox = document.getElementById('siteMemberHistoryBox');
  const officialFields = document.getElementById('siteOfficialRuleFields');
  const ruleSelect = document.getElementById('siteRuleCodeSelect');
  const rulePreviewBox = document.getElementById('siteRulePreviewBox');
  const reasonInput = document.getElementById('siteWarnReason');
  const reasonReqMark = document.getElementById('siteReasonRequiredMark');
  const errorBanner = document.getElementById('siteWarnErrorBanner');
  const errorText = document.getElementById('siteWarnErrorText');

  const cancelModal = document.getElementById('siteWarnCancelModal');
  const cancelForm = document.getElementById('siteWarnCancelForm');
  const cancelWarnIdLabel = document.getElementById('siteWarnCancelIdLabel');
  const cancelReasonInput = document.getElementById('siteWarnCancelReasonInput');
  const cancelErrorEl = document.getElementById('siteWarnCancelError');
  const cancelCloseBtn = document.getElementById('siteWarnCancelCloseBtn');
  const cancelDismissBtn = document.getElementById('siteWarnCancelDismissBtn');
  const cancelSubmitBtn = document.getElementById('siteWarnCancelSubmitBtn');

  let rulesDict = {};
  try {
    rulesDict = JSON.parse((ruleSelect && ruleSelect.getAttribute('data-rules')) || '{}');
  } catch (_) {
    rulesDict = {};
  }

  let searchTimer = null;
  let activeCancelWarnId = null;
  let currentSelectedMemberId = (targetInput && targetInput.value) || '';

  function formatDateTime(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString(localeTag, { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) {
      return '';
    }
  }

  function showPanelError(msg) {
    if (!errorBanner || !errorText) return;
    errorText.textContent = msg || i18n.errGeneric || 'Bir hata oluştu.';
    errorBanner.hidden = false;
  }

  function hidePanelError() {
    if (errorBanner) errorBanner.hidden = true;
  }

  function statusLabel(status) {
    if (status === 'banned') return i18n.statusBanned || 'Yasaklı';
    if (status === 'suspended') return i18n.statusSuspended || 'Askıda';
    return i18n.statusActive || 'Aktif';
  }

  function statusBadgeClass(status) {
    if (status === 'banned') return 'badge-danger';
    if (status === 'suspended') return 'badge-warning';
    return 'badge-success';
  }

  function sanctionSummaryText(sanction) {
    if (!sanction) return i18n.noActiveSanction || 'Yok';
    const until = sanction.expiresAt ? ` (${formatDateTime(sanction.expiresAt)})` : '';
    if (sanction.kind === 'permanent_ban') return i18n.sanctionPermanentBan || 'Kalıcı Hesap Yasağı';
    if (sanction.kind === 'account_suspend') return `${i18n.sanctionSuspended || 'Hesap Askıda'}${until}`;
    if (sanction.kind === 'chat_mute') return `${i18n.sanctionChatMute || 'Sohbet Susturma'}${until}`;
    return i18n.noActiveSanction || 'Yok';
  }

  // ==========================================================================
  // 1) ARAMALI GOOGLE ÜYE SEÇİCİ
  // ==========================================================================
  function renderSelectedChip(member) {
    if (!selectedBadge) return;
    selectedBadge.replaceChildren();
    if (!member) return;

    const chip = document.createElement('div');
    chip.className = 'site-warn-selected-chip';

    const left = document.createElement('div');
    left.className = 'site-warn-selected-chip-main';
    const prefix = document.createElement('span');
    prefix.textContent = `${i18n.selectedPrefix || 'Seçilen:'} `;
    const strong = document.createElement('strong');
    strong.textContent = member.displayName || member.nickname || member.id;
    const code = document.createElement('code');
    code.textContent = member.id;
    const stBadge = document.createElement('span');
    stBadge.className = `badge ${statusBadgeClass(member.status)}`;
    stBadge.textContent = statusLabel(member.status);

    left.append(prefix, strong, document.createTextNode(' ('), code, document.createTextNode(') '), stBadge);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-secondary btn-xs';
    clearBtn.textContent = '✕';
    clearBtn.title = i18n.clearSelection || 'Seçimi temizle';
    clearBtn.addEventListener('click', () => {
      currentSelectedMemberId = '';
      if (targetInput) targetInput.value = '';
      if (searchInput) searchInput.value = '';
      selectedBadge.replaceChildren();
      if (historyBox) {
        historyBox.hidden = true;
        historyBox.replaceChildren();
      }
    });

    chip.append(left, clearBtn);
    selectedBadge.appendChild(chip);
  }

  function renderSearchResults(members) {
    if (!resultsBox) return;
    resultsBox.replaceChildren();

    if (!Array.isArray(members) || members.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'site-warn-search-empty';
      empty.textContent = i18n.noMembersFound || 'Eşleşen site üyesi bulunamadı.';
      resultsBox.appendChild(empty);
      resultsBox.hidden = false;
      return;
    }

    for (const m of members) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'site-warn-search-item';

      const top = document.createElement('div');
      top.className = 'site-warn-search-item-top';

      const nameEl = document.createElement('strong');
      nameEl.textContent = m.displayName || m.nickname || m.id;

      const badges = document.createElement('span');
      badges.className = 'site-warn-search-item-badges';
      const siteBadge = document.createElement('span');
      siteBadge.className = 'chat-identity-badge chat-identity-badge--site';
      siteBadge.textContent = i18n.siteMemberBadge || 'Site Üyesi';
      const stBadge = document.createElement('span');
      stBadge.className = `badge ${statusBadgeClass(m.status)}`;
      stBadge.textContent = statusLabel(m.status);
      badges.append(siteBadge, stBadge);
      top.append(nameEl, badges);

      const meta = document.createElement('div');
      meta.className = 'site-warn-search-item-meta';
      const gamesSummary =
        Array.isArray(m.games) && m.games.length > 0
          ? m.games.map((g) => `${g.id}: ${g.username}`).join(' • ')
          : '';
      meta.textContent = [
        `ID: ${m.id}`,
        `${m.totalPoints || 0} ${i18n.pointsWord || 'Puan'}`,
        gamesSummary,
      ]
        .filter(Boolean)
        .join(' • ');

      item.append(top, meta);
      item.addEventListener('click', () => {
        selectMember(m);
      });
      resultsBox.appendChild(item);
    }
    resultsBox.hidden = false;
  }

  async function runMemberSearch(query) {
    try {
      const resp = await fetch(`/yonetim/site-uyari/api/uyeler?q=${encodeURIComponent(query)}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data && data.ok) {
        renderSearchResults(data.members || []);
      }
    } catch (_) {}
  }

  function selectMember(member) {
    if (!member || !member.id) return;
    currentSelectedMemberId = member.id;
    if (targetInput) targetInput.value = member.id;
    if (searchInput) searchInput.value = `${member.displayName || member.nickname} (${member.id})`;
    if (resultsBox) resultsBox.hidden = true;
    renderSelectedChip(member);
    loadMemberHistory(member.id);
  }

  if (searchInput) {
    searchInput.addEventListener('focus', () => {
      if (!currentSelectedMemberId) {
        runMemberSearch(searchInput.value.trim());
      }
    });
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      searchTimer = setTimeout(() => runMemberSearch(q), 200);
    });
  }

  document.addEventListener('click', (ev) => {
    if (resultsBox && searchInput && !resultsBox.contains(ev.target) && !searchInput.contains(ev.target)) {
      resultsBox.hidden = true;
    }
  });

  // ==========================================================================
  // 2) SEÇİLİ ÜYE SİCİL ÖNİZLEMESİ (Toplam puan, kademe, aktif yaptırım, son 10 kayıt)
  // ==========================================================================
  function renderMemberHistory(payload) {
    if (!historyBox) return;
    historyBox.replaceChildren();
    if (!payload || !payload.member || !payload.summary) {
      historyBox.hidden = true;
      return;
    }

    const { member, summary, records = [] } = payload;
    renderSelectedChip(member);

    const wrap = document.createElement('div');
    wrap.className = 'site-warn-history-card';

    const header = document.createElement('div');
    header.className = 'site-warn-history-head';
    const title = document.createElement('h3');
    title.className = 'site-warn-history-title';
    title.textContent = `📋 ${i18n.historyTitle || 'Üye Sicil Önizlemesi'} — ${member.displayName || member.nickname}`;
    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'btn btn-secondary btn-xs';
    refreshBtn.textContent = `🔄 ${i18n.refreshBtn || 'Yenile'}`;
    refreshBtn.addEventListener('click', () => loadMemberHistory(member.id));
    header.append(title, refreshBtn);

    const statsGrid = document.createElement('div');
    statsGrid.className = 'site-warn-stats-grid';

    const addStat = (label, value, badgeCls = '') => {
      const box = document.createElement('div');
      box.className = 'site-warn-stat-box';
      const lbl = document.createElement('span');
      lbl.className = 'site-warn-stat-label';
      lbl.textContent = label;
      const val = document.createElement('div');
      val.className = 'site-warn-stat-val';
      if (badgeCls) {
        const b = document.createElement('span');
        b.className = `badge ${badgeCls}`;
        b.textContent = value;
        val.appendChild(b);
      } else {
        val.textContent = value;
      }
      box.append(lbl, val);
      statsGrid.appendChild(box);
    };

    addStat(i18n.statTotalPoints || 'Toplam Puan', `${summary.totalPoints || 0} ${i18n.pointsWord || 'Puan'}`);
    addStat(i18n.statTier || 'Kademe', summary.tierLabel || `Uyarı ${summary.tier || 0}`, summary.tier >= 4 ? 'badge-danger' : summary.tier >= 1 ? 'badge-warning' : 'badge-success');
    addStat(i18n.statStatus || 'Hesap Durumu', statusLabel(summary.status), statusBadgeClass(summary.status));
    addStat(i18n.statActiveSanction || 'Aktif Yaptırım', sanctionSummaryText(summary.activeSanction));

    wrap.append(header, statsGrid);

    const listTitle = document.createElement('div');
    listTitle.className = 'site-warn-records-heading';
    listTitle.textContent = `${i18n.recentRecordsTitle || 'Son 10 Kayıt'} (${summary.totalRecordsCount || 0})`;
    wrap.appendChild(listTitle);

    if (!Array.isArray(records) || records.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'site-warn-records-empty';
      empty.textContent = i18n.noRecordsYet || 'Bu üyenin henüz uyarı kaydı bulunmuyor.';
      wrap.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'site-warn-records-list';

      for (const r of records) {
        const row = document.createElement('article');
        row.className = `site-warn-record-row${r.cancelled ? ' is-cancelled' : ''}${r.pardonedAt ? ' is-pardoned' : ''}`;

        const top = document.createElement('div');
        top.className = 'site-warn-record-top';

        const metaLeft = document.createElement('div');
        metaLeft.className = 'site-warn-record-badges';

        const idCode = document.createElement('code');
        idCode.className = 'site-warn-record-id';
        idCode.textContent = r.id;

        const typeBadge = document.createElement('span');
        typeBadge.className = r.type === 'verbal' ? 'badge badge-warning' : 'badge badge-danger';
        typeBadge.textContent =
          r.type === 'verbal'
            ? i18n.typeVerbal || 'Sözlü Uyarı'
            : `${r.ruleCode || ''} ${r.ruleTitle ? `— ${r.ruleTitle}` : ''}`.trim();

        const ptsBadge = document.createElement('span');
        ptsBadge.className = 'badge badge-neutral';
        ptsBadge.textContent = `+${r.pointsAdded || 0} ${i18n.pointsWord || 'Puan'}`;

        metaLeft.append(idCode, typeBadge, ptsBadge);

        if (r.cancelled) {
          const cb = document.createElement('span');
          cb.className = 'badge badge-info';
          cb.textContent = i18n.recordCancelledBadge || 'İptal Edildi';
          metaLeft.appendChild(cb);
        } else if (r.pardonedAt) {
          const pb = document.createElement('span');
          pb.className = 'badge badge-success';
          pb.textContent = i18n.recordPardonedBadge || '30 Gün Af';
          metaLeft.appendChild(pb);
        }

        const dateEl = document.createElement('span');
        dateEl.className = 'site-warn-record-date';
        dateEl.textContent = `${formatDateTime(r.createdAt)} • ${r.actorName || ''}`;

        top.append(metaLeft, dateEl);

        const body = document.createElement('div');
        body.className = 'site-warn-record-body';

        if (r.sanctionLabel) {
          const sancLine = document.createElement('div');
          sancLine.className = 'site-warn-record-sanction';
          sancLine.textContent = `⚡ ${r.sanctionLabel}${r.sanctionExpiresAt ? ` (${i18n.expiresShort || 'Bitiş'}: ${formatDateTime(r.sanctionExpiresAt)})` : ''}`;
          body.appendChild(sancLine);
        }

        if (r.reason) {
          const rLine = document.createElement('p');
          rLine.className = 'site-warn-record-reason';
          rLine.textContent = `📝 ${r.reason}`;
          body.appendChild(rLine);
        }

        if (r.cancelled && r.cancelReason) {
          const cLine = document.createElement('p');
          cLine.className = 'site-warn-record-cancel-note';
          cLine.textContent = `↩️ ${i18n.cancelReasonPrefix || 'İptal gerekçesi'}: ${r.cancelReason} (${r.cancelledByName || ''})`;
          body.appendChild(cLine);
        }

        const foot = document.createElement('div');
        foot.className = 'site-warn-record-foot';

        const proofWrap = document.createElement('div');
        proofWrap.className = 'site-warn-record-proofs';
        if (r.evidenceFileUrl) {
          const a = document.createElement('a');
          a.href = r.evidenceFileUrl;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.className = 'site-warn-evidence-link';
          a.textContent = `📎 ${i18n.viewEvidenceFile || 'Kanıt Dosyasını Aç'}`;
          proofWrap.appendChild(a);
        }
        if (r.evidenceUrl) {
          const a2 = document.createElement('a');
          a2.href = r.evidenceUrl;
          a2.target = '_blank';
          a2.rel = 'noopener noreferrer';
          a2.className = 'site-warn-evidence-link';
          a2.textContent = `🔗 ${i18n.viewEvidenceUrl || 'Kanıt Bağlantısı'}`;
          proofWrap.appendChild(a2);
        }

        foot.appendChild(proofWrap);

        if (!r.cancelled) {
          const cancelBtn = document.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.className = 'btn btn-secondary btn-xs site-warn-cancel-btn';
          cancelBtn.textContent = `↩️ ${i18n.cancelBtn || 'İptal Et'}`;
          cancelBtn.addEventListener('click', () => openCancelModal(r.id));
          foot.appendChild(cancelBtn);
        }

        row.append(top, body, foot);
        list.appendChild(row);
      }

      wrap.appendChild(list);
    }

    historyBox.appendChild(wrap);
    historyBox.hidden = false;
  }

  async function loadMemberHistory(memberId) {
    if (!memberId || !historyBox) return;
    historyBox.hidden = false;
    historyBox.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'site-warn-history-loading';
    loading.textContent = i18n.loadingHistory || 'Sicil yükleniyor…';
    historyBox.appendChild(loading);

    try {
      const resp = await fetch(`/yonetim/site-uyari/api/uye/${encodeURIComponent(memberId)}/sicil`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const data = await resp.json();
      if (!resp.ok || !data || !data.ok) {
        historyBox.replaceChildren();
        showPanelError((data && data.error) || i18n.errGeneric);
        return;
      }
      renderMemberHistory(data);
    } catch (_) {
      historyBox.replaceChildren();
      showPanelError(i18n.errGeneric || 'Sicil bilgisi alınamadı.');
    }
  }

  // ==========================================================================
  // 3) CEZA TÜRÜ (RESMİ / SÖZLÜ) VE KURAL ÖNİZLEME
  // ==========================================================================
  function syncPenaltyTypeUI() {
    const checked = form.querySelector('input[name="siteWarnType"]:checked');
    const isVerbal = checked && checked.value === 'verbal';
    if (officialFields) officialFields.hidden = Boolean(isVerbal);
    if (ruleSelect) ruleSelect.required = !isVerbal;
    if (reasonInput) reasonInput.required = Boolean(isVerbal);
    if (reasonReqMark) reasonReqMark.hidden = !isVerbal;
  }

  form.querySelectorAll('input[name="siteWarnType"]').forEach((r) => {
    r.addEventListener('change', syncPenaltyTypeUI);
  });
  syncPenaltyTypeUI();

  function renderRulePreview(code) {
    if (!rulePreviewBox) return;
    rulePreviewBox.replaceChildren();
    const rule = rulesDict[code];
    if (!rule) {
      rulePreviewBox.hidden = true;
      return;
    }

    const box = document.createElement('div');
    box.className = 'site-warn-rule-preview';

    const top = document.createElement('div');
    top.className = 'site-warn-rule-preview-top';

    const codeBadge = document.createElement('span');
    codeBadge.className = `badge ${rule.badgeClass || 'badge-warning'}`;
    codeBadge.textContent = rule.code;

    const titleEl = document.createElement('strong');
    titleEl.textContent = rule.title || rule.code;

    const penBadge = document.createElement('span');
    penBadge.className = 'badge badge-danger site-warn-rule-penalty';
    penBadge.textContent = rule.sitePenaltyLabel || rule.penaltyLabel || '';

    top.append(codeBadge, titleEl, penBadge);

    const desc = document.createElement('p');
    desc.className = 'site-warn-rule-desc';
    desc.textContent = rule.description || '';

    box.append(top, desc);
    rulePreviewBox.appendChild(box);
    rulePreviewBox.hidden = false;
  }

  if (ruleSelect) {
    ruleSelect.addEventListener('change', () => renderRulePreview(ruleSelect.value));
  }

  // Form istemci tarafı ön doğrulaması (seçili üye ve sözlü gerekçe)
  form.addEventListener('submit', (ev) => {
    hidePanelError();
    if (!targetInput || !targetInput.value.trim()) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      showPanelError(i18n.errSelectMember || 'Lütfen listeden bir site (Google) üyesi seçin.');
      if (searchInput) searchInput.focus();
      return;
    }
    const checked = form.querySelector('input[name="siteWarnType"]:checked');
    const isVerbal = checked && checked.value === 'verbal';
    if (isVerbal && reasonInput && reasonInput.value.trim().length < 3) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      showPanelError(i18n.errVerbalReason || 'Sözlü uyarıda gerekçe yazmak zorunludur.');
      reasonInput.focus();
      return;
    }
    if (!isVerbal && ruleSelect && !ruleSelect.value) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      showPanelError(i18n.errSelectRule || 'Lütfen ihlal edilen kural maddesini seçin.');
      ruleSelect.focus();
    }
  }, true);

  // ==========================================================================
  // 4) İPTAL ET MODALI (Gerekçe Zorunlu)
  // ==========================================================================
  function openCancelModal(warnId) {
    if (!cancelModal) return;
    activeCancelWarnId = warnId;
    if (cancelWarnIdLabel) cancelWarnIdLabel.textContent = warnId;
    if (cancelReasonInput) cancelReasonInput.value = '';
    if (cancelErrorEl) {
      cancelErrorEl.textContent = '';
      cancelErrorEl.hidden = true;
    }
    cancelModal.hidden = false;
    cancelModal.setAttribute('aria-hidden', 'false');
    if (cancelReasonInput) cancelReasonInput.focus();
  }

  function closeCancelModal() {
    if (!cancelModal) return;
    activeCancelWarnId = null;
    cancelModal.hidden = true;
    cancelModal.setAttribute('aria-hidden', 'true');
  }

  if (cancelCloseBtn) cancelCloseBtn.addEventListener('click', closeCancelModal);
  if (cancelDismissBtn) cancelDismissBtn.addEventListener('click', closeCancelModal);
  if (cancelModal) {
    cancelModal.addEventListener('click', (ev) => {
      if (ev.target === cancelModal) closeCancelModal();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !cancelModal.hidden) closeCancelModal();
    });
  }

  if (cancelForm) {
    cancelForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!activeCancelWarnId) return;
      const reasonVal = (cancelReasonInput && cancelReasonInput.value.trim()) || '';
      if (reasonVal.length < 3) {
        if (cancelErrorEl) {
          cancelErrorEl.textContent = i18n.errCancelReason || 'İptal gerekçesi en az 3 karakter olmalıdır.';
          cancelErrorEl.hidden = false;
        }
        return;
      }

      if (cancelSubmitBtn) cancelSubmitBtn.disabled = true;
      if (cancelErrorEl) cancelErrorEl.hidden = true;

      try {
        const resp = await fetch(`/yonetim/site-uyari/${encodeURIComponent(activeCancelWarnId)}/iptal`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CSRF-Token': csrfToken,
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({ _csrf: csrfToken, cancelReason: reasonVal }),
        });
        const data = await resp.json();
        if (!resp.ok || !data || !data.ok) {
          if (cancelErrorEl) {
            cancelErrorEl.textContent = (data && data.error) || i18n.errGeneric || 'İptal işlemi başarısız.';
            cancelErrorEl.hidden = false;
          }
          return;
        }
        closeCancelModal();
        if (currentSelectedMemberId) {
          await loadMemberHistory(currentSelectedMemberId);
        }
      } catch (_) {
        if (cancelErrorEl) {
          cancelErrorEl.textContent = i18n.errGeneric || 'İptal işlemi sırasında ağ hatası oluştu.';
          cancelErrorEl.hidden = false;
        }
      } finally {
        if (cancelSubmitBtn) cancelSubmitBtn.disabled = false;
      }
    });
  }

  // Sayfa ?siteTargetId=... ile açıldıysa üyenin sicil önizlemesini hemen getir
  if (currentSelectedMemberId) {
    loadMemberHistory(currentSelectedMemberId);
  }
})();
