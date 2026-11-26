/**
 * ==============================================================================
 * 🛡️ PIYADE WORLD — İHLAL BİLDİRİMİ TUŞ TAKIMI VE YAYLANMA (NexusSpring) İSTEMCİSİ
 * ==============================================================================
 * - 10 kategori düğmesine basılınca aşağıda NexusSpring yaylanmasıyla formu açar.
 * - Telif/DMCA kategorisinde ek zorunlu alanları gösterir.
 * - En çok 3 görsel (PNG/JPG/WEBP, <=5 MB) ön kontrolü + X-CSRF-Token AJAX gönderimi.
 * - Tüm kullanıcı metinleri textContent ile yazılır; sabit #hex renk yoktur.
 * ==============================================================================
 */
(function () {
  'use strict';

  const bootEl = document.getElementById('reportFormBootstrapData');
  if (!bootEl) return;

  let boot;
  try {
    boot = JSON.parse(bootEl.textContent || '{}');
  } catch (_) {
    return;
  }

  const i18n = boot.i18n || {};
  const formPanel = document.getElementById('reportFormPanel');
  const formEl = document.getElementById('abuseReportForm');
  const catInput = document.getElementById('reportCategoryInput');
  const selectedBadge = document.getElementById('reportSelectedBadge');
  const dmcaSection = document.getElementById('reportDmcaSection');
  const emailReqMark = document.getElementById('reportEmailReqMark');
  const descInput = document.getElementById('reportDescription');
  const descCounter = document.getElementById('reportDescCounter');
  const fileInput = document.getElementById('reportEvidenceFiles');
  const fileList = document.getElementById('reportFileList');
  const errorBox = document.getElementById('reportFormError');
  const submitBtn = document.getElementById('reportSubmitBtn');
  const successCard = document.getElementById('reportSuccessCard');
  const trackingVal = document.getElementById('reportTrackingCodeValue');
  const lookupLink = document.getElementById('reportLookupDirectLink');
  const catButtons = Array.from(document.querySelectorAll('[data-report-cat]'));

  let springRaf = null;

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function animatePanelOpenWithSpring() {
    if (!formPanel) return;
    formPanel.hidden = false;
    formPanel.classList.add('is-open');

    if (prefersReducedMotion() || !window.NexusSpring) {
      formPanel.style.opacity = '1';
      formPanel.style.transform = 'translateY(0px) scale(1)';
      return;
    }

    if (springRaf) cancelAnimationFrame(springRaf);
    const spring = window.NexusSpring.create(0, { stiffness: 320, damping: 22, mass: 0.9 });
    spring.target = 1;
    let lastTs = performance.now();

    const tick = (now) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;
      const running = window.NexusSpring.step(spring, dt);
      const v = spring.value;
      const opacity = Math.min(1, Math.max(0, v));
      const y = (1 - v) * 24;
      const scale = 0.96 + Math.min(1.02, v) * 0.04;
      formPanel.style.opacity = String(opacity);
      formPanel.style.transform = `translateY(${y.toFixed(2)}px) scale(${scale.toFixed(4)})`;
      if (running) {
        springRaf = requestAnimationFrame(tick);
      } else {
        formPanel.style.opacity = '1';
        formPanel.style.transform = 'none';
        springRaf = null;
      }
    };
    springRaf = requestAnimationFrame(tick);
  }

  function selectCategory(catId, { scrollIntoView = true } = {}) {
    if (!catId) return;
    let matchedBtn = null;
    for (const btn of catButtons) {
      const active = btn.dataset.reportCat === catId;
      btn.classList.toggle('is-selected', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (active) matchedBtn = btn;
    }
    if (!matchedBtn) return;

    if (catInput) catInput.value = catId;
    if (selectedBadge) {
      selectedBadge.textContent = `${matchedBtn.dataset.reportEmoji || ''} ${matchedBtn.dataset.reportLabel || catId}`.trim();
    }

    const isDmca = catId === 'copyright_dmca';
    if (dmcaSection) dmcaSection.hidden = !isDmca;
    if (emailReqMark) emailReqMark.hidden = !isDmca;

    const wasHidden = formPanel && formPanel.hidden;
    animatePanelOpenWithSpring();

    if (scrollIntoView && formPanel) {
      try {
        formPanel.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
      } catch (_) {}
    }
    if (wasHidden && descInput) {
      // Kullanıcı rahatça yazabilsin
    }
  }

  catButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (errorBox) errorBox.hidden = true;
      selectCategory(btn.dataset.reportCat, { scrollIntoView: true });
    });
  });

  if (boot.preselectedCategory) {
    selectCategory(boot.preselectedCategory, { scrollIntoView: false });
  }

  function updateCounter() {
    if (!descInput || !descCounter) return;
    descCounter.textContent = `${descInput.value.length} / 2000`;
  }
  if (descInput) {
    descInput.addEventListener('input', updateCounter);
    updateCounter();
  }

  function showError(msg) {
    if (!errorBox) return;
    errorBox.textContent = msg || i18n.genericError || 'Hata oluştu.';
    errorBox.hidden = false;
    try {
      errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (_) {}
  }

  function renderSelectedFiles() {
    if (!fileList || !fileInput) return;
    fileList.replaceChildren();
    const files = Array.from(fileInput.files || []);
    if (files.length === 0) return;

    const maxFiles = Number(boot.maxFiles) || 3;
    const maxBytes = Number(boot.maxBytes) || 5 * 1024 * 1024;
    if (files.length > maxFiles) {
      showError(i18n.errMaxFiles);
      fileInput.value = '';
      return;
    }

    for (const f of files) {
      if (f.size > maxBytes) {
        showError(i18n.errFileTooLarge);
        fileInput.value = '';
        fileList.replaceChildren();
        return;
      }
      const chip = document.createElement('span');
      chip.className = 'badge badge-neutral report-file-chip';
      const kb = Math.max(1, Math.round(f.size / 1024));
      chip.textContent = `🖼️ ${f.name} (${kb} KB)`;
      fileList.appendChild(chip);
    }
  }

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      if (errorBox) errorBox.hidden = true;
      renderSelectedFiles();
    });
  }

  if (formEl) {
    formEl.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (errorBox) errorBox.hidden = true;

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = `⏳ ${i18n.submittingBtn || 'Gönderiliyor...'}`;
      }

      try {
        const fd = new FormData(formEl);
        const resp = await fetch(boot.actionUrl || '/bildir', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'X-CSRF-Token': boot.csrfToken || '',
          },
          body: fd,
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.ok) {
          showError(data.error || i18n.genericError);
          return;
        }

        if (trackingVal) trackingVal.textContent = data.trackingCode || '';
        if (lookupLink && data.lookupUrl) lookupLink.href = data.lookupUrl;
        if (successCard) {
          successCard.hidden = false;
          try {
            successCard.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
          } catch (_) {}
        }
        formEl.reset();
        updateCounter();
        if (fileList) fileList.replaceChildren();
        if (formPanel) formPanel.hidden = true;
        catButtons.forEach((b) => {
          b.classList.remove('is-selected');
          b.setAttribute('aria-pressed', 'false');
        });
      } catch (_) {
        showError(i18n.genericError);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = `📨 ${i18n.submitBtn || 'Bildirimi Gönder'}`;
        }
      }
    });
  }
})();
