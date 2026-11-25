/**
 * ==============================================================================
 * 📎 PIYADE WORLD — SOHBET DOSYA EKİ, ÖNİZLEME, XHR İLERLEME VE LIGHTBOX
 * ==============================================================================
 * - 📎 düğmesi, sürükle-bırak ve panodan (clipboard) resim yapıştırma
 * - XHR upload progress (Orbital Loader tarzında minimal halka ilerleme) + iptal
 * - Mesaj içinde resim/gif (reduced-motion'da ilk kare duraklatmalı), video, PDF/TXT kartı
 * - Tam ekran Lightbox (Esc, sol/sağ oklar, indirme düğmesi)
 * - Sıfır sabit renk kodu, tüm kullanıcı metinleri textContent ile
 * ==============================================================================
 */
(function () {
  'use strict';

  const chatApp = window.PiyadeChatApp;
  if (!chatApp) return;

  const { boot, state, showToast, updateComposerControls } = chatApp;
  const i18n = boot.i18n || {};
  const csrfToken = boot.csrfToken || '';
  const maxFiles = (boot.limits && boot.limits.maxFilesPerMessage) || 5;

  const attachBtn = document.getElementById('chatAttachBtn');
  const fileInput = document.getElementById('chatFileInput');
  const chipsContainer = document.getElementById('chatAttachmentChips');
  const threadActive = document.getElementById('chatThreadActive');
  const dropOverlay = document.getElementById('chatDropOverlay');
  const messageInput = document.getElementById('chatMessageInput');

  // Lightbox elemanları
  const lightbox = document.getElementById('chatLightboxModal');
  const lbImg = document.getElementById('chatLightboxImg');
  const lbName = document.getElementById('chatLightboxFilename');
  const lbDownload = document.getElementById('chatLightboxDownload');
  const lbClose = document.getElementById('chatLightboxCloseBtn');
  const lbPrev = document.getElementById('chatLightboxPrevBtn');
  const lbNext = document.getElementById('chatLightboxNextBtn');

  const prefersReducedMotion = () =>
    Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Bekleyen / yüklenen ekler listesi
  // item: { localId, file, name, size, previewDataUrl, progress, status: 'uploading'|'ready'|'error', xhr, uploadedMeta, error }
  const pendingItems = [];
  let lightboxImages = [];
  let lightboxIndex = 0;

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function renderChips() {
    if (!chipsContainer) return;
    chipsContainer.replaceChildren();
    chipsContainer.hidden = pendingItems.length === 0;

    for (const item of pendingItems) {
      const chip = document.createElement('div');
      chip.className = `chat-att-chip${item.status === 'error' ? ' is-error' : ''}${item.status === 'uploading' ? ' is-uploading' : ''}`;

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'chat-att-chip-thumb';
      if (item.previewDataUrl) {
        const img = document.createElement('img');
        img.src = item.previewDataUrl;
        img.alt = item.name;
        thumbWrap.appendChild(img);
      } else {
        const icon = document.createElement('span');
        const ext = (item.name.split('.').pop() || '').toLowerCase();
        icon.textContent = ext === 'mp4' || ext === 'webm' ? '🎬' : ext === 'pdf' ? '📕' : '📄';
        thumbWrap.appendChild(icon);
      }

      // Yükleme ilerleme halkası (Orbital tarzı minimal SVG)
      if (item.status === 'uploading') {
        const ring = document.createElement('div');
        ring.className = 'chat-att-progress-overlay';
        const pct = document.createElement('span');
        pct.textContent = `${Math.round(item.progress)}%`;
        ring.appendChild(pct);
        thumbWrap.appendChild(ring);
      }

      const info = document.createElement('div');
      info.className = 'chat-att-chip-info';
      const nameEl = document.createElement('span');
      nameEl.className = 'chat-att-chip-name';
      nameEl.textContent = item.name;
      const metaEl = document.createElement('span');
      metaEl.className = 'chat-att-chip-meta';
      metaEl.textContent = item.status === 'error' ? item.error || i18n.errUploadFailed : formatBytes(item.size);
      info.append(nameEl, metaEl);

      if (item.status === 'uploading') {
        const barTrack = document.createElement('div');
        barTrack.className = 'chat-att-chip-bar';
        const barFill = document.createElement('div');
        barFill.className = 'chat-att-chip-bar-fill';
        barFill.style.width = `${Math.max(4, Math.min(100, item.progress))}%`;
        barTrack.appendChild(barFill);
        info.appendChild(barTrack);
      }

      const rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.className = 'chat-att-chip-remove';
      rmBtn.textContent = '✕';
      rmBtn.title = item.status === 'uploading' ? i18n.cancelUpload || 'İptal' : i18n.removeAttachment || 'Kaldır';
      rmBtn.setAttribute('aria-label', rmBtn.title);
      rmBtn.addEventListener('click', () => removePendingItem(item.localId));

      chip.append(thumbWrap, info, rmBtn);
      chipsContainer.appendChild(chip);
    }

    updateComposerControls();
  }

  function removePendingItem(localId) {
    const idx = pendingItems.findIndex((x) => x.localId === localId);
    if (idx < 0) return;
    const item = pendingItems[idx];
    if (item.xhr && item.status === 'uploading') {
      try {
        item.xhr.abort();
      } catch (_) {}
    }
    pendingItems.splice(idx, 1);
    renderChips();
  }

  function uploadFileItem(item) {
    const xhr = new XMLHttpRequest();
    item.xhr = xhr;
    xhr.open('POST', '/sohbet/api/yukle', true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-CSRF-Token', csrfToken);
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.upload.addEventListener('progress', (ev) => {
      if (ev.lengthComputable && ev.total > 0) {
        item.progress = (ev.loaded / ev.total) * 100;
        renderChips();
      }
    });

    xhr.addEventListener('load', () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch (_) {}
      if (xhr.status >= 200 && xhr.status < 300 && data.ok && data.file) {
        item.status = 'ready';
        item.progress = 100;
        item.uploadedMeta = data.file;
        item.name = data.file.originalName || item.name;
        item.size = data.file.size || item.size;
      } else {
        item.status = 'error';
        item.error = data.error || i18n.errUploadFailed || 'Yüklenemedi';
        showToast('Uyarı', item.error, { variant: 'danger' });
      }
      item.xhr = null;
      renderChips();
    });

    xhr.addEventListener('error', () => {
      item.status = 'error';
      item.error = i18n.errUploadFailed || 'Bağlantı hatası';
      item.xhr = null;
      renderChips();
    });

    const formData = new FormData();
    formData.append('file', item.file, item.name);
    xhr.send(formData);
  }

  function enqueueFiles(fileList) {
    if (!state.activeOtherId) return;
    const files = Array.from(fileList || []).filter(Boolean);
    if (files.length === 0) return;

    const activeCount = pendingItems.filter((x) => x.status !== 'error').length;
    if (activeCount + files.length > maxFiles) {
      showToast('Uyarı', i18n.errMaxFiles || 'En fazla 5 dosya ekleyebilirsiniz.', { variant: 'warning' });
    }

    const allowedSlots = Math.max(0, maxFiles - activeCount);
    const toAdd = files.slice(0, allowedSlots);

    for (const file of toAdd) {
      const localId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const item = {
        localId,
        file,
        name: file.name || 'dosya',
        size: file.size || 0,
        previewDataUrl: null,
        progress: 0,
        status: 'uploading',
        xhr: null,
        uploadedMeta: null,
        error: null,
      };
      pendingItems.push(item);

      // Görsel önizleme için FileReader data: URL (CSP uyumlu)
      if (file.type && file.type.startsWith('image/') && file.size <= 8 * 1024 * 1024) {
        const reader = new FileReader();
        reader.onload = () => {
          item.previewDataUrl = typeof reader.result === 'string' ? reader.result : null;
          renderChips();
        };
        reader.readAsDataURL(file);
      }

      uploadFileItem(item);
    }

    renderChips();
  }

  // ==========================================================================
  // LIGHTBOX (TAM EKRAN GÖRÜNTÜLEYİCİ)
  // ==========================================================================
  function collectThreadImages() {
    const imgs = [];
    for (const msg of state.messages || []) {
      if (msg.deleted || !Array.isArray(msg.attachments)) continue;
      for (const att of msg.attachments) {
        if (att && att.category === 'image' && att.url) {
          imgs.push({ url: att.url, name: att.originalName || 'gorsel' });
        }
      }
    }
    return imgs;
  }

  function renderLightboxFrame() {
    if (!lightbox || lightboxImages.length === 0) return;
    const item = lightboxImages[lightboxIndex];
    if (!item) return;
    lbImg.src = item.url;
    lbImg.alt = item.name;
    lbName.textContent = item.name;
    lbDownload.href = item.url;
    lbDownload.setAttribute('download', item.name);
    const multi = lightboxImages.length > 1;
    lbPrev.hidden = !multi;
    lbNext.hidden = !multi;
  }

  function openLightbox(url) {
    if (!lightbox) return;
    lightboxImages = collectThreadImages();
    lightboxIndex = Math.max(
      0,
      lightboxImages.findIndex((x) => x.url === url)
    );
    if (lightboxImages.length === 0) {
      lightboxImages = [{ url, name: 'gorsel' }];
      lightboxIndex = 0;
    }
    renderLightboxFrame();
    lightbox.hidden = false;
    lightbox.setAttribute('aria-hidden', 'false');
    if (lbClose) lbClose.focus();
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.hidden = true;
    lightbox.setAttribute('aria-hidden', 'true');
    if (lbImg) lbImg.src = '';
  }

  function stepLightbox(delta) {
    if (lightboxImages.length <= 1) return;
    lightboxIndex = (lightboxIndex + delta + lightboxImages.length) % lightboxImages.length;
    renderLightboxFrame();
  }

  if (lbClose) lbClose.addEventListener('click', closeLightbox);
  if (lbPrev) lbPrev.addEventListener('click', () => stepLightbox(-1));
  if (lbNext) lbNext.addEventListener('click', () => stepLightbox(1));
  if (lightbox) {
    lightbox.addEventListener('click', (ev) => {
      if (ev.target === lightbox) closeLightbox();
    });
  }
  document.addEventListener('keydown', (ev) => {
    if (!lightbox || lightbox.hidden) return;
    if (ev.key === 'Escape') closeLightbox();
    else if (ev.key === 'ArrowLeft') stepLightbox(-1);
    else if (ev.key === 'ArrowRight') stepLightbox(1);
  });

  // ==========================================================================
  // MESAJ BALONU İÇİ EK GÖSTERİMİ
  // ==========================================================================
  function createGifElement(att) {
    const frame = document.createElement('div');
    frame.className = 'chat-att-image-frame chat-att-gif-frame';

    const img = document.createElement('img');
    img.className = 'chat-att-image';
    img.src = att.url;
    img.alt = att.originalName || 'GIF';
    img.loading = 'lazy';
    img.decoding = 'async';

    if (!prefersReducedMotion()) {
      img.addEventListener('click', () => openLightbox(att.url));
      frame.appendChild(img);
      return frame;
    }

    // prefers-reduced-motion: ilk kareyi canvas'a çiz, tıklayınca oynat
    const canvas = document.createElement('canvas');
    canvas.className = 'chat-att-gif-canvas';
    const playBadge = document.createElement('button');
    playBadge.type = 'button';
    playBadge.className = 'chat-att-gif-play-btn';
    playBadge.textContent = `▶ ${i18n.gifPlayHint || 'GIF'}`;

    let playing = false;
    img.addEventListener('load', () => {
      if (playing) return;
      try {
        canvas.width = img.naturalWidth || 240;
        canvas.height = img.naturalHeight || 180;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(img, 0, 0);
        img.hidden = true;
      } catch (_) {}
    });

    playBadge.addEventListener('click', (ev) => {
      ev.stopPropagation();
      playing = true;
      canvas.hidden = true;
      playBadge.hidden = true;
      img.hidden = false;
    });
    img.addEventListener('click', () => openLightbox(att.url));

    frame.append(img, canvas, playBadge);
    return frame;
  }

  function renderBubbleAttachments(bubbleEl, msg) {
    const list = Array.isArray(msg.attachments) ? msg.attachments : [];
    if (list.length === 0) return;

    const wrap = document.createElement('div');
    wrap.className = 'chat-att-list';

    for (const att of list) {
      if (!att || !att.url) continue;

      if (att.category === 'image') {
        if (att.ext === 'gif') {
          wrap.appendChild(createGifElement(att));
        } else {
          const frame = document.createElement('div');
          frame.className = 'chat-att-image-frame';
          const img = document.createElement('img');
          img.className = 'chat-att-image';
          img.src = att.url;
          img.alt = att.originalName || 'Görsel';
          img.loading = 'lazy';
          img.decoding = 'async';
          img.addEventListener('load', () => {
            const scroller = chatApp.els && chatApp.els.messagesScroll;
            if (scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 360) {
              chatApp.scrollThreadToBottom(false);
            }
          });
          img.addEventListener('click', () => openLightbox(att.url));
          frame.appendChild(img);
          wrap.appendChild(frame);
        }
      } else if (att.category === 'video') {
        const videoWrap = document.createElement('div');
        videoWrap.className = 'chat-att-video-wrap';
        const video = document.createElement('video');
        video.className = 'chat-att-video';
        video.controls = true;
        video.preload = 'metadata';
        video.playsInline = true;
        video.src = att.url;
        videoWrap.appendChild(video);
        wrap.appendChild(videoWrap);
      } else {
        // PDF veya TXT dosya kartı
        const card = document.createElement('div');
        card.className = 'chat-att-file-card';

        const top = document.createElement('div');
        top.className = 'chat-att-file-top';

        const icon = document.createElement('span');
        icon.className = 'chat-att-file-icon';
        icon.textContent = att.ext === 'pdf' ? '📕' : '📄';

        const meta = document.createElement('div');
        meta.className = 'chat-att-file-meta';
        const nameEl = document.createElement('strong');
        nameEl.className = 'chat-att-file-name';
        nameEl.textContent = att.originalName || `dosya.${att.ext || ''}`;
        const sizeEl = document.createElement('span');
        sizeEl.className = 'chat-att-file-size';
        sizeEl.textContent = `${String(att.ext || '').toUpperCase()} • ${formatBytes(att.size)}`;
        meta.append(nameEl, sizeEl);

        const dl = document.createElement('a');
        dl.className = 'btn btn-secondary btn-xs chat-att-download-btn';
        dl.href = att.url;
        dl.setAttribute('download', att.originalName || 'dosya');
        dl.textContent = `⬇️ ${i18n.downloadFile || 'İndir'}`;

        top.append(icon, meta, dl);
        card.appendChild(top);

        // TXT için ilk ~500 karakter güvenli textContent önizleme
        if (att.category === 'txt' && typeof att.txtPreview === 'string' && att.txtPreview.trim()) {
          const pre = document.createElement('pre');
          pre.className = 'chat-att-txt-preview';
          pre.textContent = att.txtPreview.slice(0, 500);
          card.appendChild(pre);
        }

        wrap.appendChild(card);
      }
    }

    bubbleEl.appendChild(wrap);
  }

  // ==========================================================================
  // ETKİNLİK BAĞLANTILARI (📎, SÜRÜKLE-BIRAK, PANODAN YAPIŞTIR)
  // ==========================================================================
  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        enqueueFiles(fileInput.files);
        fileInput.value = '';
      }
    });
  }

  if (messageInput) {
    messageInput.addEventListener('paste', (ev) => {
      const cd = ev.clipboardData;
      if (!cd || !cd.items) return;
      const pastedImages = [];
      for (const item of Array.from(cd.items)) {
        if (item.kind === 'file' && item.type && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) pastedImages.push(f);
        }
      }
      if (pastedImages.length > 0) {
        ev.preventDefault();
        enqueueFiles(pastedImages);
      }
    });
  }

  if (threadActive && dropOverlay) {
    let dragDepth = 0;
    threadActive.addEventListener('dragenter', (ev) => {
      if (!ev.dataTransfer || !Array.from(ev.dataTransfer.types || []).includes('Files')) return;
      ev.preventDefault();
      dragDepth += 1;
      dropOverlay.hidden = false;
    });
    threadActive.addEventListener('dragover', (ev) => {
      if (!ev.dataTransfer || !Array.from(ev.dataTransfer.types || []).includes('Files')) return;
      ev.preventDefault();
    });
    threadActive.addEventListener('dragleave', (ev) => {
      if (!ev.dataTransfer || !Array.from(ev.dataTransfer.types || []).includes('Files')) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) dropOverlay.hidden = true;
    });
    threadActive.addEventListener('drop', (ev) => {
      ev.preventDefault();
      dragDepth = 0;
      dropOverlay.hidden = true;
      if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length > 0) {
        enqueueFiles(ev.dataTransfer.files);
      }
    });
  }

  window.PiyadeChatAttachments = {
    renderBubbleAttachments,
    hasPendingFiles: () => pendingItems.some((x) => x.status === 'ready'),
    isUploading: () => pendingItems.some((x) => x.status === 'uploading'),
    getReadyFiles: () => pendingItems.filter((x) => x.status === 'ready' && x.uploadedMeta).map((x) => x.uploadedMeta),
    clearAll: () => {
      for (const item of pendingItems) {
        if (item.xhr && item.status === 'uploading') {
          try {
            item.xhr.abort();
          } catch (_) {}
        }
      }
      pendingItems.length = 0;
      renderChips();
    },
    openLightbox,
  };
})();
