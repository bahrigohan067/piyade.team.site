/**
 * ==============================================================================
 * 🛡️ PIYADE WORLD — SOHBET MODERASYON PANELİ İSTEMCİSİ
 * ==============================================================================
 * - Yalnızca rapor/otomatik işaret vakalarını, yaptırımları ve denetim kaydını yönetir.
 * - Ekler varsayılan olarak bulanıktır ("Göstermek için tıkla") ve indirme bağlantısı sunulmaz.
 * - Tüm eylemler zorunlu not + onay penceresi + idempotent actionKey kullanır.
 * - Tüm kullanıcı metinleri textContent ile işlenir; sabit #hex renk yoktur.
 * ==============================================================================
 */
(function () {
  'use strict';

  const bootEl = document.getElementById('chatModBootstrapData');
  if (!bootEl) return;

  let boot;
  try {
    boot = JSON.parse(bootEl.textContent || '{}');
  } catch (_) {
    return;
  }

  const i18n = boot.i18n || {};
  const csrfToken = boot.csrfToken || '';
  const localeTag = boot.lang === 'en' ? 'en-US' : 'tr-TR';

  const state = {
    activeTab: boot.auditOnly ? 'audit' : 'cases',
    casesPage: 1,
    activeCase: null,
    activeSiteReportCode: null,
  };

  const els = {
    casesListView: document.getElementById('modCasesListView'),
    caseDetailView: document.getElementById('modCaseDetailView'),
    casesContainer: document.getElementById('modCasesContainer'),
    casesPager: document.getElementById('modCasesPager'),
    filterStatus: document.getElementById('modFilterStatus'),
    filterPriority: document.getElementById('modFilterPriority'),
    filterSource: document.getElementById('modFilterSource'),
    refreshCasesBtn: document.getElementById('modRefreshCasesBtn'),
    backToListBtn: document.getElementById('modBackToListBtn'),
    caseBadges: document.getElementById('modCaseBadges'),
    caseMetaBox: document.getElementById('modCaseMetaBox'),
    caseMessages: document.getElementById('modCaseMessages'),
    actionNote: document.getElementById('modActionNote'),
    actionError: document.getElementById('modActionError'),
    sanctionsContainer: document.getElementById('modSanctionsContainer'),
    auditContainer: document.getElementById('modAuditContainer'),
    siteListView: document.getElementById('modSiteReportsListView'),
    siteDetailView: document.getElementById('modSiteReportDetailView'),
    siteContainer: document.getElementById('modSiteReportsContainer'),
    siteFilterStatus: document.getElementById('modSiteFilterStatus'),
    siteFilterCategory: document.getElementById('modSiteFilterCategory'),
    siteRefreshBtn: document.getElementById('modRefreshSiteReportsBtn'),
    siteBackBtn: document.getElementById('modSiteBackBtn'),
    siteDetailBadges: document.getElementById('modSiteDetailBadges'),
    siteDetailMeta: document.getElementById('modSiteDetailMeta'),
    siteDetailBody: document.getElementById('modSiteDetailBody'),
    siteEvidenceList: document.getElementById('modSiteEvidenceList'),
    siteNotesList: document.getElementById('modSiteNotesList'),
    siteStatusSelect: document.getElementById('modSiteStatusSelect'),
    siteActionNote: document.getElementById('modSiteActionNote'),
    siteActionError: document.getElementById('modSiteActionError'),
    siteSaveBtn: document.getElementById('modSiteSaveBtn'),
    confirmModal: document.getElementById('modConfirmModal'),
    confirmDesc: document.getElementById('modConfirmDesc'),
    confirmOkBtn: document.getElementById('modConfirmOkBtn'),
    confirmCancelBtn: document.getElementById('modConfirmCancelBtn'),
    toastStack: document.getElementById('modToastStack'),
  };

  async function apiJson(url, { method = 'GET', body = null } = {}) {
    const headers = { Accept: 'application/json' };
    if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrfToken;
    const opts = { method, credentials: 'same-origin', headers };
    if (body !== null) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(url, opts);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = new Error(data.error || `HTTP ${resp.status}`);
      err.status = resp.status;
      err.code = data.code;
      throw err;
    }
    return data;
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString(localeTag, { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) {
      return '';
    }
  }

  function showToast(title, body, variant = 'info') {
    if (!els.toastStack) return;
    const el = document.createElement('div');
    el.className = `chat-toast chat-toast--${variant}`;
    const t = document.createElement('strong');
    t.className = 'chat-toast-title';
    t.textContent = title;
    const b = document.createElement('div');
    b.className = 'chat-toast-body';
    b.textContent = body;
    el.append(t, b);
    els.toastStack.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function confirmAction(text) {
    return new Promise((resolve) => {
      if (!els.confirmModal) return resolve(false);
      els.confirmDesc.textContent = text || i18n.confirmActionDesc;
      els.confirmModal.hidden = false;
      els.confirmModal.setAttribute('aria-hidden', 'false');
      const done = (v) => {
        els.confirmModal.hidden = true;
        els.confirmModal.setAttribute('aria-hidden', 'true');
        els.confirmOkBtn.removeEventListener('click', onOk);
        els.confirmCancelBtn.removeEventListener('click', onCancel);
        resolve(v);
      };
      const onOk = () => done(true);
      const onCancel = () => done(false);
      els.confirmOkBtn.addEventListener('click', onOk);
      els.confirmCancelBtn.addEventListener('click', onCancel);
    });
  }

  function priorityBadgeClass(prio) {
    if (prio === 'critical') return 'badge-danger';
    if (prio === 'high') return 'badge-warning';
    if (prio === 'low') return 'badge-neutral';
    return 'badge-primary';
  }

  function priorityLabel(prio) {
    if (prio === 'critical') return i18n.prioCritical || 'Kritik';
    if (prio === 'high') return i18n.prioHigh || 'Yüksek';
    if (prio === 'low') return i18n.prioLow || 'Düşük';
    return i18n.prioNormal || 'Normal';
  }

  function statusLabel(st) {
    if (st === 'closed') return i18n.statusClosed || 'Kapandı';
    if (st === 'in_review') return i18n.statusInReview || 'İncelemede';
    return i18n.statusOpen || 'Açık';
  }

  // ==========================================================================
  // VAKA LİSTESİ & VAKA DETAYI
  // ==========================================================================
  async function loadCases(page = 1) {
    if (boot.auditOnly || !els.casesContainer) return;
    state.casesPage = page;
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (els.filterStatus && els.filterStatus.value) params.set('status', els.filterStatus.value);
    if (els.filterPriority && els.filterPriority.value) params.set('priority', els.filterPriority.value);
    if (els.filterSource && els.filterSource.value) params.set('source', els.filterSource.value);

    try {
      const data = await apiJson(`/sohbet/moderasyon/api/vakalar?${params.toString()}`);
      renderCasesList(data.items || [], data.page || 1, data.totalPages || 1);
    } catch (err) {
      showToast('Hata', err.message, 'danger');
    }
  }

  function renderCasesList(items, page, totalPages) {
    els.casesContainer.replaceChildren();
    if (items.length === 0) {
      const p = document.createElement('div');
      p.className = 'chat-empty-card';
      p.textContent = i18n.noCases || 'Vaka bulunamadı.';
      els.casesContainer.appendChild(p);
      els.casesPager.hidden = true;
      return;
    }

    for (const c of items) {
      const card = document.createElement('div');
      card.className = 'chat-mod-case-row';

      const info = document.createElement('div');
      info.className = 'chat-mod-case-info';

      const badges = document.createElement('div');
      badges.className = 'chat-mod-badges';

      const bPrio = document.createElement('span');
      bPrio.className = `badge ${priorityBadgeClass(c.priority)}`;
      bPrio.textContent = priorityLabel(c.priority);

      const bSrc = document.createElement('span');
      bSrc.className = 'badge badge-neutral';
      bSrc.textContent = c.source === 'auto' ? `🤖 ${i18n.sourceAuto}` : `🚩 ${i18n.sourceReport}`;

      const bSt = document.createElement('span');
      bSt.className = `badge ${c.status === 'closed' ? 'badge-success' : 'badge-warning'}`;
      bSt.textContent = statusLabel(c.status);

      badges.append(bPrio, bSrc, bSt);
      if (c.lockedByName) {
        const bLock = document.createElement('span');
        bLock.className = 'badge badge-warning';
        bLock.textContent = `🔒 ${i18n.caseLockedBy} ${c.lockedByName}`;
        badges.appendChild(bLock);
      }

      const title = document.createElement('div');
      title.className = 'chat-mod-case-title';
      title.textContent = `${c.reportedUserName} • ${c.category} (${c.messageCount} mesaj)`;

      const sub = document.createElement('div');
      sub.className = 'chat-mod-case-sub';
      sub.textContent = `${c.id} • ${fmtDate(c.createdAt)}`;

      info.append(badges, title, sub);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary btn-xs';
      btn.textContent = i18n.openCaseBtn || 'Vakayı İncele';
      btn.addEventListener('click', () => openCaseDetail(c.id));

      card.append(info, btn);
      els.casesContainer.appendChild(card);
    }

    els.casesPager.replaceChildren();
    if (totalPages > 1) {
      els.casesPager.hidden = false;
      for (let p = 1; p <= totalPages; p += 1) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `btn btn-xs ${p === page ? 'btn-primary' : 'btn-secondary'}`;
        b.textContent = String(p);
        b.addEventListener('click', () => loadCases(p));
        els.casesPager.appendChild(b);
      }
    } else {
      els.casesPager.hidden = true;
    }
  }

  async function openCaseDetail(caseId) {
    try {
      const data = await apiJson(`/sohbet/moderasyon/api/vaka/${encodeURIComponent(caseId)}`);
      state.activeCase = data.case;
      renderCaseDetail(data.case, data.messages || []);
      els.casesListView.hidden = true;
      els.caseDetailView.hidden = false;
    } catch (err) {
      showToast('Uyarı', err.message || 'Vaka açılamadı.', 'warning');
    }
  }

  function renderCaseDetail(c, messages) {
    els.caseBadges.replaceChildren();
    const b1 = document.createElement('span');
    b1.className = `badge ${priorityBadgeClass(c.priority)}`;
    b1.textContent = priorityLabel(c.priority);
    const b2 = document.createElement('span');
    b2.className = 'badge badge-neutral';
    b2.textContent = `${c.source === 'auto' ? i18n.sourceAuto : i18n.sourceReport} • ${c.category}`;
    const b3 = document.createElement('span');
    b3.className = 'badge badge-warning';
    b3.textContent = statusLabel(c.status);
    els.caseBadges.append(b1, b2, b3);

    els.caseMetaBox.replaceChildren();
    const metaLines = [
      `Vaka ID: ${c.id}`,
      `Hedef Üye: ${c.reportedUserName}`,
      c.reporterName ? `Raporlayan: ${c.reporterName}` : `Otomatik Bayrak: ${(c.autoCategories || []).join(', ')}`,
      c.reporterNote ? `Rapor Açıklaması: ${c.reporterNote}` : null,
      `Tarih: ${fmtDate(c.createdAt)}`,
    ].filter(Boolean);
    for (const line of metaLines) {
      const div = document.createElement('div');
      div.textContent = line;
      els.caseMetaBox.appendChild(div);
    }

    els.caseMessages.replaceChildren();
    if (c.snapshotPurged) {
      const purged = document.createElement('div');
      purged.className = 'chat-empty-card';
      purged.textContent = i18n.snapshotPurged;
      els.caseMessages.appendChild(purged);
    } else {
      for (const m of messages) {
        const item = document.createElement('div');
        item.className = `chat-mod-snap-msg${m.isTarget ? ' is-target' : ''}`;

        const head = document.createElement('div');
        head.className = 'chat-mod-snap-head';
        const author = document.createElement('strong');
        author.textContent = m.fromName;
        const ts = document.createElement('span');
        ts.textContent = fmtDate(m.ts);
        head.append(author, ts);

        const body = document.createElement('div');
        body.className = 'chat-mod-snap-text';
        body.textContent = m.text || (m.deleted ? '[Silinmiş mesaj]' : '');

        item.append(head, body);

        // Bulanık ek önizlemesi ("Göstermek için tıkla", indirme düğmesi yok)
        if (Array.isArray(m.attachments) && m.attachments.length > 0) {
          const attRow = document.createElement('div');
          attRow.className = 'chat-mod-att-list';
          for (const att of m.attachments) {
            const box = document.createElement('div');
            box.className = 'chat-mod-blur-box is-blurred';
            const revealBtn = document.createElement('button');
            revealBtn.type = 'button';
            revealBtn.className = 'btn btn-secondary btn-xs chat-mod-reveal-btn';
            revealBtn.textContent = `${i18n.revealAttachment} (${att.originalName || att.ext})`;
            revealBtn.addEventListener('click', () => {
              box.classList.remove('is-blurred');
              revealBtn.remove();
              if (att.category === 'image') {
                const img = document.createElement('img');
                img.src = att.previewUrl;
                img.alt = att.originalName || 'ek';
                img.className = 'chat-mod-preview-img';
                box.appendChild(img);
              } else if (att.category === 'video') {
                const vid = document.createElement('video');
                vid.src = att.previewUrl;
                vid.controls = true;
                vid.controlsList = 'nodownload';
                vid.className = 'chat-mod-preview-video';
                box.appendChild(vid);
              } else {
                const info = document.createElement('span');
                info.textContent = `📄 ${att.originalName} (${att.ext})`;
                box.appendChild(info);
              }
            });
            box.appendChild(revealBtn);
            attRow.appendChild(box);
          }
          item.appendChild(attRow);
        }

        els.caseMessages.appendChild(item);
      }
    }

    if (els.actionNote) els.actionNote.value = '';
    if (els.actionError) els.actionError.hidden = true;
  }

  async function executeModAction(action, extra = {}) {
    if (!state.activeCase) return;
    const note = els.actionNote ? els.actionNote.value.trim() : '';
    if (note.length < 3) {
      if (els.actionError) {
        els.actionError.textContent = i18n.errNoteRequired;
        els.actionError.hidden = false;
      }
      return;
    }
    if (els.actionError) els.actionError.hidden = true;

    const ok = await confirmAction(i18n.confirmActionDesc);
    if (!ok) return;

    const actionKey = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      await apiJson(`/sohbet/moderasyon/api/vaka/${encodeURIComponent(state.activeCase.id)}/eylem`, {
        method: 'POST',
        body: Object.assign({ action, note, actionKey }, extra),
      });
      showToast('✓', `İşlem uygulandı (${action})`, 'success');
      if (action === 'close') {
        els.caseDetailView.hidden = true;
        els.casesListView.hidden = false;
        state.activeCase = null;
        loadCases(state.casesPage);
      } else {
        openCaseDetail(state.activeCase.id);
      }
    } catch (err) {
      if (els.actionError) {
        els.actionError.textContent = err.message || 'İşlem başarısız.';
        els.actionError.hidden = false;
      }
    }
  }

  // ==========================================================================
  // YAPTIRIMLAR & DENETİM KAYDI
  // ==========================================================================
  async function loadSanctions() {
    if (boot.auditOnly || !els.sanctionsContainer) return;
    try {
      const data = await apiJson('/sohbet/moderasyon/api/yaptirimlar');
      const items = data.items || [];
      els.sanctionsContainer.replaceChildren();
      if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'chat-empty-card';
        empty.textContent = i18n.noSanctions;
        els.sanctionsContainer.appendChild(empty);
        return;
      }
      for (const s of items) {
        const row = document.createElement('div');
        row.className = 'chat-mod-case-row';
        const info = document.createElement('div');
        info.className = 'chat-mod-case-info';
        const title = document.createElement('div');
        title.className = 'chat-mod-case-title';
        title.textContent = `${s.userName} • ${s.type === 'ban' ? '⛔ Yasak' : `🔇 Susturma (${s.durationKey || ''})`} • ${s.reasonCategory}`;
        const sub = document.createElement('div');
        sub.className = 'chat-mod-case-sub';
        sub.textContent = `${s.isActive ? 'AKTİF' : 'SONA ERDİ'} • Başlangıç: ${fmtDate(s.createdAt)}${s.expiresAt ? ` • Bitiş: ${fmtDate(s.expiresAt)}` : ''}`;
        info.append(title, sub);
        row.appendChild(info);

        if (s.isActive) {
          const liftBtn = document.createElement('button');
          liftBtn.type = 'button';
          liftBtn.className = 'btn btn-secondary btn-xs';
          liftBtn.textContent = i18n.liftSanctionBtn;
          liftBtn.addEventListener('click', async () => {
            const ok = await confirmAction('Bu yaptırımı kaldırmak istediğinize emin misiniz?');
            if (!ok) return;
            try {
              await apiJson(`/sohbet/moderasyon/api/yaptirim/${encodeURIComponent(s.id)}/kaldir`, {
                method: 'POST',
                body: { note: 'Moderatör kararıyla yaptırım kaldırıldı.' },
              });
              showToast('✓', 'Yaptırım kaldırıldı.', 'success');
              loadSanctions();
            } catch (err) {
              showToast('Hata', err.message, 'danger');
            }
          });
          row.appendChild(liftBtn);
        }
        els.sanctionsContainer.appendChild(row);
      }
    } catch (err) {
      showToast('Hata', err.message, 'danger');
    }
  }

  async function loadAuditLog() {
    if (!els.auditContainer) return;
    try {
      const data = await apiJson('/sohbet/moderasyon/api/denetim?limit=100');
      const items = data.items || [];
      els.auditContainer.replaceChildren();
      if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'chat-empty-card';
        empty.textContent = i18n.noAuditLogs;
        els.auditContainer.appendChild(empty);
        return;
      }
      for (const entry of items) {
        const row = document.createElement('div');
        row.className = 'chat-mod-audit-row';
        const left = document.createElement('div');
        left.className = 'chat-mod-case-info';
        const line1 = document.createElement('div');
        line1.className = 'chat-mod-case-title';
        line1.textContent = `${entry.modName} → ${entry.action}${entry.caseId ? ` (${entry.caseId})` : ''}`;
        const line2 = document.createElement('div');
        line2.className = 'chat-mod-case-sub';
        line2.textContent = `${fmtDate(entry.ts)}${entry.note ? ` • Not: ${entry.note}` : ''}`;
        left.append(line1, line2);
        row.appendChild(left);

        if (entry.highVolumeAccess) {
          const hv = document.createElement('span');
          hv.className = 'badge badge-danger';
          hv.textContent = i18n.highVolumeBadge;
          row.appendChild(hv);
        }
        els.auditContainer.appendChild(row);
      }
    } catch (err) {
      showToast('Hata', err.message, 'danger');
    }
  }

  // ==========================================================================
  // SİTE BİLDİRİMLERİ SEKMESİ (/bildir -> Community Official)
  // ==========================================================================
  async function loadSiteReports() {
    if (boot.auditOnly || !els.siteContainer) return;
    const params = new URLSearchParams();
    if (els.siteFilterStatus && els.siteFilterStatus.value) params.set('status', els.siteFilterStatus.value);
    if (els.siteFilterCategory && els.siteFilterCategory.value) params.set('category', els.siteFilterCategory.value);

    try {
      const data = await apiJson(`/sohbet/moderasyon/api/site-bildirimleri?${params.toString()}`);
      const items = data.items || [];
      els.siteContainer.replaceChildren();
      if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'chat-empty-card';
        empty.textContent = i18n.noSiteReports || 'Site bildirimi bulunamadı.';
        els.siteContainer.appendChild(empty);
        return;
      }

      for (const r of items) {
        const row = document.createElement('div');
        row.className = 'chat-mod-case-row';

        const info = document.createElement('div');
        info.className = 'chat-mod-case-info';

        const badges = document.createElement('div');
        badges.className = 'chat-mod-badges';

        const bPrio = document.createElement('span');
        bPrio.className = `badge ${priorityBadgeClass(r.priority)}`;
        bPrio.textContent = priorityLabel(r.priority);

        const bCode = document.createElement('span');
        bCode.className = 'badge badge-neutral';
        bCode.textContent = r.trackingCode;

        const bSt = document.createElement('span');
        bSt.className = `badge ${r.status === 'action_taken' ? 'badge-success' : r.status === 'in_review' ? 'badge-warning' : 'badge-primary'}`;
        bSt.textContent = (i18n.reportStatusLabels && i18n.reportStatusLabels[r.status]) || r.status;

        badges.append(bPrio, bCode, bSt);
        if (r.evidenceCount > 0) {
          const bEv = document.createElement('span');
          bEv.className = 'badge badge-neutral';
          bEv.textContent = `🖼️ ${r.evidenceCount}`;
          badges.appendChild(bEv);
        }

        const title = document.createElement('div');
        title.className = 'chat-mod-case-title';
        title.textContent = `${(i18n.siteCatLabels && i18n.siteCatLabels[r.category]) || r.category} • ${r.location}`;

        const sub = document.createElement('div');
        sub.className = 'chat-mod-case-sub';
        sub.textContent = `${fmtDate(r.createdAt)}`;

        info.append(badges, title, sub);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-primary btn-xs';
        btn.textContent = i18n.openSiteReportBtn || 'Bildirimi İncele';
        btn.addEventListener('click', () => openSiteReportDetail(r.trackingCode));

        row.append(info, btn);
        els.siteContainer.appendChild(row);
      }
    } catch (err) {
      showToast('Hata', err.message, 'danger');
    }
  }

  async function openSiteReportDetail(code) {
    try {
      const data = await apiJson(`/sohbet/moderasyon/api/site-bildirim/${encodeURIComponent(code)}`);
      const r = data.report;
      state.activeSiteReportCode = r.trackingCode;

      els.siteDetailBadges.replaceChildren();
      const b1 = document.createElement('span');
      b1.className = `badge ${priorityBadgeClass(r.priority)}`;
      b1.textContent = priorityLabel(r.priority);
      const b2 = document.createElement('span');
      b2.className = 'badge badge-neutral';
      b2.textContent = r.trackingCode;
      const b3 = document.createElement('span');
      b3.className = 'badge badge-warning';
      b3.textContent = (i18n.reportStatusLabels && i18n.reportStatusLabels[r.status]) || r.status;
      els.siteDetailBadges.append(b1, b2, b3);

      els.siteDetailMeta.replaceChildren();
      const lines = [
        `Kategori: ${(i18n.siteCatLabels && i18n.siteCatLabels[r.category]) || r.category}`,
        `Olay Yeri: ${r.location}`,
        r.targetRef ? `Bağlantı / Kimlik: ${r.targetRef}` : null,
        r.reporterName ? `Gönderen Üye: ${r.reporterName}` : null,
        r.contactEmail ? `İletişim E-postası: ${r.contactEmail}` : null,
        `Tarih: ${fmtDate(r.createdAt)}`,
      ].filter(Boolean);
      for (const l of lines) {
        const d = document.createElement('div');
        d.textContent = l;
        els.siteDetailMeta.appendChild(d);
      }

      els.siteDetailBody.textContent = r.description || '';

      els.siteEvidenceList.replaceChildren();
      for (const att of r.evidence || []) {
        const box = document.createElement('div');
        box.className = 'chat-mod-blur-box is-blurred';
        const revBtn = document.createElement('button');
        revBtn.type = 'button';
        revBtn.className = 'btn btn-secondary btn-xs chat-mod-reveal-btn';
        revBtn.textContent = `${i18n.revealAttachment} (${att.originalName || att.ext})`;
        revBtn.addEventListener('click', () => {
          box.classList.remove('is-blurred');
          revBtn.remove();
          const img = document.createElement('img');
          img.src = att.previewUrl;
          img.alt = att.originalName || 'kanit';
          img.className = 'chat-mod-preview-img';
          box.appendChild(img);
        });
        box.appendChild(revBtn);
        els.siteEvidenceList.appendChild(box);
      }

      els.siteNotesList.replaceChildren();
      for (const n of r.notes || []) {
        const item = document.createElement('div');
        item.className = 'chat-mod-snap-msg';
        const head = document.createElement('div');
        head.className = 'chat-mod-snap-head';
        const who = document.createElement('strong');
        who.textContent = `${n.byName || 'Mod'} (${(i18n.reportStatusLabels && i18n.reportStatusLabels[n.status]) || n.status})`;
        const when = document.createElement('span');
        when.textContent = fmtDate(n.ts);
        head.append(who, when);
        const body = document.createElement('div');
        body.className = 'chat-mod-snap-text';
        body.textContent = n.note || '';
        item.append(head, body);
        els.siteNotesList.appendChild(item);
      }

      if (els.siteStatusSelect) els.siteStatusSelect.value = r.status;
      if (els.siteActionNote) els.siteActionNote.value = '';
      if (els.siteActionError) els.siteActionError.hidden = true;

      els.siteListView.hidden = true;
      els.siteDetailView.hidden = false;
    } catch (err) {
      showToast('Uyarı', err.message, 'warning');
    }
  }

  async function saveSiteReportStatus() {
    if (!state.activeSiteReportCode) return;
    const status = els.siteStatusSelect ? els.siteStatusSelect.value : '';
    const note = els.siteActionNote ? els.siteActionNote.value.trim() : '';
    if (note.length < 3) {
      if (els.siteActionError) {
        els.siteActionError.textContent = i18n.errNoteRequired;
        els.siteActionError.hidden = false;
      }
      return;
    }
    if (els.siteActionError) els.siteActionError.hidden = true;

    const ok = await confirmAction(i18n.confirmActionDesc);
    if (!ok) return;

    try {
      await apiJson(`/sohbet/moderasyon/api/site-bildirim/${encodeURIComponent(state.activeSiteReportCode)}/durum`, {
        method: 'POST',
        body: { status, note },
      });
      showToast('✓', i18n.siteReportSaved || 'Bildirim durumu güncellendi.', 'success');
      await openSiteReportDetail(state.activeSiteReportCode);
    } catch (err) {
      if (els.siteActionError) {
        els.siteActionError.textContent = err.message;
        els.siteActionError.hidden = false;
      }
    }
  }

  // Sekme geçişleri
  document.querySelectorAll('[data-mod-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.modTab;
      state.activeTab = target;
      document.querySelectorAll('[data-mod-tab]').forEach((b) => {
        const active = b.dataset.modTab === target;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      const pCases = document.getElementById('modPanelCases');
      const pSite = document.getElementById('modPanelSiteReports');
      const pSanc = document.getElementById('modPanelSanctions');
      const pAudit = document.getElementById('modPanelAudit');
      if (pCases) pCases.hidden = target !== 'cases';
      if (pSite) pSite.hidden = target !== 'site_reports';
      if (pSanc) pSanc.hidden = target !== 'sanctions';
      if (pAudit) pAudit.hidden = target !== 'audit';

      if (target === 'cases') loadCases(state.casesPage);
      else if (target === 'site_reports') loadSiteReports();
      else if (target === 'sanctions') loadSanctions();
      else if (target === 'audit') loadAuditLog();
    });
  });

  if (els.siteFilterStatus) els.siteFilterStatus.addEventListener('change', loadSiteReports);
  if (els.siteFilterCategory) els.siteFilterCategory.addEventListener('change', loadSiteReports);
  if (els.siteRefreshBtn) els.siteRefreshBtn.addEventListener('click', loadSiteReports);
  if (els.siteBackBtn) {
    els.siteBackBtn.addEventListener('click', () => {
      els.siteDetailView.hidden = true;
      els.siteListView.hidden = false;
      state.activeSiteReportCode = null;
      loadSiteReports();
    });
  }
  if (els.siteSaveBtn) els.siteSaveBtn.addEventListener('click', saveSiteReportStatus);

  if (els.filterStatus) els.filterStatus.addEventListener('change', () => loadCases(1));
  if (els.filterPriority) els.filterPriority.addEventListener('change', () => loadCases(1));
  if (els.filterSource) els.filterSource.addEventListener('change', () => loadCases(1));
  if (els.refreshCasesBtn) els.refreshCasesBtn.addEventListener('click', () => loadCases(state.casesPage));
  if (els.backToListBtn) {
    els.backToListBtn.addEventListener('click', () => {
      els.caseDetailView.hidden = true;
      els.casesListView.hidden = false;
      state.activeCase = null;
      loadCases(state.casesPage);
    });
  }

  document.querySelectorAll('[data-mod-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.modAction;
      const extra = {};
      if (btn.dataset.duration) extra.duration = btn.dataset.duration;
      if (btn.dataset.resolution) extra.resolution = btn.dataset.resolution;
      executeModAction(act, extra);
    });
  });

  if (boot.auditOnly) {
    loadAuditLog();
  } else {
    loadCases(1);
  }
})();
