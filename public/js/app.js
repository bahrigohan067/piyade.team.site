/**
 * Piyade Team İstemci Tarafı JavaScript Etkileşimleri
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Mobil Menü Aç/Kapa
  const mobileBtn = document.getElementById('mobileMenuToggle');
  const navLinks = document.getElementById('navLinks');

  if (mobileBtn && navLinks) {
    mobileBtn.addEventListener('click', () => {
      navLinks.classList.toggle('open');
    });
  }

  // 2. Acil Takviye Geri Sayım Sayacı (Cooldown)
  const cooldownElem = document.getElementById('cooldownTimer');
  if (cooldownElem) {
    let secondsLeft = parseInt(cooldownElem.getAttribute('data-seconds'), 10) || 0;
    const callButton = document.getElementById('btnTakviyeCall');

    if (secondsLeft > 0) {
      if (callButton) callButton.disabled = true;

      const timer = setInterval(() => {
        secondsLeft--;
        if (secondsLeft <= 0) {
          clearInterval(timer);
          cooldownElem.textContent = 'Takviye çağrısı yapmaya hazır!';
          cooldownElem.classList.remove('badge-warning');
          cooldownElem.classList.add('badge-success');
          if (callButton) {
            callButton.disabled = false;
            callButton.textContent = '🚨 Acil Takviye Çağrısı Başlat';
          }
        } else {
          const m = Math.floor(secondsLeft / 60);
          const s = secondsLeft % 60;
          cooldownElem.textContent = `${m} dk ${s < 10 ? '0' : ''}${s} sn`;
        }
      }, 1000);
    }
  }

  // 3. Yönetim Paneli: Uyarı Formu Canlı Üye Arama
  const memberSearchInput = document.getElementById('warnMemberSearch');
  const memberResultsList = document.getElementById('warnMemberResults');
  const targetUserIdHidden = document.getElementById('targetUserId');
  const selectedMemberBadge = document.getElementById('selectedMemberBadge');

  if (memberSearchInput && memberResultsList && targetUserIdHidden) {
    let searchDebounceTimer;

    memberSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      clearTimeout(searchDebounceTimer);

      if (q.length < 2) {
        memberResultsList.style.display = 'none';
        memberResultsList.innerHTML = '';
        return;
      }

      searchDebounceTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/yonetim/api/search?q=${encodeURIComponent(q)}`);
          const data = await res.json();
          const members = data.members || [];

          if (members.length === 0) {
            memberResultsList.innerHTML = '<div style="padding: 10px; color: var(--text-muted);">Sonuç bulunamadı.</div>';
          } else {
            memberResultsList.innerHTML = members
              .slice(0, 10)
              .map(
                (m) => `
                <div class="member-search-item" data-id="${m.id}" data-name="${m.displayName}" data-avatar="${m.avatarUrl || ''}" style="padding: 10px; cursor: pointer; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 10px;">
                  <img src="${m.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'}" style="width: 28px; height: 28px; border-radius: 50%;" />
                  <div>
                    <strong style="color: var(--text-primary);">${m.displayName}</strong>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${m.username} • ID: ${m.id} ${m.registration?.realName ? '• (' + m.registration.realName + ')' : ''}</div>
                  </div>
                </div>
              `
              )
              .join('');
          }
          memberResultsList.style.display = 'block';
        } catch (err) {
          console.error('Arama hatası:', err);
        }
      }, 250);
    });

    // Listeden üye seçildiğinde
    memberResultsList.addEventListener('click', (e) => {
      const item = e.target.closest('.member-search-item');
      if (item) {
        const id = item.getAttribute('data-id');
        const name = item.getAttribute('data-name');
        const avatar = item.getAttribute('data-avatar');

        targetUserIdHidden.value = id;
        memberSearchInput.value = `${name} (${id})`;
        memberResultsList.style.display = 'none';

        if (selectedMemberBadge) {
          selectedMemberBadge.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 6px 12px; background: var(--bg-card-hover); border-radius: var(--radius-sm); border: 1px solid var(--border-light);">
              <img src="${avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}" style="width: 24px; height: 24px; border-radius: 50%;" />
              <span>Seçilen: <strong>${name}</strong> (<code>${id}</code>)</span>
            </div>
          `;
        }
      }
    });

    // Dışarı tıklandığında listeyi kapat
    document.addEventListener('click', (e) => {
      if (!memberSearchInput.contains(e.target) && !memberResultsList.contains(e.target)) {
        memberResultsList.style.display = 'none';
      }
    });
  }

  // 4. Kural Kodu Seçildiğinde Otomatik Açıklama Gösterme
  const ruleSelect = document.getElementById('ruleCodeSelect');
  const rulePreviewBox = document.getElementById('rulePreviewBox');
  const penaltyTypeRadios = document.querySelectorAll('input[name="type"]');
  const officialFields = document.getElementById('officialRuleFields');
  const verbalFields = document.getElementById('verbalReasonFields');

  if (penaltyTypeRadios.length > 0) {
    penaltyTypeRadios.forEach((radio) => {
      radio.addEventListener('change', (e) => {
        if (e.target.value === 'verbal') {
          if (officialFields) officialFields.style.display = 'none';
          if (verbalFields) verbalFields.style.display = 'block';
        } else {
          if (officialFields) officialFields.style.display = 'block';
          if (verbalFields) verbalFields.style.display = 'none';
        }
      });
    });
  }

  if (ruleSelect && rulePreviewBox && window.SERVER_RULES) {
    ruleSelect.addEventListener('change', (e) => {
      const code = e.target.value;
      const rule = window.SERVER_RULES[code];

      if (rule) {
        rulePreviewBox.innerHTML = `
          <div style="margin-top: 10px; padding: 12px; background: var(--bg-input); border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <span class="badge ${rule.badgeClass || 'badge-primary'}">${rule.code}</span>
              <strong style="color: var(--text-primary);">${rule.title || rule.code}</strong>
              <span class="badge badge-danger" style="margin-left: auto;">${rule.penaltyLabel}</span>
            </div>
            <p style="margin: 0; font-size: 0.9rem; color: var(--text-secondary);">${rule.description}</p>
          </div>
        `;
        rulePreviewBox.style.display = 'block';
      } else {
        rulePreviewBox.style.display = 'none';
      }
    });
  }
});
