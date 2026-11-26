(function () {
  'use strict';

  const root = document.getElementById('googleSignupRoot');
  const cfgEl = document.getElementById('googleSignupConfig');
  const form = document.getElementById('googleSignupForm');
  if (!root || !cfgEl || !form) return;

  let config = {};
  try {
    config = JSON.parse(cfgEl.getAttribute('data-config') || '{}');
  } catch (_) {
    return;
  }

  const i18n = config.i18n || {};
  const gamesMap = new Map((config.games || []).map((g) => [g.id, g]));
  let currentStep = Number(config.initialStep) || 0;
  let robloxVerified = null; // { query, user, alreadyRegistered }

  document.querySelectorAll('[data-js-only]').forEach((el) => {
    el.hidden = false;
  });

  const panels = Array.from(document.querySelectorAll('[data-gs-step-panel]'));
  const navBtns = Array.from(document.querySelectorAll('[data-gs-step-nav]'));
  const under13Block = document.getElementById('gsUnder13Block');
  const parentBox = document.getElementById('gsParentConsentBox');
  const nickInput = document.getElementById('gsNickname');
  const nickCounter = document.getElementById('gsNickCounter');
  const countEl = document.getElementById('gsSelectedGamesCount');
  const robloxInput = document.getElementById('gs-username-roblox');
  const robloxBtn = document.getElementById('gsBtnRobloxLookup');
  const robloxCard = document.getElementById('gsRobloxLookupCard');

  function fmt(tpl, vars) {
    let out = String(tpl || '');
    Object.keys(vars || {}).forEach((k) => {
      out = out.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k]));
    });
    return out;
  }

  function setError(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg || '';
  }

  function getSelectedGames() {
    return Array.from(form.querySelectorAll('input[name="games"]:checked')).map((i) => i.value);
  }

  function getAgeGroup() {
    const checked = form.querySelector('input[name="ageGroup"]:checked');
    return checked ? checked.value : '';
  }

  function showStep(step) {
    currentStep = Math.max(0, Math.min(3, step));
    panels.forEach((p) => {
      const idx = Number(p.getAttribute('data-gs-step-panel'));
      p.hidden = idx !== currentStep;
    });
    navBtns.forEach((btn) => {
      const idx = Number(btn.getAttribute('data-gs-step-nav'));
      btn.classList.remove('is-active', 'is-done', 'is-idle');
      const circle = btn.querySelector('.register-step-circle');
      if (idx === currentStep) {
        btn.classList.add('is-active');
        btn.setAttribute('aria-selected', 'true');
        if (circle) circle.textContent = String(idx + 1);
      } else if (idx < currentStep) {
        btn.classList.add('is-done');
        btn.setAttribute('aria-selected', 'false');
        if (circle) circle.textContent = '✓';
      } else {
        btn.classList.add('is-idle');
        btn.setAttribute('aria-selected', 'false');
        if (circle) circle.textContent = String(idx + 1);
      }
    });
    if (currentStep === 2) syncVisibleGameFields();
    if (currentStep === 3) renderSummary();
  }

  function syncAgeUI() {
    const age = getAgeGroup();
    form.querySelectorAll('.gs-age-card').forEach((card) => {
      const inp = card.querySelector('input[type="radio"]');
      card.classList.toggle('is-selected', Boolean(inp && inp.checked));
    });
    if (under13Block) under13Block.hidden = age !== 'under_13';
    if (parentBox) parentBox.hidden = age !== '13_17';
    if (age !== 'under_13') setError('gs-error-age', '');
  }

  function syncGamesUI() {
    const selected = getSelectedGames();
    form.querySelectorAll('[data-gs-game-card]').forEach((card) => {
      const inp = card.querySelector('input[type="checkbox"]');
      card.classList.toggle('is-selected', Boolean(inp && inp.checked));
    });
    if (countEl) {
      countEl.innerHTML = (i18n.selectedCountPrefix || '') + ' <strong>' + selected.length + '</strong> / 4';
    }
    if (selected.length > 0) setError('gs-error-games', '');
    syncVisibleGameFields();
  }

  function syncVisibleGameFields() {
    const selectedSet = new Set(getSelectedGames());
    form.querySelectorAll('[data-gs-game-field]').forEach((wrap) => {
      const gid = wrap.getAttribute('data-gs-game-field');
      wrap.hidden = !selectedSet.has(gid);
    });
  }

  function validateStep0() {
    let ok = true;
    const age = getAgeGroup();
    setError('gs-error-age', '');
    setError('gs-error-parent', '');
    setError('gs-error-kvkk', '');
    setError('gs-error-c', '');
    setError('gs-error-rules', '');

    if (age === 'under_13') {
      setError('gs-error-age', i18n.errUnder13);
      ok = false;
    } else if (!age) {
      setError('gs-error-age', i18n.errAgeRequired);
      ok = false;
    } else if (age === '13_17') {
      const parentChk = document.getElementById('parentConsentCheck');
      if (!parentChk || !parentChk.checked) {
        setError('gs-error-parent', i18n.errParentConsentRequired);
        ok = false;
      }
    }

    const kvkk = document.getElementById('consentKvkkCheck');
    const cChk = document.getElementById('consentCCheck');
    const rules = document.getElementById('consentRulesCheck');
    if (!kvkk || !kvkk.checked) {
      setError('gs-error-kvkk', i18n.errKvkkRequired);
      ok = false;
    }
    if (cChk && !cChk.checked) {
      setError('gs-error-c', i18n.errTransferRequired);
      ok = false;
    }
    if (!rules || !rules.checked) {
      setError('gs-error-rules', i18n.errRulesRequired);
      ok = false;
    }
    return ok;
  }

  function validateStep1() {
    const selected = getSelectedGames();
    if (selected.length === 0) {
      setError('gs-error-games', i18n.errNoGameSelected);
      return false;
    }
    setError('gs-error-games', '');
    return true;
  }

  function validateStep2() {
    let ok = true;
    const nick = (nickInput ? nickInput.value : '').replace(/\s+/g, ' ').trim();
    setError('gs-error-nickname', '');
    if (nick.length < 2 || nick.length > 32) {
      setError('gs-error-nickname', i18n.errNickLength);
      ok = false;
    } else if (/@everyone|@here|<@[!&]?\d+>|(?:^|\s)@\S+/i.test(nick)) {
      setError('gs-error-nickname', i18n.errNickMention);
      ok = false;
    } else if (/https?:\/\/|www\.|discord\.gg\//i.test(nick)) {
      setError('gs-error-nickname', i18n.errNickLink);
      ok = false;
    }

    const selected = getSelectedGames();
    selected.forEach((gid) => {
      const g = gamesMap.get(gid);
      const inp = document.getElementById('gs-username-' + gid);
      const val = (inp ? inp.value : '').replace(/\s+/g, ' ').trim();
      setError('gs-error-game-' + gid, '');
      if (!g) return;
      const min = (g.validate && g.validate.min) || 2;
      const max = (g.validate && g.validate.max) || 32;
      if (!val) {
        setError('gs-error-game-' + gid, fmt(i18n.errGameUsernameRequired, { game: g.name }));
        ok = false;
      } else if (val.length < min || val.length > max) {
        setError('gs-error-game-' + gid, fmt(i18n.errGameUsernameLength, { game: g.name, min, max }));
        ok = false;
      } else if (g.validate && g.validate.regex) {
        try {
          if (!new RegExp(g.validate.regex).test(val)) {
            const tpl = gid === 'minecraft' ? i18n.errMinecraftUsername : i18n.errGameUsernamePattern;
            setError('gs-error-game-' + gid, fmt(tpl, { game: g.name, min, max }));
            ok = false;
          }
        } catch (_) {}
      }

      if (gid === 'roblox' && ok) {
        const isCurrentVerified =
          robloxVerified &&
          robloxVerified.status === 'FOUND' &&
          !robloxVerified.alreadyRegistered &&
          robloxVerified.query.toLowerCase() === val.toLowerCase();
        if (!isCurrentVerified) {
          setError('gs-error-game-roblox', i18n.errRobloxVerifyRequired);
          ok = false;
        }
      }
    });
    return ok;
  }

  function renderSummary() {
    const nick = (nickInput ? nickInput.value : '').replace(/\s+/g, ' ').trim();
    const selected = getSelectedGames();
    const rbSelected = selected.includes('roblox');
    const rbName =
      rbSelected && robloxVerified && robloxVerified.user && robloxVerified.user.username
        ? robloxVerified.user.username
        : rbSelected && robloxInput
          ? robloxInput.value.trim()
          : '';

    const dispEl = document.getElementById('gsSummaryDisplayName');
    if (dispEl) {
      dispEl.textContent = rbName ? nick + ' | ' + rbName : nick || '—';
    }

    const listEl = document.getElementById('gsSummaryGamesList');
    if (listEl) {
      listEl.innerHTML = '';
      selected.forEach((gid) => {
        const g = gamesMap.get(gid);
        const inp = document.getElementById('gs-username-' + gid);
        const val =
          gid === 'roblox' && robloxVerified && robloxVerified.user && robloxVerified.user.username
            ? robloxVerified.user.username
            : (inp ? inp.value.trim() : '');
        const li = document.createElement('li');
        li.className = 'reg-games-summary-item';

        const left = document.createElement('span');
        left.className = 'reg-summary-game-label';
        const em = document.createElement('span');
        em.textContent = (g && g.emoji) || '🎮';
        const nm = document.createElement('strong');
        nm.textContent = (g && g.name) || gid;
        left.appendChild(em);
        left.appendChild(nm);

        const code = document.createElement('code');
        code.className = 'reg-summary-game-user';
        code.textContent = val;

        li.appendChild(left);
        li.appendChild(code);
        listEl.appendChild(li);
      });
    }
  }

  function renderRobloxLookupResult(data, query) {
    if (!robloxCard) return;
    robloxCard.hidden = false;
    robloxCard.className = 'reg-lookup-card';
    robloxCard.innerHTML = '';

    const isSuccess = data && data.status === 'FOUND' && !data.alreadyRegistered;
    robloxCard.classList.add(isSuccess ? 'is-found' : 'is-error');

    if (data && data.status === 'FOUND' && data.user) {
      const wrap = document.createElement('div');
      wrap.className = 'reg-lookup-user-row';
      if (data.user.avatarUrl) {
        const img = document.createElement('img');
        img.src = data.user.avatarUrl;
        img.alt = data.user.username || 'Roblox';
        img.width = 48;
        img.height = 48;
        img.className = 'reg-lookup-avatar';
        wrap.appendChild(img);
      }
      const info = document.createElement('div');
      const nameEl = document.createElement('strong');
      nameEl.textContent = (data.user.displayName || data.user.username) + ' (@' + data.user.username + ')';
      info.appendChild(nameEl);

      const msgEl = document.createElement('div');
      msgEl.className = 'reg-lookup-msg';
      msgEl.textContent = data.message || '';
      info.appendChild(msgEl);

      if (data.user.profileUrl) {
        const link = document.createElement('a');
        link.href = data.user.profileUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'gs-doc-link';
        link.textContent = (i18n.robloxProfileOpen || 'Roblox Profili') + ' ↗';
        info.appendChild(link);
      }
      wrap.appendChild(info);
      robloxCard.appendChild(wrap);
    } else {
      const msgEl = document.createElement('div');
      msgEl.className = 'reg-lookup-msg';
      msgEl.textContent = (data && data.message) || i18n.robloxLookupTempError || '';
      robloxCard.appendChild(msgEl);
    }

    robloxVerified = isSuccess ? { status: 'FOUND', query, user: data.user, alreadyRegistered: false } : null;
    if (isSuccess) {
      setError('gs-error-game-roblox', '');
    }
  }

  async function runRobloxLookup() {
    if (!robloxInput || !robloxBtn) return;
    const query = robloxInput.value.replace(/\s+/g, ' ').trim();
    if (!query) {
      setError('gs-error-game-roblox', i18n.robloxLookupInvalidQuery);
      return;
    }
    robloxBtn.disabled = true;
    const span = robloxBtn.querySelector('span');
    if (span) span.textContent = i18n.robloxCheckingBtn || '...';
    try {
      const res = await fetch(config.robloxLookupUrl + '?query=' + encodeURIComponent(query), {
        headers: {
          Accept: 'application/json',
          'X-CSRF-Token': config.csrfToken || '',
        },
      });
      const data = await res.json();
      renderRobloxLookupResult(data, query);
    } catch (_) {
      renderRobloxLookupResult({ status: 'TEMPORARY_ERROR', message: i18n.robloxLookupTempError }, query);
    } finally {
      robloxBtn.disabled = false;
      if (span) span.textContent = i18n.robloxCheckBtn || 'Kontrol Et';
    }
  }

  // Olay dinleyicileri
  form.querySelectorAll('input[name="ageGroup"]').forEach((r) => r.addEventListener('change', syncAgeUI));
  form.querySelectorAll('input[name="games"]').forEach((c) => c.addEventListener('change', syncGamesUI));
  if (nickInput && nickCounter) {
    nickInput.addEventListener('input', () => {
      nickCounter.textContent = nickInput.value.length + '/32';
    });
  }
  form.querySelectorAll('.gs-game-username-input').forEach((inp) => {
    const gid = inp.getAttribute('data-game-id');
    const maxLen = inp.getAttribute('maxlength') || '32';
    const counter = document.getElementById('gs-counter-' + gid);
    inp.addEventListener('input', () => {
      if (counter) counter.textContent = inp.value.length + '/' + maxLen;
      if (gid === 'roblox') {
        robloxVerified = null;
      }
    });
  });

  if (robloxBtn) robloxBtn.addEventListener('click', runRobloxLookup);

  const b0Next = document.getElementById('gsBtnStep0Next');
  const b1Prev = document.getElementById('gsBtnStep1Prev');
  const b1Next = document.getElementById('gsBtnStep1Next');
  const b2Prev = document.getElementById('gsBtnStep2Prev');
  const b2Next = document.getElementById('gsBtnStep2Next');
  const b3Prev = document.getElementById('gsBtnStep3Prev');

  if (b0Next) b0Next.addEventListener('click', () => { if (validateStep0()) showStep(1); });
  if (b1Prev) b1Prev.addEventListener('click', () => showStep(0));
  if (b1Next) b1Next.addEventListener('click', () => { if (validateStep1()) showStep(2); });
  if (b2Prev) b2Prev.addEventListener('click', () => showStep(1));
  if (b2Next) b2Next.addEventListener('click', () => { if (validateStep2()) showStep(3); });
  if (b3Prev) b3Prev.addEventListener('click', () => showStep(2));

  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = Number(btn.getAttribute('data-gs-step-nav'));
      if (target <= currentStep) {
        showStep(target);
      }
    });
  });

  form.addEventListener('submit', (e) => {
    if (!validateStep0()) {
      e.preventDefault();
      showStep(0);
      return;
    }
    if (!validateStep1()) {
      e.preventDefault();
      showStep(1);
      return;
    }
    if (!validateStep2()) {
      e.preventDefault();
      showStep(2);
      return;
    }
    const submitBtn = document.getElementById('gsBtnSubmit');
    if (submitBtn) {
      submitBtn.disabled = true;
      const lbl = submitBtn.querySelector('.reg-submit-label');
      if (lbl && submitBtn.dataset.submittingText) lbl.textContent = submitBtn.dataset.submittingText;
    }
  });

  syncAgeUI();
  syncGamesUI();
  showStep(currentStep);

  if (config.focusFieldId) {
    const targetEl = document.getElementById(config.focusFieldId);
    if (targetEl && typeof targetEl.focus === 'function') {
      try {
        targetEl.focus({ preventScroll: false });
      } catch (_) {}
    }
  }
})();
