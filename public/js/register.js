(function initGameRegisterPage(global) {
  'use strict';

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function formatMsg(template, vars) {
    let out = String(template || '');
    const entries = Object.entries(vars || {});
    for (let i = 0; i < entries.length; i += 1) {
      const k = entries[i][0];
      const v = entries[i][1];
      out = out.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v == null ? '' : v));
    }
    return out;
  }

  function isSafeHttpUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return false;
    try {
      const parsed = new URL(url.trim());
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch (_) {
      return false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.getElementById('btnPendingRefresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => global.location.reload());
    }

    const root = document.getElementById('gameRegisterRoot');
    const configEl = document.getElementById('gameRegisterConfig');
    const form = document.getElementById('gameRegisterForm');
    if (!root || !configEl || !form) return;

    let cfg = {};
    try {
      cfg = JSON.parse(configEl.getAttribute('data-config') || '{}');
    } catch (_) {
      cfg = {};
    }

    const i18n = cfg.i18n || {};
    const gamesMetaList = Array.isArray(cfg.games) ? cfg.games : [];
    const gamesMetaById = new Map(gamesMetaList.map((g) => [g.id, g]));

    // İstemci taraflı JS etkinleştiğinde tek sayfadan 3 adımlı stepper moda geç
    root.classList.add('is-stepper-ready');
    form.noValidate = true;

    form.querySelectorAll('[data-js-only]').forEach((el) => {
      el.hidden = false;
    });

    const stepPanels = Array.from(form.querySelectorAll('[data-step-panel]'));
    const stepNavBtns = Array.from(document.querySelectorAll('[data-step-nav]'));
    const checkboxes = Array.from(form.querySelectorAll('input[type="checkbox"][name="games"]'));
    const genderRadios = Array.from(form.querySelectorAll('input[type="radio"][name="gender"]'));
    const gameFieldWrappers = Array.from(form.querySelectorAll('[data-game-field]'));
    const nameInput = document.getElementById('regName');
    const nameCounter = document.getElementById('regNameCounter');
    const selectedCountEl = document.getElementById('regSelectedGamesCount');

    const errorGamesEl = document.getElementById('error-games');
    const errorGenderEl = document.getElementById('error-gender');
    const errorNameEl = document.getElementById('error-name');

    const btnStep1Next = document.getElementById('btnStep1Next');
    const btnStep2Prev = document.getElementById('btnStep2Prev');
    const btnStep2Next = document.getElementById('btnStep2Next');
    const btnStep3Prev = document.getElementById('btnStep3Prev');
    const submitBtn = document.getElementById('btnRegisterSubmit');

    const btnRobloxLookup = document.getElementById('btnRobloxLookup');
    const robloxInput = document.getElementById('username-roblox');
    const robloxLookupCard = document.getElementById('robloxLookupCard');
    const robloxPreSubmitWarning = document.getElementById('robloxPreSubmitWarning');

    let currentStep = Number(cfg.initialStep) || 1;
    let lastLookupState = null; // { query, status, alreadyRegistered }
    let warningConfirmedOnce = false;

    function getSelectedGameIds() {
      return checkboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    }

    function getSelectedGender() {
      const checked = genderRadios.find((r) => r.checked);
      return checked ? checked.value : '';
    }

    function updateSelectionCardsVisuals() {
      checkboxes.forEach((cb) => {
        const card = cb.closest('.reg-game-card');
        if (card) card.classList.toggle('is-selected', cb.checked);
      });

      const count = getSelectedGameIds().length;
      if (selectedCountEl) {
        selectedCountEl.innerHTML = '';
        const textNode = document.createTextNode((i18n.selectedCountPrefix || '') + ' ');
        const strongEl = document.createElement('strong');
        strongEl.textContent = String(count);
        const tailNode = document.createTextNode(' / ' + (cfg.maxGames || 4));
        selectedCountEl.appendChild(textNode);
        selectedCountEl.appendChild(strongEl);
        selectedCountEl.appendChild(tailNode);
      }

      if (btnStep1Next) {
        btnStep1Next.disabled = count === 0;
        btnStep1Next.setAttribute('aria-disabled', count === 0 ? 'true' : 'false');
      }

      genderRadios.forEach((radio) => {
        const card = radio.closest('.reg-gender-card');
        if (card) card.classList.toggle('is-selected', radio.checked);
      });
    }

    function syncVisibleGameFields() {
      const selected = new Set(getSelectedGameIds());
      gameFieldWrappers.forEach((wrapper) => {
        const gid = wrapper.getAttribute('data-game-field');
        const visible = selected.has(gid);
        wrapper.hidden = !visible;
        const input = wrapper.querySelector('.reg-game-username-input');
        if (input) {
          input.disabled = !visible;
        }
      });
    }

    function updateStepperHeader() {
      stepNavBtns.forEach((btn) => {
        const stepNum = Number(btn.getAttribute('data-step-nav'));
        const circle = btn.querySelector('.register-step-circle');
        btn.classList.remove('is-active', 'is-done', 'is-idle');

        if (stepNum === currentStep) {
          btn.classList.add('is-active');
          btn.setAttribute('aria-selected', 'true');
          if (circle) circle.textContent = String(stepNum);
        } else if (stepNum < currentStep) {
          btn.classList.add('is-done');
          btn.setAttribute('aria-selected', 'false');
          if (circle) circle.textContent = '✓';
        } else {
          btn.classList.add('is-idle');
          btn.setAttribute('aria-selected', 'false');
          if (circle) circle.textContent = String(stepNum);
        }
      });
    }

    function showStep(targetStep, shouldScroll) {
      currentStep = Math.max(1, Math.min(3, targetStep));
      stepPanels.forEach((panel) => {
        const num = Number(panel.getAttribute('data-step-panel'));
        panel.hidden = num !== currentStep;
      });
      syncVisibleGameFields();
      updateSelectionCardsVisuals();
      updateStepperHeader();

      if (shouldScroll) {
        const activePanel = stepPanels.find((p) => Number(p.getAttribute('data-step-panel')) === currentStep);
        if (activePanel && typeof activePanel.scrollIntoView === 'function') {
          activePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }

    function setFieldError(el, msg, containerEl) {
      if (el) el.textContent = msg || '';
      if (containerEl) containerEl.classList.toggle('has-error', Boolean(msg));
    }

    function validateStep1(showError) {
      const count = getSelectedGameIds().length;
      if (count === 0) {
        if (showError) setFieldError(errorGamesEl, i18n.errNoGameSelected || '');
        return false;
      }
      setFieldError(errorGamesEl, '');
      return true;
    }

    function validateStep2(showError) {
      const gender = getSelectedGender();
      if (gender !== 'male' && gender !== 'female') {
        if (showError) setFieldError(errorGenderEl, i18n.errSelectGender || '');
        return false;
      }
      setFieldError(errorGenderEl, '');
      return true;
    }

    function validateNameInput(showError) {
      if (!nameInput) return true;
      const val = normalizeText(nameInput.value);
      const groupEl = nameInput.closest('.form-group');
      if (nameCounter) {
        nameCounter.textContent = val.length + '/32';
      }
      if (val.length < 2 || val.length > 32) {
        if (showError) setFieldError(errorNameEl, i18n.errNameLength || '', groupEl);
        return false;
      }
      setFieldError(errorNameEl, '', groupEl);
      return true;
    }

    function validateGameField(wrapper, showError) {
      const gid = wrapper.getAttribute('data-game-field');
      const input = wrapper.querySelector('.reg-game-username-input');
      const errEl = document.getElementById('error-game-' + gid);
      const counterEl = document.getElementById('counter-' + gid);
      const min = parseInt(wrapper.getAttribute('data-min') || '2', 10);
      const max = parseInt(wrapper.getAttribute('data-max') || '32', 10);
      const regexStr = wrapper.getAttribute('data-regex') || '';

      if (!input || input.disabled) return true;
      const val = normalizeText(input.value);
      if (counterEl) {
        counterEl.textContent = val.length + '/' + max;
      }

      const meta = gamesMetaById.get(gid);
      const gameName = meta ? meta.name : gid;

      let errorMsg = '';
      if (!val) {
        errorMsg = formatMsg(i18n.errGameUsernameRequired, { game: gameName });
      } else if (val.length < min || val.length > max) {
        errorMsg =
          regexStr && gid === 'minecraft'
            ? formatMsg(i18n.errMinecraftUsername, { game: gameName, min, max })
            : formatMsg(i18n.errGameUsernameLength, { game: gameName, min, max });
      } else if (regexStr) {
        try {
          const re = new RegExp(regexStr);
          if (!re.test(val)) {
            errorMsg =
              gid === 'minecraft'
                ? formatMsg(i18n.errMinecraftUsername, { game: gameName, min, max })
                : formatMsg(i18n.errGameUsernamePattern, { game: gameName, min, max });
          }
        } catch (_) {}
      }

      if (errorMsg) {
        if (showError) setFieldError(errEl, errorMsg, wrapper);
        return false;
      }
      setFieldError(errEl, '', wrapper);
      return true;
    }

    // Adım 1 kart olayları
    checkboxes.forEach((cb) => {
      cb.addEventListener('change', () => {
        if (errorGamesEl && errorGamesEl.textContent) {
          validateStep1(true);
        }
        updateSelectionCardsVisuals();
        syncVisibleGameFields();
      });

      const labelCard = cb.closest('.reg-game-card');
      if (labelCard) {
        labelCard.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      }
    });

    // Adım 2 kart olayları
    genderRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        setFieldError(errorGenderEl, '');
        updateSelectionCardsVisuals();
      });

      const labelCard = radio.closest('.reg-gender-card');
      if (labelCard) {
        labelCard.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      }
    });

    // İlerleme çubuğu tıklama (yalnızca geri veya tamamlanmış adıma geçiş)
    stepNavBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = Number(btn.getAttribute('data-step-nav'));
        if (target === currentStep) return;
        if (target < currentStep) {
          showStep(target, true);
          return;
        }
        if (target === 2 && validateStep1(true)) {
          showStep(2, true);
        } else if (target === 3 && validateStep1(true) && validateStep2(true)) {
          showStep(3, true);
        }
      });
    });

    if (btnStep1Next) {
      btnStep1Next.addEventListener('click', () => {
        if (validateStep1(true)) {
          showStep(2, true);
        } else if (checkboxes[0]) {
          checkboxes[0].focus();
        }
      });
    }

    if (btnStep2Prev) {
      btnStep2Prev.addEventListener('click', () => showStep(1, true));
    }

    if (btnStep2Next) {
      btnStep2Next.addEventListener('click', () => {
        if (validateStep2(true)) {
          showStep(3, true);
          if (nameInput && !normalizeText(nameInput.value)) {
            global.setTimeout(() => nameInput.focus(), 60);
          }
        } else if (genderRadios[0]) {
          genderRadios[0].focus();
        }
      });
    }

    if (btnStep3Prev) {
      btnStep3Prev.addEventListener('click', () => showStep(2, true));
    }

    // Adım 3 canlı doğrulama ve karakter sayaçları
    if (nameInput) {
      nameInput.addEventListener('input', () => {
        const hasExistingError = Boolean(errorNameEl && errorNameEl.textContent);
        validateNameInput(hasExistingError);
      });
      nameInput.addEventListener('blur', () => {
        if (normalizeText(nameInput.value).length > 0) {
          validateNameInput(true);
        }
      });
    }

    gameFieldWrappers.forEach((wrapper) => {
      const gid = wrapper.getAttribute('data-game-field');
      const input = wrapper.querySelector('.reg-game-username-input');
      const errEl = document.getElementById('error-game-' + gid);
      if (!input) return;

      input.addEventListener('input', () => {
        const hadError = Boolean(errEl && errEl.textContent);
        const val = normalizeText(input.value);
        // Minecraft veya anlık pattern/max uyumsuzluğunda kullanıcı yazarken de uyar
        validateGameField(wrapper, hadError || val.length > 0);
      });

      input.addEventListener('blur', () => {
        if (normalizeText(input.value).length > 0) {
          validateGameField(wrapper, true);
        }
      });
    });

    // Roblox "Kontrol et 🔎" Proxy İşleyicisi
    function renderLookupCard(payload) {
      if (!robloxLookupCard) return;
      robloxLookupCard.innerHTML = '';
      robloxLookupCard.classList.remove('is-found', 'is-danger', 'is-warning');

      if (!payload) {
        robloxLookupCard.hidden = true;
        return;
      }

      const status = String(payload.status || 'TEMPORARY_ERROR').toUpperCase();
      const message = String(payload.message || payload.error || '');

      if (status === 'FOUND' && payload.user) {
        const isDup = Boolean(payload.alreadyRegistered);
        robloxLookupCard.classList.add(isDup ? 'is-warning' : 'is-found');

        const inner = document.createElement('div');
        inner.className = 'reg-lookup-found-row';

        if (isSafeHttpUrl(payload.user.avatarUrl)) {
          const img = document.createElement('img');
          img.className = 'reg-lookup-avatar';
          img.src = payload.user.avatarUrl;
          img.alt = payload.user.name || 'Roblox avatar';
          img.width = 48;
          img.height = 48;
          inner.appendChild(img);
        }

        const meta = document.createElement('div');
        meta.className = 'reg-lookup-meta';

        const titleRow = document.createElement('div');
        titleRow.className = 'reg-lookup-user-title';
        const displayEl = document.createElement('strong');
        displayEl.textContent = payload.user.displayName || payload.user.name || '';
        const handleEl = document.createElement('span');
        handleEl.className = 'reg-lookup-handle';
        handleEl.textContent = '@' + (payload.user.name || '');
        titleRow.appendChild(displayEl);
        titleRow.appendChild(handleEl);
        meta.appendChild(titleRow);

        const statusLine = document.createElement('div');
        statusLine.className = 'reg-lookup-status-text';
        statusLine.textContent = message;
        meta.appendChild(statusLine);

        inner.appendChild(meta);

        if (isSafeHttpUrl(payload.user.profileUrl)) {
          const link = document.createElement('a');
          link.className = 'btn btn-secondary btn-sm reg-lookup-profile-link';
          link.href = payload.user.profileUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = i18n.robloxProfileOpen || 'Roblox ↗';
          inner.appendChild(link);
        }

        robloxLookupCard.appendChild(inner);
      } else {
        robloxLookupCard.classList.add(
          status === 'NOT_FOUND' || status === 'BANNED' ? 'is-danger' : 'is-warning'
        );
        const msgBox = document.createElement('div');
        msgBox.className = 'reg-lookup-status-text';
        msgBox.textContent = message || i18n.robloxLookupTempError || '';
        robloxLookupCard.appendChild(msgBox);
      }

      robloxLookupCard.hidden = false;
    }

    function clearPreSubmitLookupWarning() {
      warningConfirmedOnce = false;
      if (robloxPreSubmitWarning) {
        robloxPreSubmitWarning.hidden = true;
        robloxPreSubmitWarning.textContent = '';
      }
    }

    if (robloxInput) {
      robloxInput.addEventListener('input', () => {
        if (lastLookupState && normalizeText(robloxInput.value) !== lastLookupState.query) {
          lastLookupState = null;
          clearPreSubmitLookupWarning();
        }
      });
    }

    if (btnRobloxLookup && robloxInput) {
      btnRobloxLookup.addEventListener('click', async () => {
        const cleanQuery = normalizeText(robloxInput.value);
        if (!cleanQuery) {
          renderLookupCard({
            status: 'TEMPORARY_ERROR',
            message: i18n.robloxLookupInvalidQuery || '',
          });
          robloxInput.focus();
          return;
        }

        clearPreSubmitLookupWarning();
        const labelSpan = btnRobloxLookup.querySelector('span');
        btnRobloxLookup.disabled = true;
        if (labelSpan) labelSpan.textContent = i18n.robloxCheckingBtn || '...';

        try {
          const url = `${cfg.robloxLookupUrl || '/kayit/roblox-kontrol'}?query=${encodeURIComponent(cleanQuery)}`;
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'X-CSRF-Token': cfg.csrfToken || '',
            },
            credentials: 'same-origin',
          });

          const data = await response.json().catch(() => null);
          if (!response.ok || !data) {
            renderLookupCard({
              status: 'TEMPORARY_ERROR',
              message: (data && (data.error || data.message)) || i18n.robloxLookupTempError || '',
            });
            return;
          }

          lastLookupState = {
            query: cleanQuery,
            status: String(data.status || '').toUpperCase(),
            alreadyRegistered: Boolean(data.alreadyRegistered),
          };
          renderLookupCard(data);
        } catch (_) {
          renderLookupCard({
            status: 'TEMPORARY_ERROR',
            message: i18n.robloxLookupTempError || '',
          });
        } finally {
          btnRobloxLookup.disabled = false;
          if (labelSpan) labelSpan.textContent = i18n.robloxCheckBtn || 'Kontrol et 🔎';
        }
      });
    }

    // Form gönderimi: Doğrulama -> Çift gönderim kilidi -> Orbital Loader / Düğme spinner
    form.addEventListener('submit', (e) => {
      if (form.dataset.submitted === 'true') {
        e.preventDefault();
        return;
      }

      if (!validateStep1(true)) {
        e.preventDefault();
        showStep(1, true);
        if (checkboxes[0]) checkboxes[0].focus();
        return;
      }

      if (!validateStep2(true)) {
        e.preventDefault();
        showStep(2, true);
        if (genderRadios[0]) genderRadios[0].focus();
        return;
      }

      let firstInvalidEl = null;
      if (!validateNameInput(true)) {
        firstInvalidEl = nameInput;
      }

      const selectedSet = new Set(getSelectedGameIds());
      gameFieldWrappers.forEach((wrapper) => {
        const gid = wrapper.getAttribute('data-game-field');
        if (!selectedSet.has(gid)) return;
        const ok = validateGameField(wrapper, true);
        if (!ok && !firstInvalidEl) {
          firstInvalidEl = wrapper.querySelector('.reg-game-username-input');
        }
      });

      if (firstInvalidEl) {
        e.preventDefault();
        showStep(3, true);
        firstInvalidEl.focus();
        return;
      }

      // Kullanıcı gönderimden önce lookup yapıp NOT_FOUND / BANNED aldıysa uyar
      const currentRobloxVal = robloxInput ? normalizeText(robloxInput.value) : '';
      const hasFailedLookup =
        selectedSet.has('roblox') &&
        lastLookupState &&
        lastLookupState.query === currentRobloxVal &&
        (lastLookupState.status === 'NOT_FOUND' ||
          lastLookupState.status === 'BANNED' ||
          lastLookupState.alreadyRegistered);

      if (hasFailedLookup && !warningConfirmedOnce) {
        e.preventDefault();
        warningConfirmedOnce = true;
        if (robloxPreSubmitWarning) {
          robloxPreSubmitWarning.textContent = i18n.robloxLookupWarningBeforeSubmit || '';
          robloxPreSubmitWarning.hidden = false;
          robloxPreSubmitWarning.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        return;
      }

      // Geçerli gönderim başlatılıyor: çift gönderim kilidi + yükleniyor durumu
      form.dataset.submitted = 'true';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('is-loading');
        const spinner = submitBtn.querySelector('.reg-btn-spinner');
        const label = submitBtn.querySelector('.reg-submit-label');
        if (spinner) spinner.hidden = false;
        if (label) label.textContent = submitBtn.getAttribute('data-submitting-text') || i18n.loaderVerifying || '';
      }

      if (global.NexusOrbitalOverlay && typeof global.NexusOrbitalOverlay.openIndeterminate === 'function') {
        global.NexusOrbitalOverlay.openIndeterminate(
          i18n.loaderVerifying || 'Roblox doğrulanıyor…',
          i18n.loaderDesc || ''
        );
      }
    });

    // BFCache (Geri tuşu) ile dönülürse yükleme katmanını sıfırla
    global.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        form.dataset.submitted = 'false';
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.classList.remove('is-loading');
        }
        if (global.NexusOrbitalOverlay && typeof global.NexusOrbitalOverlay.close === 'function') {
          global.NexusOrbitalOverlay.close();
        }
      }
    });

    // İlk render
    showStep(currentStep, false);
    if (nameInput && nameCounter) {
      nameCounter.textContent = normalizeText(nameInput.value).length + '/32';
    }
    gameFieldWrappers.forEach((wrapper) => {
      const gid = wrapper.getAttribute('data-game-field');
      const input = wrapper.querySelector('.reg-game-username-input');
      const counterEl = document.getElementById('counter-' + gid);
      const max = parseInt(wrapper.getAttribute('data-max') || '32', 10);
      if (input && counterEl) {
        counterEl.textContent = normalizeText(input.value).length + '/' + max;
      }
    });

    if (cfg.focusFieldId) {
      const targetEl = document.getElementById(cfg.focusFieldId);
      if (targetEl && typeof targetEl.focus === 'function') {
        global.setTimeout(() => {
          targetEl.focus();
          if (typeof targetEl.scrollIntoView === 'function') {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 80);
      }
    }
  });
})(window);
