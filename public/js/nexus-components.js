/**
 * 🌟 NEXUS UI BİLEŞENLERİ: METEORS, DART RATING VE SCROLL REVEAL TEXT
 * Violet Ghost Fibers Teması ile %100 Uyumlu İnteraktif Kodlar
 */

document.addEventListener('DOMContentLoaded', () => {
  // ============================================================================
  // 1. 🌠 METEORS BİLEŞENİ
  // ============================================================================
  const meteorsContainer = document.getElementById('meteorsContainer');
  if (meteorsContainer) {
    const STAR_COUNT = 70;
    const METEOR_COUNT = 22;

    // 70 Sabit Yanıp Sönen Yıldız
    for (let i = 0; i < STAR_COUNT; i++) {
      const star = document.createElement('div');
      star.className = 'meteor-star';
      star.style.top = `${Math.random() * 100}%`;
      star.style.left = `${Math.random() * 100}%`;
      star.style.animationDelay = `${Math.random() * 4}s`;
      star.style.animationDuration = `${2 + Math.random() * 3}s`;
      meteorsContainer.appendChild(star);
    }

    // 22 Sürekli Akan Meteor
    for (let j = 0; j < METEOR_COUNT; j++) {
      const meteor = document.createElement('span');
      meteor.className = 'meteor-streak';
      meteor.style.top = `${-20 + Math.random() * 120}%`;
      meteor.style.left = `${Math.random() * 120}%`;
      meteor.style.animationDelay = `${Math.random() * 8}s`;
      meteor.style.animationDuration = `${2.5 + Math.random() * 3}s`;
      meteorsContainer.appendChild(meteor);
    }

    // Gökyüzüne Tıklandığında Özel Meteor Çağırma (Click the sky to call one down)
    meteorsContainer.addEventListener('click', (e) => {
      const rect = meteorsContainer.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Çağrılan meteor
      const customMeteor = document.createElement('span');
      customMeteor.className = 'meteor-streak';
      customMeteor.style.top = `${clickY - 80}px`;
      customMeteor.style.left = `${clickX + 80}px`;
      customMeteor.style.animation = 'meteorFall 0.8s ease-out forwards';
      customMeteor.style.width = '220px';
      customMeteor.style.background = 'linear-gradient(to right, #fff, rgba(217, 70, 239, 0.9), transparent)';
      meteorsContainer.appendChild(customMeteor);

      // Çarpma pırıltısı
      const burst = document.createElement('div');
      burst.style.position = 'absolute';
      burst.style.left = `${clickX}px`;
      burst.style.top = `${clickY}px`;
      burst.style.width = '8px';
      burst.style.height = '8px';
      burst.style.background = '#fff';
      burst.style.borderRadius = '50%';
      burst.style.boxShadow = '0 0 20px 8px rgba(192, 132, 252, 0.9)';
      burst.style.pointerEvents = 'none';
      burst.style.transform = 'translate(-50%, -50%)';
      burst.style.transition = 'all 0.5s ease-out';
      meteorsContainer.appendChild(burst);

      setTimeout(() => {
        burst.style.transform = 'translate(-50%, -50%) scale(4)';
        burst.style.opacity = '0';
      }, 50);

      setTimeout(() => {
        customMeteor.remove();
        burst.remove();
      }, 900);
    });
  }

  // ============================================================================
  // 2. 📜 SCROLL REVEAL TEXT BİLEŞENİ (Aşağı kaydırdıkça netleşen metin)
  // ============================================================================
  const scrollLines = document.querySelectorAll('.scroll-reveal-line');
  if (scrollLines.length > 0) {
    function handleScrollReveal() {
      const windowHeight = window.innerHeight;
      scrollLines.forEach((line) => {
        const rect = line.getBoundingClientRect();
        // Görünüm alanının %80'ine girdiğinde açılmaya başla
        if (rect.top <= windowHeight * 0.85 && rect.bottom >= 0) {
          line.classList.add('revealed');
        } else {
          // İsteğe bağlı tekrar bulanıklaşma
          if (rect.top > windowHeight) {
            line.classList.remove('revealed');
          }
        }
      });
    }

    window.addEventListener('scroll', handleScrollReveal, { passive: true });
    handleScrollReveal();
  }

  // ============================================================================
  // 3. 🎯 DART RATING BİLEŞENİ
  // "Press and hold on the board to aim, release to throw. Number keys 1 to 9 and 0 throw a perfect dart at that ring."
  // ============================================================================
  const dartWrapper = document.getElementById('dartboardWrapper');
  const reticle = document.getElementById('dartAimReticle');
  const scoreDisplay = document.getElementById('dartScoreDisplay');
  const feedbackDisplay = document.getElementById('dartFeedbackDisplay');
  const starsContainer = document.getElementById('dartStarsContainer');
  const clearBtn = document.getElementById('btnClearDarts');

  if (dartWrapper && reticle) {
    let isAiming = false;
    let aimX = 140;
    let aimY = 140;
    const BOARD_RADIUS = 130; // Tahtanın yarıçapı
    const CENTER_X = 140;
    const CENTER_Y = 140;

    // Hedefleme başlat
    dartWrapper.addEventListener('mousedown', (e) => {
      isAiming = true;
      reticle.style.display = 'block';
      updateAim(e);
    });

    dartWrapper.addEventListener('touchstart', (e) => {
      isAiming = true;
      reticle.style.display = 'block';
      if (e.touches[0]) updateAim(e.touches[0]);
    }, { passive: true });

    // Hedefleme esnasında imleci takip et
    window.addEventListener('mousemove', (e) => {
      if (!isAiming) return;
      updateAim(e);
    });

    window.addEventListener('touchmove', (e) => {
      if (!isAiming) return;
      if (e.touches[0]) updateAim(e.touches[0]);
    }, { passive: true });

    function updateAim(e) {
      const rect = dartWrapper.getBoundingClientRect();
      aimX = e.clientX - rect.left;
      aimY = e.clientY - rect.top;

      // Aim reticle'ı güncelle
      reticle.style.left = `${aimX}px`;
      reticle.style.top = `${aimY}px`;
    }

    // Bırakıldığında dartı fırlat
    window.addEventListener('mouseup', () => {
      if (!isAiming) return;
      isAiming = false;
      reticle.style.display = 'none';
      throwDartAt(aimX, aimY);
    });

    window.addEventListener('touchend', () => {
      if (!isAiming) return;
      isAiming = false;
      reticle.style.display = 'none';
      throwDartAt(aimX, aimY);
    });

    // Klavye Kısayolları (1-9 ve 0 tuşları ile tam o halkaya mükemmel atış yap)
    window.addEventListener('keydown', (e) => {
      // Input veya textarea içindeyse tetikleme
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

      let ringNumber = null;
      if (e.key >= '1' && e.key <= '9') {
        ringNumber = parseInt(e.key, 10);
      } else if (e.key === '0') {
        ringNumber = 10; // 0 tuşu Bullseye (10) atar
      }

      if (ringNumber !== null) {
        // Halka yarıçapını hesapla (10 = merkez, 1 = en dış)
        const targetRadius = (10 - ringNumber + 0.5) * (BOARD_RADIUS / 10);
        const randomAngle = Math.random() * Math.PI * 2;
        const x = CENTER_X + Math.cos(randomAngle) * targetRadius;
        const y = CENTER_Y + Math.sin(randomAngle) * targetRadius;

        throwDartAt(x, y, ringNumber);
      }
    });

    // Dart Atma ve Saplanma Fonksiyonu
    function throwDartAt(x, y, forcedScore = null) {
      // Merkezden uzaklığı hesapla
      const dx = x - CENTER_X;
      const dy = y - CENTER_Y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Puanı belirle (1 ila 10 arası)
      let score = 1;
      if (forcedScore !== null) {
        score = forcedScore;
      } else {
        if (dist <= 12) {
          score = 10; // Tam merkez (Bullseye)
        } else if (dist > BOARD_RADIUS) {
          score = 0; // Tahta dışı (Kaçırdı)
        } else {
          score = Math.max(1, 10 - Math.floor(dist / (BOARD_RADIUS / 10)));
        }
      }

      // Saplanan Dart Öğesini Oluştur
      const dart = document.createElement('div');
      dart.className = 'dart-pin';
      dart.style.left = `${x}px`;
      dart.style.top = `${y}px`;
      dart.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="filter: drop-shadow(0 2px 6px rgba(0,0,0,0.8));">
          <!-- Dart İğnesi -->
          <circle cx="12" cy="12" r="3" fill="#fff" />
          <!-- Kanatlar (Violet & Neon Leylak) -->
          <path d="M12 9 L8 2 L12 5 L16 2 Z" fill="#8b5cf6" />
          <path d="M12 15 L8 22 L12 19 L16 22 Z" fill="#d946ef" />
          <path d="M9 12 L2 8 L5 12 L2 16 Z" fill="#c084fc" />
          <path d="M15 12 L22 8 L19 12 L22 16 Z" fill="#6366f1" />
        </svg>
      `;
      dartWrapper.appendChild(dart);

      // Skor ve Geribildirimi Güncelle
      updateScoreUI(score);
    }

    function updateScoreUI(score) {
      if (scoreDisplay) {
        scoreDisplay.innerHTML = `<span style="color: var(--color-accent); font-size: 2.25rem;">${score}</span> / 10`;
      }

      if (feedbackDisplay) {
        let msg = '';
        if (score === 10) msg = '🎯 Mükemmel Atış! Tam 12\'den (Bullseye)!';
        else if (score >= 8) msg = '🔥 Harika İsabet! Zirve Seviye Yetenek!';
        else if (score >= 6) msg = '⚡ Çok İyi Atış! Nişancılığın Yerinde.';
        else if (score >= 4) msg = '👍 Fena Değil! Biraz Daha Odaklan.';
        else if (score > 0) msg = '🎯 Tahtaya Saplandı! Tekrar Dene.';
        else msg = '💨 Iskalandı! Tahtanın Dışına Düştü.';

        feedbackDisplay.textContent = msg;
      }

      // Yıldızları güncelle
      if (starsContainer) {
        let starsHtml = '';
        for (let s = 1; s <= 10; s++) {
          starsHtml += `<span style="font-size: 1.15rem; color: ${s <= score ? '#fbbf24' : 'rgba(255,255,255,0.2)'}; text-shadow: ${s <= score ? '0 0 8px #f59e0b' : 'none'};">★</span>`;
        }
        starsContainer.innerHTML = starsHtml;
      }
    }

    // Tahtayı Temizle
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        const pins = dartWrapper.querySelectorAll('.dart-pin');
        pins.forEach((p) => p.remove());
        updateScoreUI(0);
        if (feedbackDisplay) feedbackDisplay.textContent = 'Hedef almak için tahtaya basılı tut ve bırak.';
      });
    }
  }
});
