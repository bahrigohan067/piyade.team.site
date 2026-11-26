/**
 * ==============================================================================
 * 🛡️ BAĞIMLILIKSIZ GÜVENLİ MARKDOWN -> HTML DÖNÜŞTÜRÜCÜ
 * ==============================================================================
 * - Sıfır harici paket kullanır.
 * - Ön bilgi (frontmatter: title, version, lastUpdated) ayrıştırır.
 * - Desteklenen sözdizimi: başlıklar (h1-h4 + içindekiler TOC), paragraflar,
 *   sırasız/sıralı listeler, kalın (**...**), italik (*...*), satır içi kod
 *   (`...`), güvenli bağlantılar ([metin](url)), alıntı (> ...), yatay çizgi (---)
 *   ve GFM boru tabloları (| ... | ... |).
 * - Güvenlik: Ham HTML TAMAMEN kaçışlanır (escapeHtml). <script>, <iframe>,
 *   <svg>, <img onerror>, javascript:, data:, vbscript:, on*= imkânsızdır.
 * ==============================================================================
 */

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Yalnızca güvenli bağlantı şemalarına izin verir (https:, http:, mailto:, /..., #...).
 * javascript:, data:, vbscript:, //evil.com, kontrol karakterleri reddedilir.
 */
function sanitizeUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  // Kontrol ve sıfır genişlikli karakterleri temizle
  const cleaned = rawUrl.replace(/[\u0000-\u001F\u007F-\u009F\s]+/g, '').trim();
  if (!cleaned) return null;

  // Göreli dahili yollar (/yasal/...) veya sayfa içi çapa (#bolum)
  if (cleaned.startsWith('/') && !cleaned.startsWith('//')) {
    return cleaned;
  }
  if (cleaned.startsWith('#') && /^#[a-zA-Z0-9_-]+$/.test(cleaned)) {
    return cleaned;
  }

  // Harici şemalar: yalnızca http:, https:, mailto:
  const lower = cleaned.toLowerCase();
  if (lower.startsWith('https://') || lower.startsWith('http://')) {
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.href;
      }
    } catch (_) {
      return null;
    }
    return null;
  }
  if (lower.startsWith('mailto:')) {
    const addr = cleaned.slice(7);
    if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(addr)) {
      return `mailto:${addr}`;
    }
    return null;
  }
  return null;
}

/**
 * Türkçe karakter uyumlu başlık çapa kimliği üretir.
 */
function slugifyHeading(text) {
  const trMap = {
    ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', İ: 'i', I: 'i',
    ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u',
  };
  const replaced = String(text || '')
    .split('')
    .map((ch) => (ch in trMap ? trMap[ch] : ch))
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return replaced || 'bolum';
}

/**
 * Markdown dosyasının başındaki --- ... --- ön bilgisini ayrıştırır.
 */
function parseFrontmatter(rawText) {
  const normalized = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return {
      meta: { title: '', version: '', lastUpdated: '' },
      body: normalized,
    };
  }

  const meta = { title: '', version: '', lastUpdated: '' };
  const headerLines = match[1].split('\n');
  for (const line of headerLines) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) meta[key] = val;
  }

  return { meta, body: match[2] };
}

/**
 * Satır içi Markdown öğelerini güvenli HTML'e çevirir.
 * Adım 1: Tüm metni HTML-escape eder (ham etiketler etkisizleşir).
 * Adım 2: Satır içi kod (`...`), bağlantılar ([metin](url)), kalın (**...**) ve italik (*...*) işler.
 */
function renderInline(rawText) {
  const codeTokens = [];
  // Önce satır içi kod parçalarını güvenli yer tutuculara ayır
  let work = String(rawText || '').replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = codeTokens.length;
    codeTokens.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000CODE${idx}\u0000`;
  });

  // Bağlantıları yakala ve yer tutucuya çevir (HTML kaçışı öncesi ham URL'yi doğrula)
  const linkTokens = [];
  work = work.replace(/\[([^\]]+)\]\(([^)\n]+)\)/g, (_, label, url) => {
    const safeHref = sanitizeUrl(url);
    const idx = linkTokens.length;
    if (!safeHref) {
      linkTokens.push(escapeHtml(label));
    } else {
      const isExternal = safeHref.startsWith('http://') || safeHref.startsWith('https://');
      const relAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
      linkTokens.push(`<a href="${escapeHtml(safeHref)}"${relAttr}>${escapeHtml(label)}</a>`);
    }
    return `\u0000LINK${idx}\u0000`;
  });

  // Geri kalan tüm metni HTML kaçışla
  work = escapeHtml(work);

  // Kalın (**metin**) ve italik (*metin*)
  work = work.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  work = work.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

  // Yer tutucuları geri yerleştir
  work = work.replace(/\u0000LINK(\d+)\u0000/g, (_, idx) => linkTokens[Number(idx)] || '');
  work = work.replace(/\u0000CODE(\d+)\u0000/g, (_, idx) => codeTokens[Number(idx)] || '');

  return work;
}

function splitTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparatorLine(line) {
  if (!line || !line.includes('|')) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function isBlockStarter(line, nextLine) {
  const t = line.trim();
  if (!t) return true;
  if (/^#{1,4}\s+/.test(t)) return true;
  if (/^(-{3,}|\*{3,})$/.test(t)) return true;
  if (/^>\s?/.test(t)) return true;
  if (/^[-*+]\s+/.test(t)) return true;
  if (/^\d+\.\s+/.test(t)) return true;
  if (t.includes('|') && nextLine && isTableSeparatorLine(nextLine)) return true;
  return false;
}

/**
 * Markdown metnini güvenli HTML'e çevirir ve ön bilgi ile içindekiler listesini döndürür.
 * @param {string} rawMarkdown
 * @returns {{ meta: { title: string, version: string, lastUpdated: string }, html: string, toc: Array<{ level: number, id: string, text: string }> }}
 */
function renderMarkdown(rawMarkdown) {
  const { meta, body } = parseFrontmatter(rawMarkdown);
  const lines = body.split('\n');
  const htmlParts = [];
  const toc = [];
  const usedIds = new Map();

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Yatay çizgi (---)
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      htmlParts.push('<hr class="legal-hr" />');
      i += 1;
      continue;
    }

    // Başlıklar (# .. ####)
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const rawTitle = headingMatch[2].replace(/\s+#+\s*$/, '').trim();
      const baseSlug = slugifyHeading(rawTitle);
      const count = (usedIds.get(baseSlug) || 0) + 1;
      usedIds.set(baseSlug, count);
      const id = count === 1 ? baseSlug : `${baseSlug}-${count}`;

      if (level === 2 || level === 3) {
        toc.push({ level, id, text: rawTitle.replace(/\*\*/g, '').replace(/`/g, '') });
      }
      htmlParts.push(`<h${level} id="${escapeHtml(id)}">${renderInline(rawTitle)}</h${level}>`);
      i += 1;
      continue;
    }

    // GFM Boru Tablosu
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      const headers = splitTableRow(trimmed);
      i += 2; // Başlık + ayırıcı satırı atla
      const rows = [];
      while (i < lines.length) {
        const rowLine = lines[i].trim();
        if (!rowLine || !rowLine.includes('|')) break;
        rows.push(splitTableRow(rowLine));
        i += 1;
      }
      const thead = `<thead><tr>${headers.map((h) => `<th>${renderInline(h)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map(
          (r) =>
            `<tr>${headers
              .map((_, idx) => `<td>${renderInline(r[idx] !== undefined ? r[idx] : '')}</td>`)
              .join('')}</tr>`
        )
        .join('')}</tbody>`;
      htmlParts.push(`<div class="legal-table-wrap"><table class="legal-table">${thead}${tbody}</table></div>`);
      continue;
    }

    // Alıntı (> ...)
    if (/^>\s?/.test(trimmed)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      htmlParts.push(`<blockquote class="legal-blockquote"><p>${quoteLines.map((l) => renderInline(l)).join('<br />')}</p></blockquote>`);
      continue;
    }

    // Sırasız liste (- veya * )
    if (/^[-*+]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
        i += 1;
      }
      htmlParts.push(`<ul class="legal-list">${items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</ul>`);
      continue;
    }

    // Sıralı liste (1. )
    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      htmlParts.push(`<ol class="legal-list legal-list--ordered">${items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</ol>`);
      continue;
    }

    // Paragraf
    const paraLines = [];
    while (i < lines.length) {
      const cur = lines[i].trim();
      if (!cur) break;
      if (paraLines.length > 0 && isBlockStarter(lines[i], lines[i + 1])) break;
      paraLines.push(cur);
      i += 1;
    }
    htmlParts.push(`<p>${paraLines.map((l) => renderInline(l)).join(' ')}</p>`);
  }

  return {
    meta,
    html: htmlParts.join('\n'),
    toc,
  };
}

module.exports = {
  escapeHtml,
  sanitizeUrl,
  slugifyHeading,
  parseFrontmatter,
  renderInline,
  renderMarkdown,
};
