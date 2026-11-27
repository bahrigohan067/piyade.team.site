/**
 * Piyade İstemci Tarafı JavaScript Etkileşimleri
 */

function escapeHtmlClient(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', () => {
  const isEn = document.body.getAttribute('data-lang') === 'en';

  // 1. Giriş Yapmamış Ziyaretçi: Üst Mobil Menü Aç/Kapa
  const mobileBtn = document.getElementById('mobileMenuToggle');
  const navLinks = document.getElementById('navLinks');

  if (mobileBtn && navLinks) {
    mobileBtn.addEventListener('click', () => {
      navLinks.classList.toggle('open');
    });
  }

  // 1B. Giriş Yapılmış Sayfalar: Sol Kenar Çubuğu (Sidebar) Masaüstü & Mobil Kontrolü
  const appSidebar = document.getElementById('appSidebar');
  const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
  const mobileSidebarOpenBtn = document.getElementById('mobileSidebarOpenBtn');
  const mobileSidebarCloseBtn = document.getElementById('mobileSidebarCloseBtn');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');

  if (appSidebar) {
    // Masaüstü (>=1024px) Aç/Kapa, --sidebar-width-current senkronu ve localStorage Kaydı
    const syncSidebarWidthVar = () => {
      const currentState = document.documentElement.getAttribute('data-sidebar') || 'open';
      const w =
        window.innerWidth >= 1024
          ? currentState === 'collapsed'
            ? '72px'
            : '260px'
          : '0px';
      document.documentElement.style.setProperty('--sidebar-width-current', w);
      window.dispatchEvent(new CustomEvent('piyade:sidebar-change', { detail: { state: currentState, width: w } }));
    };

    const syncDesktopAria = () => {
      const currentState = document.documentElement.getAttribute('data-sidebar') || 'open';
      if (sidebarCollapseBtn) {
        sidebarCollapseBtn.setAttribute(
          'aria-expanded',
          currentState === 'collapsed' ? 'false' : 'true'
        );
      }
      syncSidebarWidthVar();
    };
    syncDesktopAria();

    if (sidebarCollapseBtn) {
      sidebarCollapseBtn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-sidebar') || 'open';
        const next = current === 'collapsed' ? 'open' : 'collapsed';
        document.documentElement.setAttribute('data-sidebar', next);
        try {
          localStorage.setItem('piyade_sidebar_state', next);
        } catch (_) {}
        syncDesktopAria();
      });
    }

    if (typeof window.ResizeObserver === 'function') {
      try {
        const ro = new ResizeObserver(() => {
          syncSidebarWidthVar();
        });
        ro.observe(appSidebar);
      } catch (_) {}
    }

    // Mobil/Tablet (<1024px) Çekmece Aç/Kapa, Scroll Kilidi ve Odak Kapanı (Focus Trap)
    const getFocusableElements = () =>
      Array.from(
        appSidebar.querySelectorAll(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);

    const openMobileSidebar = () => {
      document.documentElement.setAttribute('data-mobile-sidebar', 'open');
      document.body.classList.add('sidebar-scroll-locked');
      if (mobileSidebarOpenBtn) {
        mobileSidebarOpenBtn.setAttribute('aria-expanded', 'true');
      }
      const focusables = getFocusableElements();
      if (focusables.length > 0) {
        focusables[0].focus();
      }
    };

    const closeMobileSidebar = (restoreFocus = true) => {
      const wasOpen = document.documentElement.getAttribute('data-mobile-sidebar') === 'open';
      document.documentElement.removeAttribute('data-mobile-sidebar');
      document.body.classList.remove('sidebar-scroll-locked');
      if (mobileSidebarOpenBtn) {
        mobileSidebarOpenBtn.setAttribute('aria-expanded', 'false');
        if (wasOpen && restoreFocus) {
          mobileSidebarOpenBtn.focus();
        }
      }
    };

    if (mobileSidebarOpenBtn) {
      mobileSidebarOpenBtn.addEventListener('click', openMobileSidebar);
    }

    if (mobileSidebarCloseBtn) {
      mobileSidebarCloseBtn.addEventListener('click', () => closeMobileSidebar(true));
    }

    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener('click', () => closeMobileSidebar(true));
    }

    // Menü öğesine tıklanınca mobilde çekmeceyi kapat
    appSidebar.querySelectorAll('.sidebar-link').forEach((link) => {
      link.addEventListener('click', () => {
        if (window.innerWidth < 1024) {
          closeMobileSidebar(false);
        }
      });
    });

    // Klavye: Escape ile kapat ve Tab tuşuyla odağı menü içinde tut (Focus Trap)
    document.addEventListener('keydown', (e) => {
      const isMobileOpen =
        document.documentElement.getAttribute('data-mobile-sidebar') === 'open';
      if (!isMobileOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        closeMobileSidebar(true);
        return;
      }

      if (e.key === 'Tab') {
        const focusables = getFocusableElements();
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    // Ekran masaüstü genişliğine (>=1024px) çıkarsa mobil çekmece kilidini temizle ve genişlik değişkenini güncelle
    window.addEventListener(
      'resize',
      () => {
        syncSidebarWidthVar();
        if (
          window.innerWidth >= 1024 &&
          document.documentElement.getAttribute('data-mobile-sidebar') === 'open'
        ) {
          closeMobileSidebar(false);
        }
      },
      { passive: true }
    );
  }

  // 2. Madde 6: Çift Gönderimi Engelleme (Form Submit Buton Kilitleme)
  const protectedForms = document.querySelectorAll('form[data-prevent-double-submit="true"]');
  protectedForms.forEach((form) => {
    form.addEventListener('submit', (e) => {
      // Uyarı formunda kanıt DOSYASI seçilmişse Orbital Loader XHR akışı yönetimi devralır
      if (form.dataset.orbitalLoader === 'true' && window.NexusOrbitalUploadReady) {
        const evidenceFileInput = form.querySelector('input[type="file"][name="evidenceFile"]');
        if (evidenceFileInput && evidenceFileInput.files && evidenceFileInput.files.length > 0) {
          return;
        }
      }

      if (form.dataset.submitted === 'true') {
        e.preventDefault();
        return;
      }

      const confirmMsg = form.getAttribute('data-confirm');
      if (confirmMsg && !window.confirm(confirmMsg)) {
        e.preventDefault();
        return;
      }

      form.dataset.submitted = 'true';
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.65';
        submitBtn.style.cursor = 'not-allowed';
        const submittingText = submitBtn.getAttribute('data-submitting-text');
        if (submittingText) {
          submitBtn.textContent = submittingText;
        }
      }
    });
  });

  // 3. Yönetim Paneli: Uyarı Formu Canlı Üye Arama
  const memberSearchInput = document.getElementById('warnMemberSearch');
  const memberResultsList = document.getElementById('warnMemberResults');
  const targetUserIdHidden = document.getElementById('targetUserId');
  const selectedMemberBadge = document.getElementById('selectedMemberBadge');

  if (memberSearchInput && memberResultsList && targetUserIdHidden) {
    let searchDebounceTimer;
    const selectedLabel =
      memberSearchInput.getAttribute('data-selected-label') || (isEn ? 'Selected:' : 'Seçilen:');

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
            memberResultsList.innerHTML = `<div style="padding: 10px; color: var(--text-muted);">${
              isEn ? 'No results found.' : 'Sonuç bulunamadı.'
            }</div>`;
          } else {
            memberResultsList.innerHTML = members
              .slice(0, 10)
              .map((m) => {
                const safeId = escapeHtmlClient(m.id);
                const safeName = escapeHtmlClient(m.displayName);
                const safeUser = escapeHtmlClient(m.username);
                const safeAvatar = escapeHtmlClient(
                  m.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'
                );
                const safeReal = m.registration?.realName
                  ? `• (${escapeHtmlClient(m.registration.realName)})`
                  : '';

                return `
                  <div class="member-search-item" data-id="${safeId}" data-name="${safeName}" data-avatar="${safeAvatar}" style="padding: 10px; cursor: pointer; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 10px;">
                    <img src="${safeAvatar}" style="width: 28px; height: 28px; border-radius: 50%;" />
                    <div>
                      <strong style="color: var(--text-primary);">${safeName}</strong>
                      <div style="font-size: 0.8rem; color: var(--text-muted);">${safeUser} • ID: ${safeId} ${safeReal}</div>
                    </div>
                  </div>
                `;
              })
              .join('');
          }
          memberResultsList.style.display = 'block';
        } catch (err) {
          console.error('Search error:', err);
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
          const safeId = escapeHtmlClient(id);
          const safeName = escapeHtmlClient(name);
          const safeAvatar = escapeHtmlClient(
            avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'
          );
          selectedMemberBadge.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 6px 12px; background: var(--bg-card-hover); border-radius: var(--radius-sm); border: 1px solid var(--border-light);">
              <img src="${safeAvatar}" style="width: 24px; height: 24px; border-radius: 50%;" />
              <span>${escapeHtmlClient(selectedLabel)} <strong>${safeName}</strong> (<code>${safeId}</code>)</span>
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

  // 5. Kural Kodu Seçildiğinde Otomatik Açıklama Gösterme (data-rules üzerinden güvenli okuma)
  const ruleSelect = document.getElementById('ruleCodeSelect');
  const rulePreviewBox = document.getElementById('rulePreviewBox');
  const penaltyTypeRadios = document.querySelectorAll('input[name="type"]');
  const officialFields = document.getElementById('officialRuleFields');

  if (penaltyTypeRadios.length > 0) {
    penaltyTypeRadios.forEach((radio) => {
      radio.addEventListener('change', (e) => {
        if (e.target.value === 'verbal') {
          if (officialFields) officialFields.style.display = 'none';
        } else {
          if (officialFields) officialFields.style.display = 'block';
        }
      });
    });
  }

  if (ruleSelect && rulePreviewBox) {
    let rulesDictionary = {};
    try {
      const rawRulesJson = ruleSelect.getAttribute('data-rules');
      if (rawRulesJson) {
        rulesDictionary = JSON.parse(rawRulesJson);
      }
    } catch (_) {
      rulesDictionary = {};
    }

    ruleSelect.addEventListener('change', (e) => {
      const code = e.target.value;
      const rule = rulesDictionary[code];

      if (rule) {
        const safeCode = escapeHtmlClient(rule.code);
        const safeTitle = escapeHtmlClient(rule.title || rule.code);
        const safePenalty = escapeHtmlClient(rule.penaltyLabel);
        const safeDesc = escapeHtmlClient(rule.description);
        const safeBadge = escapeHtmlClient(rule.badgeClass || 'badge-primary');

        rulePreviewBox.innerHTML = `
          <div style="margin-top: 10px; padding: 12px; background: var(--bg-input); border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <span class="badge ${safeBadge}">${safeCode}</span>
              <strong style="color: var(--text-primary);">${safeTitle}</strong>
              <span class="badge badge-danger" style="margin-left: auto;">${safePenalty}</span>
            </div>
            <p style="margin: 0; font-size: 0.9rem; color: var(--text-secondary);">${safeDesc}</p>
          </div>
        `;
        rulePreviewBox.style.display = 'block';
      } else {
        rulePreviewBox.style.display = 'none';
      }
    });
  }

  // 6. Profilim Sayfası: Oyun Kullanıcı Adı Kopyalama (Clipboard API + Seçilebilir Metin Fallback)
  const copyButtons = document.querySelectorAll('.profile-copy-btn');
  if (copyButtons.length > 0) {
    function markCopiedButton(btn) {
      const labelEl = btn.querySelector('span');
      const originalLabel = btn.getAttribute('data-copy-label') || (labelEl ? labelEl.textContent : '');
      const copiedLabel = btn.getAttribute('data-copied-label') || 'Kopyalandı ✅';

      if (btn._copyResetTimer) {
        clearTimeout(btn._copyResetTimer);
      }

      btn.classList.add('is-copied');
      if (labelEl) {
        labelEl.textContent = copiedLabel;
      } else {
        btn.textContent = copiedLabel;
      }

      const card = btn.closest('.profile-game-card');
      const hintEl = card ? card.querySelector('.profile-copy-hint') : null;
      if (hintEl) {
        hintEl.hidden = true;
        hintEl.textContent = '';
      }

      btn._copyResetTimer = setTimeout(() => {
        btn.classList.remove('is-copied');
        if (labelEl) {
          labelEl.textContent = originalLabel;
        } else {
          btn.textContent = originalLabel;
        }
      }, 2200);
    }

    function fallbackSelectCopyTarget(btn) {
      const targetId = btn.getAttribute('data-copy-target');
      const targetEl = targetId ? document.getElementById(targetId) : null;
      if (targetEl && window.getSelection && document.createRange) {
        try {
          const range = document.createRange();
          range.selectNodeContents(targetEl);
          const sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch (_) {}
      }

      let execOk = false;
      try {
        execOk = Boolean(document.execCommand && document.execCommand('copy'));
      } catch (_) {}

      if (execOk) {
        markCopiedButton(btn);
        return;
      }

      const card = btn.closest('.profile-game-card');
      const hintEl = card ? card.querySelector('.profile-copy-hint') : null;
      const hintMsg = btn.getAttribute('data-fallback-hint') || '';
      if (hintEl && hintMsg) {
        hintEl.textContent = hintMsg;
        hintEl.hidden = false;
      }
    }

    copyButtons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const textToCopy = btn.getAttribute('data-copy-text') || '';
        if (!textToCopy) return;

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          try {
            await navigator.clipboard.writeText(textToCopy);
            markCopiedButton(btn);
            return;
          } catch (_) {
            // Güvenli olmayan bağlam veya izin reddi durumunda seçilebilir metne düş
          }
        }

        fallbackSelectCopyTarget(btn);
      });
    });
  }
});
