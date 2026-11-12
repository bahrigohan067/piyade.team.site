/**
 * ==============================================================================
 * 👑 KLANIN ZİRVESİ — DEVELOPER YÖNETİM PANELİ ETKİLEŞİMLERİ (VANİLLA JS)
 * ==============================================================================
 * - Yukarı/aşağı sıra değiştirme, 3-8 satır ekleme/kaldırma
 * - Seçilen özel görsel (PNG/JPG/WEBP <= 2 MB) önizleme & "Roblox Avatarını Kullan" sıfırlama
 * - Değiştirilmiş satırları kaydetmeden önce vurgulama (is-dirty) ve değişiklik göstergesi
 * - Tüm kullanıcı verilerinde yalnızca textContent kullanır, sabit hex renk içermez
 * ==============================================================================
 */
(function (global) {
  'use strict';

  function parseJsonAttr(el, attrName, fallback = {}) {
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

  function initWarriorsAdminPanel() {
    const form = document.getElementById('adminWarriorsForm');
    const listEl = document.getElementById('warriorsAdminList');
    if (!form || !listEl) return;

    const addBtn = document.getElementById('warriorsAddRowBtn');
    const dirtyBadge = document.getElementById('warriorsDirtyBadge');
    const errorBanner = document.getElementById('warriorsErrorBanner');
    const errorText = document.getElementById('warriorsErrorText');

    const minWarriors = Number.parseInt(form.getAttribute('data-min-warriors') || '3', 10) || 3;
    const maxWarriors = Number.parseInt(form.getAttribute('data-max-warriors') || '8', 10) || 8;
    const maxImageBytes = Number.parseInt(form.getAttribute('data-max-image-bytes') || String(2 * 1024 * 1024), 10);
    const i18n = parseJsonAttr(form, 'data-admin-i18n', {
      modeRoblox: 'Roblox Avatarı',
      modeCustom: 'Özel Görsel',
      newFilePending: 'Yeni dosya seçildi',
      errFileTooLarge: 'Görsel boyutu en fazla 2 MB olabilir.',
      errInvalidFile: 'Sadece PNG, JPG veya WEBP yükleyiniz.',
    });

    function showError(msg) {
      if (!errorBanner || !errorText) return;
      errorText.textContent = msg;
      errorBanner.hidden = false;
      errorBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function clearError() {
      if (errorBanner) errorBanner.hidden = true;
    }

    function getRows() {
      return Array.from(listEl.querySelectorAll('.warriors-admin-row'));
    }

    function snapshotRow(row) {
      const id = row.querySelector('input[name="rowId"]')?.value || '';
      const username = (row.querySelector('input[name="robloxUsername"]')?.value || '').trim();
      const kills = (row.querySelector('input[name="kills"]')?.value || '').trim();
      const imageMode = row.querySelector('input[name="imageMode"]')?.value || 'roblox';
      const customImageFile = row.querySelector('input[name="customImageFile"]')?.value || '';
      const hasNewFile = Boolean(row.querySelector('[data-row-file-input]')?.files?.length);
      return { id, username, kills, imageMode, customImageFile, hasNewFile };
    }

    const initialSnapshots = getRows().map((r) => snapshotRow(r));
    let nextSlotCounter = getRows().length;

    function syncRowControlsAndDirtyState() {
      const rows = getRows();
      let anyDirty = rows.length !== initialSnapshots.length;

      rows.forEach((row, idx) => {
        const rankPill = row.querySelector('[data-rank-pill]');
        if (rankPill) rankPill.textContent = `#${idx + 1}`;

        const upBtn = row.querySelector('[data-move-up]');
        const downBtn = row.querySelector('[data-move-down]');
        const removeBtn = row.querySelector('[data-remove-row]');

        if (upBtn) upBtn.disabled = idx === 0;
        if (downBtn) downBtn.disabled = idx === rows.length - 1;
        if (removeBtn) removeBtn.disabled = rows.length <= minWarriors;

        const cur = snapshotRow(row);
        const orig = initialSnapshots[idx];
        const rowChanged =
          !orig ||
          cur.id !== orig.id ||
          cur.username !== orig.username ||
          cur.kills !== orig.kills ||
          cur.imageMode !== orig.imageMode ||
          cur.customImageFile !== orig.customImageFile ||
          cur.hasNewFile;

        row.classList.toggle('is-dirty', rowChanged);
        if (rowChanged) anyDirty = true;
      });

      if (addBtn) addBtn.disabled = rows.length >= maxWarriors;
      if (dirtyBadge) dirtyBadge.hidden = !anyDirty;
    }

    function wireRowEvents(row) {
      const usernameInput = row.querySelector('input[name="robloxUsername"]');
      const killsInput = row.querySelector('input[name="kills"]');
      const fileInput = row.querySelector('[data-row-file-input]');
      const resetBtn = row.querySelector('[data-reset-roblox]');
      const upBtn = row.querySelector('[data-move-up]');
      const downBtn = row.querySelector('[data-move-down]');
      const removeBtn = row.querySelector('[data-remove-row]');
      const modeInput = row.querySelector('input[name="imageMode"]');
      const customFileInput = row.querySelector('input[name="customImageFile"]');
      const modeBadge = row.querySelector('[data-mode-badge]');
      const thumbBox = row.querySelector('.warriors-admin-thumb-box');
      const thumbImg = row.querySelector('.warriors-admin-thumb-img');
      const silhouetteEl = row.querySelector('.warriors-silhouette');

      if (usernameInput) {
        usernameInput.addEventListener('input', syncRowControlsAndDirtyState);
      }
      if (killsInput) {
        killsInput.addEventListener('input', syncRowControlsAndDirtyState);
      }

      if (fileInput) {
        fileInput.addEventListener('change', () => {
          clearError();
          const file = fileInput.files && fileInput.files[0];
          if (!file) {
            syncRowControlsAndDirtyState();
            return;
          }

          const lowerName = String(file.name || '').toLowerCase();
          const lowerType = String(file.type || '').toLowerCase();
          if (lowerName.endsWith('.svg') || lowerName.endsWith('.svgz') || lowerType.includes('svg')) {
            fileInput.value = '';
            showError(i18n.errInvalidFile);
            syncRowControlsAndDirtyState();
            return;
          }

          if (file.size > maxImageBytes) {
            fileInput.value = '';
            showError(i18n.errFileTooLarge);
            syncRowControlsAndDirtyState();
            return;
          }

          if (modeInput) modeInput.value = 'custom';
          if (modeBadge) modeBadge.textContent = `${i18n.modeCustom} • ${i18n.newFilePending}`;
          if (resetBtn) resetBtn.hidden = false;

          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === 'string' && thumbImg) {
              thumbImg.src = reader.result;
              thumbImg.hidden = false;
              if (silhouetteEl) silhouetteEl.hidden = true;
            }
          };
          reader.readAsDataURL(file);
          syncRowControlsAndDirtyState();
        });
      }

      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          if (fileInput) fileInput.value = '';
          if (modeInput) modeInput.value = 'roblox';
          if (customFileInput) customFileInput.value = '';
          if (modeBadge) modeBadge.textContent = i18n.modeRoblox;
          resetBtn.hidden = true;

          const fallbackPreview = thumbBox ? thumbBox.getAttribute('data-roblox-preview') : '';
          if (fallbackPreview && thumbImg) {
            thumbImg.src = fallbackPreview;
            thumbImg.hidden = false;
            if (silhouetteEl) silhouetteEl.hidden = true;
          } else {
            if (thumbImg) {
              thumbImg.removeAttribute('src');
              thumbImg.hidden = true;
            }
            if (silhouetteEl) silhouetteEl.hidden = false;
          }
          syncRowControlsAndDirtyState();
        });
      }

      if (upBtn) {
        upBtn.addEventListener('click', () => {
          const prev = row.previousElementSibling;
          if (prev) {
            listEl.insertBefore(row, prev);
            syncRowControlsAndDirtyState();
          }
        });
      }

      if (downBtn) {
        downBtn.addEventListener('click', () => {
          const next = row.nextElementSibling;
          if (next) {
            listEl.insertBefore(next, row);
            syncRowControlsAndDirtyState();
          }
        });
      }

      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          if (getRows().length <= minWarriors) return;
          row.remove();
          syncRowControlsAndDirtyState();
        });
      }
    }

    getRows().forEach(wireRowEvents);

    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const currentRows = getRows();
        if (currentRows.length >= maxWarriors || currentRows.length === 0) return;

        const templateRow = currentRows[currentRows.length - 1];
        const cloned = templateRow.cloneNode(true);
        const slotIdx = nextSlotCounter++;

        cloned.setAttribute('data-slot-index', String(slotIdx));
        const idInput = cloned.querySelector('input[name="rowId"]');
        const slotInput = cloned.querySelector('input[name="slotIndex"]');
        const modeInput = cloned.querySelector('input[name="imageMode"]');
        const customInput = cloned.querySelector('input[name="customImageFile"]');
        const userInput = cloned.querySelector('input[name="robloxUsername"]');
        const killsInput = cloned.querySelector('input[name="kills"]');
        const fileInput = cloned.querySelector('[data-row-file-input]');
        const resetBtn = cloned.querySelector('[data-reset-roblox]');
        const modeBadge = cloned.querySelector('[data-mode-badge]');
        const thumbBox = cloned.querySelector('.warriors-admin-thumb-box');
        const thumbImg = cloned.querySelector('.warriors-admin-thumb-img');
        const silhouetteEl = cloned.querySelector('.warriors-silhouette');

        if (idInput) idInput.value = `w_new_${slotIdx}`;
        if (slotInput) slotInput.value = String(slotIdx);
        if (modeInput) modeInput.value = 'roblox';
        if (customInput) customInput.value = '';
        if (userInput) userInput.value = '';
        if (killsInput) killsInput.value = '0';
        if (fileInput) {
          fileInput.name = `warriorImage_${slotIdx}`;
          fileInput.value = '';
        }
        if (resetBtn) resetBtn.hidden = true;
        if (modeBadge) modeBadge.textContent = i18n.modeRoblox;
        if (thumbBox) thumbBox.setAttribute('data-roblox-preview', '');
        if (thumbImg) {
          thumbImg.removeAttribute('src');
          thumbImg.hidden = true;
        }
        if (silhouetteEl) silhouetteEl.hidden = false;

        listEl.appendChild(cloned);
        wireRowEvents(cloned);
        syncRowControlsAndDirtyState();
        if (userInput) userInput.focus();
      });
    }

    syncRowControlsAndDirtyState();
  }

  document.addEventListener('DOMContentLoaded', initWarriorsAdminPanel);
})(window);
