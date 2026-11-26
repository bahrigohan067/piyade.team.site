---
title: Privacy Policy
version: 1.0
lastUpdated: 2026-11-26
---

# Privacy Policy (Website & Discord Bot)

This Privacy Policy explains how the **Piyade World (Piyade Dünyası)** web portal ({{SITE_URL}}) and its connected Discord community bot collect, use, protect, and delete personal data.

## 1. Scope and Controller

This policy applies to both the website and the connected Discord bot. Data Controller: **{{LEGAL_CONTROLLER_NAME}}** | Email: `{{LEGAL_EMAIL}}` | Address: `{{LEGAL_ADDRESS}}`.

## 2. Website and Bot Data Flow

Our website runs on a **"thin client"** architecture:

1. **Discord OAuth2 Login:** Requests `identify` scope only (we do not request your Discord email). Your session stores Discord ID, username, display name, avatar URL, and server role levels, synced fresh from the Bot API every 60 seconds.
2. **Discord Bot REST API:** Your registration data (name/nickname, gender, game usernames, Roblox verification), disciplinary history, monthly game activity, and member directory are retrieved over an authenticated server-to-server connection.
3. **Monthly Game Activity & Privacy Opt-Out:** Only current-month play duration is summed and reset on the 1st of every month. Members who disable tracking (`tracking: false`) in Discord are never counted or displayed.
4. **UPCOMING FEATURE (Planned):** Planned additions — **Google Sign-In** (`sub`, email, name), **"remember me" cookie**, **direct site member registration**, **Google member warning history**, and **chat profile game username display** — are not yet active and will follow these same privacy principles when released.

## 3. Private Chat Privacy (`CHAT_ENABLED`)

- **No Routine Monitoring:** Moderators have no technical endpoint to browse all chats or search conversations by username.
- **30-Day Automatic Deletion:** All chat messages and attachments are deleted permanently after 30 days by a daily scheduled job (03:00 TRT).
- **EXIF Stripping:** Location and camera metadata (APP1 / APP13) in uploaded JPEG images is stripped automatically before writing to disk.
- **Local Text-Only Auto-Filter:** Scans text only for severe safety patterns, never blocks messages, and never scans images or videos.
- **Case Snapshots:** Copied strictly on user report or auto-flag and purged within 7 days of closure (max 90 days open). Sanction and contentless audit logs are retained for 1 year.

## 4. Storage on Disk Volume vs. Memory

- **Persistent Volume (`RAILWAY_VOLUME_MOUNT_PATH`):** Sessions (`sessions/`), chat and moderation files (`chat/`), KVKK applications (`legal/`), and abuse reports/evidence (`reports/`). Chat attachments and report evidence are NEVER placed in public static directories and require server-side authorization.
- **In-Memory Only (RAM):** Rate limiter IP/user counters and short-lived API caches (60s–5m) stay strictly in volatile RAM and are never written to disk.
- **Error Logs:** Record only HTTP method, path, 8-char error code, and masked stack traces; secrets, session cookies, and chat message contents are never logged.

## 5. Cookies and Browser Storage

We do not use advertising or cross-site tracking cookies. See the exact list of strictly necessary cookies and browser storage keys in our [Cookie Policy](/en/yasal/cerez-politikasi).

## 6. Security Measures

- HTTPS enforcement and strict Helmet Content-Security-Policy headers,
- `HttpOnly`, `Secure` (in production), `SameSite=Lax` session cookies,
- Session-bound CSRF tokens, single-use idempotency keys, honeypot traps, and rate limiting,
- Strict magic-byte file verification and randomized filenames,
- Fresh uncached Bot API role checks and conflict-of-interest enforcement on all staff actions.

## 7. Age Limits, Rights, and Contact

Users under 13 may not use the service; users aged 13–17 require parental/guardian permission. Submit data rights inquiries via the [KVKK Request Form](/en/yasal/kvkk-basvuru) or `{{LEGAL_EMAIL}}`, and report abuse or violations via [Report Abuse](/en/bildir).
