/**
 * ==============================================================================
 * ⚖️ PIYADE WORLD — YÖNETİM KVKK & İHLAL BİLDİRİM PANELİ İSTEMCİSİ
 * ==============================================================================
 * - /yonetim/kvkk (Developer) ve /yonetim/bildirimler (Developer + Yönetmenlik)
 *   panellerini yönetir.
 * - Kanıt görselleri varsayılan olarak bulanıktır ("Göstermek için tıkla").
 * - Tüm kullanıcı verileri textContent ile render edilir; sabit #hex renk yoktur.
 * ==============================================================================
 */
(function () {
  'use strict';

  const bootEl = document.getElementById('adminLegalBootstrapData');
  if (!bootEl) return;

  let boot;
  try {
    boot = JSON.parse(bootEl.textContent || '{}');
  } catch (_) {
    return;
  }

  const isKvkk = boot.mode === 'kvkk';
  const i18n = boot.i18n || {};
  const csrfToken = boot.csrfToken || '';
  const localeTag = boot.lang === 'en' ? 'en-US' : 'tr-TR';

  const state = {
    activeCode: null,
  };

  const els = {
    listPanel: document.getElementById('adminLegalListPanel'),
    auditPanel: document.getElementById('adminLegalAuditPanel'),
    listView: document.getElementById('adminLegalListView'),
    detailView: document.getElementById('adminLegalDetailView'),
    listContainer: document.getElementById('adminLegalListContainer'),
    auditContainer: document.getElementById('adminLegalAuditContainer'),
    filterStatus: document.getElementById('adminLegalFilterStatus'),
    filterCategory: document.getElementById('adminLegalFilterCategory'),
    filterOverdueOnly: document.getElementById('kvkkFilterOverdueOnly'),
    overdueSummaryBadge: document.getElementById('kvkkOverdueSummaryBadge'),
    refreshBtn: document.getElementById('adminLegalRefreshBtn'),
    backBtn: document.getElementById('adminLegalBackBtn'),
    detailBadges: document.getElementById('adminLegalDetailBadges'),
    detailMeta: document.getElementById('adminLegalDetailMeta'),
    detailBody: document.getElementById('adminLegalDetailBody'),
    evidenceList: document.getElementById('adminLegalEvidenceList'),
    notesList: document.getElementById('adminLegalNotesList'),
    statusSelect: document.getElementById('adminLegalStatusSelect'),
    noteInput: document.getElementById('adminLegalNoteInput'),
    actionError: document.getElementById('adminLegalActionError'),
    saveBtn: document.getElementById('adminLegalSaveBtn'),
    toastStack: document.getElementById('adminLegalToastStack'),
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

  function statusBadgeClass(st) {
    if (st === 'answered' || st === 'action_taken') return 'badge-success';
    if (st === 'rejected') return 'badge-danger';
    if (st === 'in_review') return 'badge-warning';
    if (st === 'closed' || st === 'no_basis') return 'badge-neutral';
    return 'badge-primary';
  }

  function priorityBadgeClass(prio) {
    if (prio === 'critical') return 'badge-danger';
    if (prio === 'high') return 'badge-warning';
    if (prio === 'low') return 'badge-neutral';
    return 'badge-primary';
  }

  async function loadList() {
    if (!els.listContainer) return;
    const params = new URLSearchParams();
    if (els.filterStatus && els.filterStatus.value) params.set('status', els.filterStatus.value);
    if (isKvkk && els.filterOverdueOnly && els.filterOverdueOnly.checked) params.set('overdue', '1');
    if (!isKvkk && els.filterCategory && els.filterCategory.value) params.set('category', els.filterCategory.value);

    const url = isKvkk
      ? `/yonetim/kvkk/api/basvurular?${params.toString()}`
      : `/yonetim/bildirimler/api/liste?${params.toString()}`;

    try {
      const data = await apiJson(url);
      if (isKvkk && els.overdueSummaryBadge) {
        const oc = Number(data.overdueCount) || 0;
        if (oc > 0) {
          els.overdueSummaryBadge.textContent = `⚠️ ${oc} ${i18n.overdueBadge || 'Geciken'}`;
          els.overdueSummaryBadge.hidden = false;
        } else {
          els.overdueSummaryBadge.hidden = true;
        }
      }
      renderList(data.items || []);
    } catch (err) {
      showToast('Hata', err.message, 'danger');
    }
  }

  function renderList(items) {
    els.listContainer.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'chat-empty-card';
      empty.textContent = i18n.emptyList || 'Kayıt yok.';
      els.listContainer.appendChild(empty);
      return;
    }

    for (const item of items) {
      const row = document.createElement('div');
      row.className = `chat-mod-case-row${item.isOverdue ? ' legal-row-overdue' : ''}`;

      const info = document.createElement('div');
      info.className = 'chat-mod-case-info';

      const badges = document.createElement('div');
      badges.className = 'chat-mod-badges';

      const bCode = document.createElement('span');
      bCode.className = 'badge badge-neutral';
      bCode.textContent = item.trackingCode;

      const bSt = document.createElement('span');
      bSt.className = `badge ${statusBadgeClass(item.status)}`;
      bSt.textContent = (i18n.statusLabels && i18n.statusLabels[item.status]) || item.status;

      badges.append(bCode, bSt);

      if (isKvkk) {
        if (item.isOverdue) {
          const bOv = document.createElement('span');
          bOv.className = 'badge badge-danger';
          bOv.textContent = `⚠️ ${i18n.overdueBadge} (${Math.abs(item.daysRemaining)} ${i18n.overdueDaysSuffix})`;
          badges.appendChild(bOv);
        } else if (item.isNearDeadline) {
          const bNear = document.createElement('span');
          bNear.className = 'badge badge-warning';
          bNear.textContent = `⏱️ ${item.daysRemaining} ${i18n.daysLeftSuffix}`;
          badges.appendChild(bNear);
        }
      } else {
        const bPrio = document.createElement('span');
        bPrio.className = `badge ${priorityBadgeClass(item.priority)}`;
        bPrio.textContent = (i18n.priorityLabels && i18n.priorityLabels[item.priority]) || item.priority;
        badges.appendChild(bPrio);
        if (item.evidenceCount > 0) {
          const bEv = document.createElement('span');
          bEv.className = 'badge badge-neutral';
          bEv.textContent = `🖼️ ${item.evidenceCount}`;
          badges.appendChild(bEv);
        }
      }

      const title = document.createElement('div');
      title.className = 'chat-mod-case-title';
      title.textContent = isKvkk
        ? `${item.fullName} • ${item.relation} (${(item.requestTypes || []).join(', ')})`
        : `${(boot.categoryLabels && boot.categoryLabels[item.category]) || item.category} • ${item.location}`;

      const sub = document.createElement('div');
      sub.className = 'chat-mod-case-sub';
      sub.textContent = isKvkk
        ? `Tarih: ${fmtDate(item.createdAt)} • Son Tarih: ${fmtDate(item.deadlineAt)}`
        : `Tarih: ${fmtDate(item.createdAt)} • Güncelleme: ${fmtDate(item.updatedAt)}`;

      info.append(badges, title, sub);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary btn-xs';
      btn.textContent = i18n.openBtn || 'İncele';
      btn.addEventListener('click', () => openDetail(item.trackingCode));

      row.append(info, btn);
      els.listContainer.appendChild(row);
    }
  }

  async function openDetail(code) {
    const url = isKvkk
      ? `/yonetim/kvkk/api/basvuru/${encodeURIComponent(code)}`
      : `/yonetim/bildirimler/api/detay/${encodeURIComponent(code)}`;
    try {
      const data = await apiJson(url);
      const record = isKvkk ? data.item : data.report;
      state.activeCode = record.trackingCode;
      renderDetail(record);
      els.listView.hidden = true;
      els.detailView.hidden = false;
    } catch (err) {
      showToast('Uyarı', err.message, 'warning');
    }
  }

  function renderDetail(rec) {
    els.detailBadges.replaceChildren();
    const b1 = document.createElement('span');
    b1.className = 'badge badge-neutral';
    b1.textContent = rec.trackingCode;
    const b2 = document.createElement('span');
    b2.className = `badge ${statusBadgeClass(rec.status)}`;
    b2.textContent = (i18n.statusLabels && i18n.statusLabels[rec.status]) || rec.status;
    els.detailBadges.append(b1, b2);

    if (isKvkk && rec.isOverdue) {
      const b3 = document.createElement('span');
      b3.className = 'badge badge-danger';
      b3.textContent = `⚠️ ${i18n.overdueBadge}`;
      els.detailBadges.appendChild(b3);
    }

    els.detailMeta.replaceChildren();
    const metaLines = isKvkk
      ? [
          `Başvuran: ${rec.fullName}`,
          `E-posta: ${rec.email}`,
          `İlişki: ${rec.relation}`,
          rec.accountIdentifier ? `Hesap Tanımlayıcısı: ${rec.accountIdentifier}` : null,
          `Talep Türleri: ${(rec.requestTypes || []).join(', ')}`,
          `Tarih: ${fmtDate(rec.createdAt)} • Yasal Son Tarih (30g): ${fmtDate(rec.deadlineAt)}`,
        ].filter(Boolean)
      : [
          `Kategori: ${(boot.categoryLabels && boot.categoryLabels[rec.category]) || rec.category}`,
          `Olay Yeri: ${rec.location}`,
          rec.targetRef ? `Hedef Bağlantı / Kimlik: ${rec.targetRef}` : null,
          rec.contactEmail ? `İletişim E-postası: ${rec.contactEmail}` : null,
          rec.reporterName ? `Gönderen Üye: ${rec.reporterName}` : null,
          rec.dmca ? `DMCA Hak Sahibi: ${rec.dmca.rightsHolder}` : null,
          rec.dmca ? `DMCA İhlal Bağlantısı: ${rec.dmca.infringingUrl}` : null,
          rec.dmca ? `DMCA Eser Tanımı: ${rec.dmca.workDescription}` : null,
          `Tarih: ${fmtDate(rec.createdAt)}`,
        ].filter(Boolean);

    for (const line of metaLines) {
      const d = document.createElement('div');
      d.textContent = line;
      els.detailMeta.appendChild(d);
    }

    els.detailBody.textContent = rec.description || '';

    // Bulanık tıkla-göster kanıt görselleri (/yonetim/bildirimler)
    if (!isKvkk && els.evidenceList) {
      els.evidenceList.replaceChildren();
      for (const att of rec.evidence || []) {
        const box = document.createElement('div');
        box.className = 'chat-mod-blur-box is-blurred';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary btn-xs chat-mod-reveal-btn';
        btn.textContent = `${i18n.revealEvidence || '👁️ Göstermek için tıkla (Bulanık)'} (${att.originalName || att.ext})`;
        btn.addEventListener('click', () => {
          box.classList.remove('is-blurred');
          btn.remove();
          const img = document.createElement('img');
          img.src = att.previewUrl;
          img.alt = att.originalName || 'kanit';
          img.className = 'chat-mod-preview-img';
          box.appendChild(img);
        });
        box.appendChild(btn);
        els.evidenceList.appendChild(box);
      }
    }

    // İç notlar geçmişi
    els.notesList.replaceChildren();
    const notes = isKvkk ? rec.internalNotes || [] : rec.notes || [];
    if (notes.length === 0) {
      const emp = document.createElement('div');
      emp.className = 'legal-field-hint';
      emp.textContent = '—';
      els.notesList.appendChild(emp);
    } else {
      for (const n of notes) {
        const item = document.createElement('div');
        item.className = 'chat-mod-snap-msg';
        const head = document.createElement('div');
        head.className = 'chat-mod-snap-head';
        const who = document.createElement('strong');
        who.textContent = `${n.byName || 'Staff'} (${(i18n.statusLabels && i18n.statusLabels[n.status]) || n.status})`;
        const when = document.createElement('span');
        when.textContent = fmtDate(n.ts);
        head.append(who, when);
        const body = document.createElement('div');
        body.className = 'chat-mod-snap-text';
        body.textContent = n.note || '';
        item.append(head, body);
        els.notesList.appendChild(item);
      }
    }

    if (els.statusSelect) els.statusSelect.value = rec.status;
    if (els.noteInput) els.noteInput.value = '';
    if (els.actionError) els.actionError.hidden = true;
  }

  async function saveStatus() {
    if (!state.activeCode) return;
    const status = els.statusSelect ? els.statusSelect.value : '';
    const note = els.noteInput ? els.noteInput.value.trim() : '';
    if (note.length < 3) {
      if (els.actionError) {
        els.actionError.textContent = i18n.errNoteRequired || 'En az 3 karakterlik not girin.';
        els.actionError.hidden = false;
      }
      return;
    }
    if (els.actionError) els.actionError.hidden = true;

    const url = isKvkk
      ? `/yonetim/kvkk/api/basvuru/${encodeURIComponent(state.activeCode)}/durum`
      : `/yonetim/bildirimler/api/detay/${encodeURIComponent(state.activeCode)}/durum`;

    try {
      await apiJson(url, { method: 'POST', body: { status, note } });
      showToast('✓', i18n.savedToast || 'Güncellendi.', 'success');
      await openDetail(state.activeCode);
    } catch (err) {
      if (els.actionError) {
        els.actionError.textContent = err.message;
        els.actionError.hidden = false;
      }
    }
  }

  async function loadAudit() {
    if (!els.auditContainer) return;
    const url = isKvkk ? '/yonetim/kvkk/api/denetim?limit=100' : '/yonetim/bildirimler/api/denetim?limit=100';
    try {
      const data = await apiJson(url);
      const items = data.items || [];
      els.auditContainer.replaceChildren();
      if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'chat-empty-card';
        empty.textContent = i18n.emptyAudit || 'Kayıt yok.';
        els.auditContainer.appendChild(empty);
        return;
      }
      for (const entry of items) {
        const row = document.createElement('div');
        row.className = 'chat-mod-audit-row';
        const left = document.createElement('div');
        left.className = 'chat-mod-case-info';
        const l1 = document.createElement('div');
        l1.className = 'chat-mod-case-title';
        l1.textContent = `${entry.actorName} → ${entry.action}${entry.trackingCode ? ` (${entry.trackingCode})` : ''}`;
        const l2 = document.createElement('div');
        l2.className = 'chat-mod-case-sub';
        l2.textContent = `${fmtDate(entry.ts)}${entry.status ? ` • ${entry.status}` : ''}${entry.category ? ` • ${entry.category}` : ''}`;
        left.append(l1, l2);
        row.appendChild(left);
        els.auditContainer.appendChild(row);
      }
    } catch (err) {
      showToast('Hata', err.message, 'danger');
    }
  }

  document.querySelectorAll('[data-legal-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.legalTab;
      document.querySelectorAll('[data-legal-tab]').forEach((b) => {
        const active = b.dataset.legalTab === target;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      if (els.listPanel) els.listPanel.hidden = target !== 'list';
      if (els.auditPanel) els.auditPanel.hidden = target !== 'audit';
      if (target === 'list') loadList();
      else loadAudit();
    });
  });

  if (els.filterStatus) els.filterStatus.addEventListener('change', loadList);
  if (els.filterCategory) els.filterCategory.addEventListener('change', loadList);
  if (els.filterOverdueOnly) els.filterOverdueOnly.addEventListener('change', loadList);
  if (els.refreshBtn) els.refreshBtn.addEventListener('click', loadList);
  if (els.backBtn) {
    els.backBtn.addEventListener('click', () => {
      els.detailView.hidden = true;
      els.listView.hidden = false;
      state.activeCode = null;
      loadList();
    });
  }
  if (els.saveBtn) els.saveBtn.addEventListener('click', saveStatus);

  loadList();
})();
