/**
 * ==============================================================================
 * 🌐 DEVELOPER SUNUCU YÖNETİM PANELİ (/yonetim/sunucular) — VANİLLA JS
 * ==============================================================================
 * - Canlı Discord davet doğrulama & ÜYE KARTININ BİREBİR AYNISI önizleme (yalnızca textContent)
 * - Tek kullanımlık idempotency + çift gönderim kilidi
 * - Yukarı/Aşağı ve HTML5 Sürükle-Bırak sıralama
 * - Düzenle & Sil onay modalları
 * - Orbital Loader + canlı % ilerleme ile tekli ve toplu yenileme
 * ==============================================================================
 */
(function (global) {
  'use strict';

  function parseJsonAttr(el, attrName, fallback) {
    if (!el) return fallback;
    const raw = el.getAttribute(attrName);
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function createSvgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => el.setAttribute(k, String(attrs[k])));
    }
    return el;
  }

  function buildBadgeSvg(badgeType, i18n) {
    if (!badgeType) return null;
    const span = document.createElement('span');
    span.className = `srv-badge srv-badge-${badgeType}`;
    const label =
      badgeType === 'partnered'
        ? i18n.badgePartnered || 'Discord Partner'
        : badgeType === 'verified'
          ? i18n.badgeVerified || 'Verified'
          : i18n.badgeCommunity || 'Community';
    span.title = label;
    span.setAttribute('aria-label', label);

    const svg = createSvgEl('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', 'aria-hidden': 'true' });
    if (badgeType === 'partnered') {
      svg.appendChild(createSvgEl('circle', { cx: 12, cy: 12, r: 10, fill: 'currentColor', opacity: '0.22' }));
      svg.appendChild(
        createSvgEl('path', {
          d: 'M8.5 14.5a2.5 2.5 0 1 1 0-5h1.5a2 2 0 0 1 2 2v1a2 2 0 0 0 2 2h1.5a2.5 2.5 0 1 0 0-5H14',
          stroke: 'currentColor',
          'stroke-width': '2',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        })
      );
    } else if (badgeType === 'verified') {
      svg.appendChild(
        createSvgEl('path', {
          d: 'M12 2l2.4 2.1 3.2-.3 1.1 3 2.8 1.6-.8 3.1.8 3.1-2.8 1.6-1.1 3-3.2-.3L12 22l-2.4-2.1-3.2.3-1.1-3-2.8-1.6.8-3.1-.8-3.1 2.8-1.6 1.1-3 3.2.3L12 2z',
          fill: 'currentColor',
          opacity: '0.24',
          stroke: 'currentColor',
          'stroke-width': '1.5',
        })
      );
      svg.appendChild(
        createSvgEl('path', {
          d: 'M8.5 12.4l2.3 2.3 4.8-5',
          stroke: 'currentColor',
          'stroke-width': '2.1',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        })
      );
    } else {
      svg.appendChild(
        createSvgEl('circle', { cx: 12, cy: 12, r: 10, fill: 'currentColor', opacity: '0.2', stroke: 'currentColor', 'stroke-width': '1.6' })
      );
      svg.appendChild(
        createSvgEl('path', {
          d: 'M7.5 11.5L12 7.8l4.5 3.7M9 11v5h6v-5',
          stroke: 'currentColor',
          'stroke-width': '1.7',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        })
      );
    }
    span.appendChild(svg);
    return span;
  }

  /**
   * Üye sayfasındaki views/partials/server-card.ejs ile BİREBİR AYNI kart yapısını
   * güvenli DOM API (yalnızca textContent, sıfır innerHTML) ile oluşturur.
   */
  function buildMemberPreviewCardEl(card, createdMonthText, i18n) {
    const numberLocale = i18n.numberLocale || 'tr-TR';
    const formatNum = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString(numberLocale) : '');

    const article = document.createElement('article');
    article.className = 'srv-card is-front is-preview';
    if (card.brandColor) {
      article.style.setProperty('--srv-brand', card.brandColor);
    }

    // Banner
    const banner = document.createElement('div');
    banner.className = `srv-banner${card.bannerUrl ? ' has-image' : ''}`;
    if (card.bannerUrl && card.bannerUrl.startsWith('https://cdn.discordapp.com/')) {
      const bImg = document.createElement('img');
      bImg.src = card.bannerUrl;
      bImg.alt = '';
      bImg.className = 'srv-banner-img';
      bImg.draggable = false;
      banner.appendChild(bImg);
    }
    const scrim = document.createElement('span');
    scrim.className = 'srv-banner-scrim';
    scrim.setAttribute('aria-hidden', 'true');
    banner.appendChild(scrim);
    article.appendChild(banner);

    // Icon row
    const iconRow = document.createElement('div');
    iconRow.className = 'srv-icon-row';
    const iconFrame = document.createElement('div');
    iconFrame.className = 'srv-icon-frame';
    if (card.iconUrl && card.iconUrl.startsWith('https://cdn.discordapp.com/')) {
      const img = document.createElement('img');
      img.src = card.iconUrl;
      img.alt = card.name || '';
      img.className = 'srv-icon-img';
      img.width = 64;
      img.height = 64;
      img.draggable = false;
      iconFrame.appendChild(img);
    } else {
      const fb = document.createElement('span');
      fb.className = 'srv-icon-fallback';
      fb.textContent = card.initials || 'PW';
      iconFrame.appendChild(fb);
    }
    iconRow.appendChild(iconFrame);
    article.appendChild(iconRow);

    // Body
    const body = document.createElement('div');
    body.className = 'srv-body';

    const titleRow = document.createElement('div');
    titleRow.className = 'srv-title-row';
    const h2 = document.createElement('h2');
    h2.className = 'srv-name';
    h2.textContent = card.name || card.code || '';
    titleRow.appendChild(h2);
    const badgeEl = buildBadgeSvg(card.badge, i18n);
    if (badgeEl) titleRow.appendChild(badgeEl);
    body.appendChild(titleRow);

    // Counts (eksik sayı gizlenir, 0 sayılmaz)
    const hasOnline = typeof card.onlineCount === 'number' && Number.isFinite(card.onlineCount);
    const hasMember = typeof card.memberCount === 'number' && Number.isFinite(card.memberCount);
    if (hasOnline || hasMember) {
      const counts = document.createElement('div');
      counts.className = 'srv-counts';
      if (hasOnline) {
        const item = document.createElement('span');
        item.className = 'srv-count-item srv-count-online';
        const dot = document.createElement('span');
        dot.className = 'srv-dot-online';
        const num = document.createElement('span');
        num.className = 'srv-count-num';
        num.textContent = formatNum(card.onlineCount);
        const lbl = document.createElement('span');
        lbl.className = 'srv-count-label';
        lbl.textContent = i18n.onlineLabel || 'Çevrim içi';
        item.append(dot, num, lbl);
        counts.appendChild(item);
      }
      if (hasMember) {
        const item = document.createElement('span');
        item.className = 'srv-count-item srv-count-member';
        const dot = document.createElement('span');
        dot.className = 'srv-dot-member';
        const num = document.createElement('span');
        num.className = 'srv-count-num';
        num.textContent = formatNum(card.memberCount);
        const lbl = document.createElement('span');
        lbl.className = 'srv-count-label';
        lbl.textContent = i18n.membersLabel || 'Üye';
        item.append(dot, num, lbl);
        counts.appendChild(item);
      }
      body.appendChild(counts);
    }

    if (createdMonthText) {
      const created = document.createElement('div');
      created.className = 'srv-created';
      const prefix = document.createElement('span');
      prefix.textContent = `${i18n.createdPrefix || 'Oluşturulma:'} `;
      const val = document.createElement('strong');
      val.className = 'srv-created-val';
      val.textContent = createdMonthText;
      created.append(prefix, val);
      body.appendChild(created);
    }

    if (Array.isArray(card.gameApps) && card.gameApps.length > 0) {
      const games = document.createElement('div');
      games.className = 'srv-games';
      card.gameApps.slice(0, 6).forEach((app) => {
        if (!app || !app.iconUrl || !app.iconUrl.startsWith('https://cdn.discordapp.com/')) return;
        const gImg = document.createElement('img');
        gImg.src = app.iconUrl;
        gImg.alt = app.name || '';
        gImg.title = app.name || '';
        gImg.className = 'srv-game-icon';
        gImg.width = 28;
        gImg.height = 28;
        games.appendChild(gImg);
      });
      if (games.children.length > 0) body.appendChild(games);
    }

    if (Array.isArray(card.traits) && card.traits.length > 0) {
      const traits = document.createElement('div');
      traits.className = 'srv-traits';
      card.traits.slice(0, 6).forEach((tr) => {
        if (!tr || !tr.label) return;
        const chip = document.createElement('span');
        chip.className = 'srv-trait-chip';
        if (tr.emojiUrl && tr.emojiUrl.startsWith('https://cdn.discordapp.com/')) {
          const eImg = document.createElement('img');
          eImg.src = tr.emojiUrl;
          eImg.alt = '';
          eImg.className = 'srv-trait-emoji';
          eImg.width = 14;
          eImg.height = 14;
          chip.appendChild(eImg);
        } else if (tr.emoji) {
          const eSpan = document.createElement('span');
          eSpan.className = 'srv-trait-emoji-text';
          eSpan.textContent = tr.emoji;
          chip.appendChild(eSpan);
        }
        const tSpan = document.createElement('span');
        tSpan.className = 'srv-trait-label';
        tSpan.textContent = tr.label;
        chip.appendChild(tSpan);
        traits.appendChild(chip);
      });
      if (traits.children.length > 0) body.appendChild(traits);
    }

    article.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'srv-footer';
    const actions = document.createElement('div');
    actions.className = 'srv-actions';
    const joinBtn = document.createElement('span');
    joinBtn.className = 'srv-join-btn';
    joinBtn.textContent = i18n.joinBtn || 'Sunucuya git';
    actions.appendChild(joinBtn);
    footer.appendChild(actions);
    article.appendChild(footer);

    return article;
  }

  function initAdminServersPage() {
    const page = document.getElementById('adminServersPage');
    if (!page) return;

    const csrfToken = page.getAttribute('data-csrf') || '';
    const i18n = parseJsonAttr(page, 'data-admin-servers-i18n', { lang: 'tr', numberLocale: 'tr-TR' });

    const feedbackBox = document.getElementById('adminServersFeedback');
    const feedbackText = document.getElementById('adminServersFeedbackText');
    const inviteInput = document.getElementById('serverInviteInput');
    const labelInput = document.getElementById('serverLabelInput');
    const verifyBtn = document.getElementById('verifyInviteBtn');
    const addForm = document.getElementById('addServerForm');
    const addSubmitBtn = document.getElementById('addServerSubmitBtn');
    const idemInput = document.getElementById('addServerIdempotencyKey');

    const verifyErrorBox = document.getElementById('verifyErrorBox');
    const verifyExpiryWarnBox = document.getElementById('verifyExpiryWarnBox');
    const verifyFlaggedWarnBox = document.getElementById('verifyFlaggedWarnBox');
    const verifyFlaggedText = document.getElementById('verifyFlaggedText');
    const confirmFlaggedCheckbox = document.getElementById('confirmFlaggedCheckbox');
    const previewEmpty = document.getElementById('serverVerifyPreviewEmpty');
    const previewSlot = document.getElementById('serverVerifyPreviewSlot');

    const listEl = document.getElementById('adminServersList');
    const refreshAllBtn = document.getElementById('refreshAllServersBtn');

    function showFeedback(msg, isError) {
      if (!feedbackBox || !feedbackText) return;
      feedbackText.textContent = msg;
      feedbackBox.classList.toggle('alert-danger', Boolean(isError));
      feedbackBox.classList.toggle('alert-success', !isError);
      feedbackBox.hidden = false;
    }

    function formatExpiryDate(iso) {
      try {
        const dt = new Date(iso);
        if (Number.isNaN(dt.getTime())) return iso;
        return new Intl.DateTimeFormat(i18n.numberLocale || 'tr-TR', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(dt);
      } catch (_) {
        return iso;
      }
    }

    // --------------------------------------------------------------------------
    // 1) CANLI DAVET DOĞRULAMA & ÜYE KARTI ÖNİZLEME
    // --------------------------------------------------------------------------
    let verifyBusy = false;
    if (verifyBtn && inviteInput) {
      verifyBtn.addEventListener('click', async () => {
        if (verifyBusy) return;
        const val = inviteInput.value.trim();
        if (!val) {
          inviteInput.focus();
          return;
        }

        verifyBusy = true;
        verifyBtn.disabled = true;
        verifyBtn.textContent = i18n.verifying || 'Doğrulanıyor…';
        if (verifyErrorBox) verifyErrorBox.hidden = true;
        if (verifyExpiryWarnBox) verifyExpiryWarnBox.hidden = true;
        if (verifyFlaggedWarnBox) verifyFlaggedWarnBox.hidden = true;
        if (confirmFlaggedCheckbox) confirmFlaggedCheckbox.checked = false;

        try {
          const resp = await fetch('/yonetim/sunucular/api/dogrula', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({ invite: val }),
          });
          const data = await resp.json().catch(() => null);

          if (!resp.ok || !data || !data.ok) {
            if (verifyErrorBox) {
              verifyErrorBox.textContent = (data && data.error) || i18n.errGeneric || 'Doğrulanamadı.';
              verifyErrorBox.hidden = false;
            }
            if (previewSlot) {
              previewSlot.hidden = true;
              previewSlot.replaceChildren();
            }
            if (previewEmpty) previewEmpty.hidden = false;
            return;
          }

          // Yedek ad alanı boşsa sunucu adını öner
          if (labelInput && !labelInput.value.trim() && data.preview && data.preview.name) {
            labelInput.value = data.preview.name;
          }

          if (data.expiresAt && verifyExpiryWarnBox) {
            const fmt = i18n.expiresWarn || 'Bu davetin süresi dolacak: {date}, kalıcı davet oluşturman önerilir';
            verifyExpiryWarnBox.textContent = `⏳ ${fmt.replace('{date}', formatExpiryDate(data.expiresAt))}`;
            verifyExpiryWarnBox.hidden = false;
          }

          if (data.flagged && verifyFlaggedWarnBox && verifyFlaggedText) {
            const reasons = Array.isArray(data.flaggedReasons) ? data.flaggedReasons.join(', ') : '';
            const baseWarn = i18n.flaggedWarn || 'Sunucu adı/etiketlerinde otomatik filtre eşleşmesi bulundu.';
            verifyFlaggedText.textContent = reasons ? `${baseWarn} (${reasons})` : baseWarn;
            verifyFlaggedWarnBox.hidden = false;
          }

          if (previewSlot && data.preview) {
            previewSlot.replaceChildren(
              buildMemberPreviewCardEl(data.preview, data.createdMonthText || '', i18n)
            );
            previewSlot.hidden = false;
            if (previewEmpty) previewEmpty.hidden = true;
          }
        } catch (_) {
          if (verifyErrorBox) {
            verifyErrorBox.textContent = i18n.errGeneric || 'Doğrulanamadı.';
            verifyErrorBox.hidden = false;
          }
        } finally {
          verifyBusy = false;
          verifyBtn.disabled = false;
          verifyBtn.textContent = `🔍 ${i18n.verifyBtn || 'Doğrula'}`;
        }
      });
    }

    // Çift gönderim koruması (Ekle formu)
    if (addForm && addSubmitBtn) {
      addForm.addEventListener('submit', (e) => {
        if (addForm.dataset.submitting === 'true') {
          e.preventDefault();
          return;
        }
        if (verifyFlaggedWarnBox && !verifyFlaggedWarnBox.hidden && confirmFlaggedCheckbox && !confirmFlaggedCheckbox.checked) {
          e.preventDefault();
          confirmFlaggedCheckbox.focus();
          return;
        }
        addForm.dataset.submitting = 'true';
        addSubmitBtn.disabled = true;
        addSubmitBtn.textContent = i18n.adding || 'Ekleniyor…';
      });
    }

    // --------------------------------------------------------------------------
    // 2) YUKARI / AŞAĞI VE SÜRÜKLE-BIRAK SIRALAMA
    // --------------------------------------------------------------------------
    async function persistCurrentOrder() {
      if (!listEl) return;
      const rows = Array.from(listEl.querySelectorAll('.admin-srv-row'));
      const ids = rows.map((r) => r.getAttribute('data-server-id')).filter(Boolean);

      rows.forEach((row, idx) => {
        const orderEl = row.querySelector('.admin-srv-order-num');
        if (orderEl) orderEl.textContent = `#${idx + 1}`;
        const upBtn = row.querySelector('.admin-srv-move-up');
        const downBtn = row.querySelector('.admin-srv-move-down');
        if (upBtn) upBtn.disabled = idx === 0;
        if (downBtn) downBtn.disabled = idx === rows.length - 1;
      });

      try {
        const resp = await fetch('/yonetim/sunucular/sirala', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({ order: ids }),
        });
        const data = await resp.json().catch(() => null);
        if (resp.ok && data && data.ok) {
          showFeedback(data.message || 'Sıralama güncellendi.', false);
        } else {
          showFeedback((data && data.error) || i18n.errGeneric || 'Sıralama kaydedilemedi.', true);
        }
      } catch (_) {
        showFeedback(i18n.errGeneric || 'Sıralama kaydedilemedi.', true);
      }
    }

    if (listEl) {
      // Yukarı / Aşağı butonları
      listEl.addEventListener('click', (e) => {
        const upBtn = e.target.closest('.admin-srv-move-up');
        const downBtn = e.target.closest('.admin-srv-move-down');
        if (!upBtn && !downBtn) return;
        const row = e.target.closest('.admin-srv-row');
        if (!row) return;
        if (upBtn && row.previousElementSibling) {
          listEl.insertBefore(row, row.previousElementSibling);
          persistCurrentOrder();
        } else if (downBtn && row.nextElementSibling) {
          listEl.insertBefore(row.nextElementSibling, row);
          persistCurrentOrder();
        }
      });

      // HTML5 Sürükle-Bırak
      let draggedRow = null;
      listEl.addEventListener('dragstart', (e) => {
        const row = e.target.closest('.admin-srv-row');
        if (!row) return;
        draggedRow = row;
        row.classList.add('is-dragging-row');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          try {
            e.dataTransfer.setData('text/plain', row.getAttribute('data-server-id') || '');
          } catch (_) {}
        }
      });

      listEl.addEventListener('dragover', (e) => {
        if (!draggedRow) return;
        e.preventDefault();
        const target = e.target.closest('.admin-srv-row');
        if (!target || target === draggedRow) return;
        const rect = target.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        if (after) {
          listEl.insertBefore(draggedRow, target.nextElementSibling);
        } else {
          listEl.insertBefore(draggedRow, target);
        }
      });

      listEl.addEventListener('dragend', () => {
        if (!draggedRow) return;
        draggedRow.classList.remove('is-dragging-row');
        draggedRow = null;
        persistCurrentOrder();
      });
    }

    // --------------------------------------------------------------------------
    // 3) DÜZENLEME VE SİLME MODALLARI
    // --------------------------------------------------------------------------
    const editModal = document.getElementById('editServerModal');
    const editForm = document.getElementById('editServerForm');
    const editLabelInput = document.getElementById('editServerLabelInput');
    const editNoteInput = document.getElementById('editServerNoteInput');
    const editCloseBtn = document.getElementById('editServerCloseBtn');
    const editCancelBtn = document.getElementById('editServerCancelBtn');

    const deleteModal = document.getElementById('deleteServerModal');
    const deleteForm = document.getElementById('deleteServerForm');
    const deleteDesc = document.getElementById('deleteServerModalDesc');
    const deleteCloseBtn = document.getElementById('deleteServerCloseBtn');
    const deleteCancelBtn = document.getElementById('deleteServerCancelBtn');

    function closeModal(modalEl) {
      if (!modalEl) return;
      modalEl.hidden = true;
      modalEl.setAttribute('aria-hidden', 'true');
    }

    function openModal(modalEl) {
      if (!modalEl) return;
      modalEl.hidden = false;
      modalEl.setAttribute('aria-hidden', 'false');
    }

    if (editCloseBtn) editCloseBtn.addEventListener('click', () => closeModal(editModal));
    if (editCancelBtn) editCancelBtn.addEventListener('click', () => closeModal(editModal));
    if (editModal) {
      editModal.addEventListener('click', (e) => {
        if (e.target === editModal) closeModal(editModal);
      });
    }

    if (deleteCloseBtn) deleteCloseBtn.addEventListener('click', () => closeModal(deleteModal));
    if (deleteCancelBtn) deleteCancelBtn.addEventListener('click', () => closeModal(deleteModal));
    if (deleteModal) {
      deleteModal.addEventListener('click', (e) => {
        if (e.target === deleteModal) closeModal(deleteModal);
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal(editModal);
        closeModal(deleteModal);
      }
    });

    if (listEl) {
      listEl.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.admin-srv-edit-btn');
        if (editBtn) {
          const row = editBtn.closest('.admin-srv-row');
          const id = editBtn.getAttribute('data-server-id');
          if (!id || !editForm) return;
          editForm.action = `/yonetim/sunucular/${encodeURIComponent(id)}/duzenle`;
          if (editLabelInput) editLabelInput.value = (row && row.getAttribute('data-server-label')) || '';
          if (editNoteInput) editNoteInput.value = (row && row.getAttribute('data-server-note')) || '';
          openModal(editModal);
          if (editLabelInput) editLabelInput.focus();
          return;
        }

        const delBtn = e.target.closest('.admin-srv-delete-btn');
        if (delBtn) {
          const id = delBtn.getAttribute('data-server-id');
          const name = delBtn.getAttribute('data-server-name') || '';
          if (!id || !deleteForm) return;
          deleteForm.action = `/yonetim/sunucular/${encodeURIComponent(id)}/sil`;
          if (deleteDesc) {
            const tmpl = i18n.deleteConfirmText || '"{name}" sunucusunu listeden kalıcı olarak silmek istiyor musun?';
            deleteDesc.textContent = tmpl.replace('{name}', name);
          }
          openModal(deleteModal);
          return;
        }

        const singleRefreshBtn = e.target.closest('.admin-srv-refresh-btn');
        if (singleRefreshBtn) {
          const id = singleRefreshBtn.getAttribute('data-server-id');
          if (!id) return;
          runSingleRefresh(id);
        }
      });
    }

    // --------------------------------------------------------------------------
    // 4) ORBITAL LOADER İLE TEKİL VE TOPLU ŞİMDİ YENİLE (CANLI % İLERLEME)
    // --------------------------------------------------------------------------
    function getOrbital() {
      return global.NexusOrbitalOverlay || null;
    }

    async function runSingleRefresh(id) {
      const orbital = getOrbital();
      if (orbital) {
        orbital.openIndeterminate(i18n.loaderRefreshingOne || 'Sunucu bilgileri güncelleniyor…', '');
      }
      try {
        const resp = await fetch(`/yonetim/sunucular/${encodeURIComponent(id)}/yenile`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'X-CSRF-Token': csrfToken,
          },
        });
        const data = await resp.json().catch(() => null);
        if (resp.ok && data && data.ok) {
          if (orbital) orbital.switchToSuccess(i18n.loaderSuccess || 'Güncellendi!');
          global.setTimeout(() => global.location.reload(), 500);
        } else {
          const msg = (data && data.error) || i18n.errGeneric || 'Yenilenemedi.';
          if (orbital) orbital.switchToError(i18n.loaderErrorTitle || 'Hata', msg);
          else showFeedback(msg, true);
        }
      } catch (_) {
        const msg = i18n.errGeneric || 'Yenilenemedi.';
        if (orbital) orbital.switchToError(i18n.loaderErrorTitle || 'Hata', msg);
        else showFeedback(msg, true);
      }
    }

    if (refreshAllBtn) {
      let allBusy = false;
      refreshAllBtn.addEventListener('click', async () => {
        if (allBusy) return;
        allBusy = true;
        refreshAllBtn.disabled = true;

        const orbital = getOrbital();
        if (orbital) {
          orbital.openUploading(i18n.loaderRefreshingAll || 'Tüm sunucular güncelleniyor…');
          orbital.setProgress(5);
        }

        try {
          const resp = await fetch('/yonetim/sunucular/yenile-hepsi?stream=1', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              Accept: 'application/x-ndjson, application/json',
              'X-CSRF-Token': csrfToken,
            },
          });

          if (!resp.ok) {
            throw new Error(`HTTP_${resp.status}`);
          }

          if (resp.body && typeof resp.body.getReader === 'function') {
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                const t = line.trim();
                if (!t) continue;
                try {
                  const ev = JSON.parse(t);
                  if (ev.type === 'progress' && orbital && ev.total > 0) {
                    const pct = Math.round((ev.index / ev.total) * 100);
                    orbital.setProgress(pct);
                  } else if (ev.type === 'error') {
                    throw new Error(ev.error || 'REFRESH_ERROR');
                  }
                } catch (parseErr) {
                  if (parseErr && parseErr.message && parseErr.message !== 'Unexpected end of JSON input') {
                    throw parseErr;
                  }
                }
              }
            }
          }

          if (orbital) {
            orbital.setProgress(100);
            orbital.switchToSuccess(i18n.loaderSuccess || 'Tüm sunucular güncellendi!');
          }
          global.setTimeout(() => global.location.reload(), 600);
        } catch (err) {
          allBusy = false;
          refreshAllBtn.disabled = false;
          const msg = (err && err.message && !err.message.startsWith('HTTP_') ? err.message : null) || i18n.errGeneric || 'Yenileme başarısız.';
          if (orbital) orbital.switchToError(i18n.loaderErrorTitle || 'Güncelleme Hatası', msg);
          else showFeedback(msg, true);
        }
      });
    }

    // İdempotency input varsa yenileme yardımcısı
    if (idemInput && !idemInput.value) {
      fetch('/yonetim/sunucular/api/idempotency-key', { headers: { Accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d && d.idempotencyKey) idemInput.value = d.idempotencyKey;
        })
        .catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', initAdminServersPage);
})(window);
