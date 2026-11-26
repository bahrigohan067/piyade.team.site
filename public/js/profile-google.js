(function () {
  'use strict';

  const root = document.getElementById('googleProfileRoot');
  if (!root) return;

  const csrfToken = root.getAttribute('data-csrf') || '';
  const lookupUrl = root.getAttribute('data-roblox-lookup-url') || '/profil/roblox-kontrol';
  const tChecking = root.getAttribute('data-t-checking') || '...';
  const tCheck = root.getAttribute('data-t-check') || 'Kontrol Et';
  const tProfile = root.getAttribute('data-t-profile') || 'Roblox Profili';
  const tTempErr = root.getAttribute('data-t-temp-err') || 'Hata';

  const editToggleBtn = document.getElementById('gpToggleEditBtn');
  const editDetails = document.getElementById('gpEditDetails');
  if (editToggleBtn && editDetails) {
    editToggleBtn.addEventListener('click', () => {
      editDetails.open = true;
    });
  }

  document.querySelectorAll('.gp-edit-game-check').forEach((chk) => {
    const row = chk.closest('[data-gp-edit-game]');
    const gid = row ? row.getAttribute('data-gp-edit-game') : '';
    const wrap = row ? row.querySelector('[data-gp-input-wrap="' + gid + '"]') : null;
    chk.addEventListener('change', () => {
      if (wrap) wrap.hidden = !chk.checked;
    });
  });

  const rbBtn = document.getElementById('gpBtnRobloxCheck');
  const rbInput = document.getElementById('gp-edit-user-roblox');
  const rbCard = document.getElementById('gpRobloxLookupCard');

  if (rbBtn && rbInput && rbCard) {
    rbBtn.addEventListener('click', async () => {
      const q = rbInput.value.replace(/\s+/g, ' ').trim();
      if (!q) return;
      rbBtn.disabled = true;
      const span = rbBtn.querySelector('span');
      if (span) span.textContent = tChecking;
      try {
        const res = await fetch(lookupUrl + '?query=' + encodeURIComponent(q), {
          headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken },
        });
        const data = await res.json();
        rbCard.hidden = false;
        rbCard.innerHTML = '';
        const ok = data && data.status === 'FOUND' && !data.alreadyRegistered;
        rbCard.className = 'reg-lookup-card ' + (ok ? 'is-found' : 'is-error');
        if (data && data.status === 'FOUND' && data.user) {
          const row = document.createElement('div');
          row.className = 'reg-lookup-user-row';
          if (data.user.avatarUrl) {
            const img = document.createElement('img');
            img.src = data.user.avatarUrl;
            img.alt = data.user.username || 'Roblox';
            img.width = 44;
            img.height = 44;
            img.className = 'reg-lookup-avatar';
            row.appendChild(img);
          }
          const info = document.createElement('div');
          const strong = document.createElement('strong');
          strong.textContent = (data.user.displayName || data.user.username) + ' (@' + data.user.username + ')';
          info.appendChild(strong);
          const msg = document.createElement('div');
          msg.className = 'reg-lookup-msg';
          msg.textContent = data.message || '';
          info.appendChild(msg);
          if (data.user.profileUrl) {
            const a = document.createElement('a');
            a.href = data.user.profileUrl;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.className = 'gs-doc-link';
            a.textContent = tProfile + ' ↗';
            info.appendChild(a);
          }
          row.appendChild(info);
          rbCard.appendChild(row);
        } else {
          const msg = document.createElement('div');
          msg.className = 'reg-lookup-msg';
          msg.textContent = (data && data.message) || tTempErr;
          rbCard.appendChild(msg);
        }
      } catch (_) {
        rbCard.hidden = false;
        rbCard.className = 'reg-lookup-card is-error';
        rbCard.textContent = tTempErr;
      } finally {
        rbBtn.disabled = false;
        if (span) span.textContent = tCheck;
      }
    });
  }
})();
