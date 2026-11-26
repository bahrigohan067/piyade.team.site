---
title: KVKK Privacy Notice
version: 1.0
lastUpdated: 2026-11-26
---

# Personal Data Protection Law (KVKK) Privacy Notice

This notice informs you clearly and transparently about how **Piyade World (Piyade Dünyası)** ({{SITE_URL}}) and its connected Discord community bot process your personal data under Turkish Law No. 6698 on the Protection of Personal Data ("KVKK").

## 1. Identity and Contact Details of the Data Controller

| Field | Value |
| --- | --- |
| Data Controller Name / Title | {{LEGAL_CONTROLLER_NAME}} |
| Address | {{LEGAL_ADDRESS}} |
| Email | {{LEGAL_EMAIL}} |
| Phone | {{LEGAL_PHONE}} |
| KEP Address | {{LEGAL_KEP}} |
| Trade Registry / MERSIS No. | {{LEGAL_REGISTRY_NO}} |
| Tax Office / Tax ID | {{LEGAL_TAX_NO}} |
| VERBIS Registration Status | {{LEGAL_VERBIS_STATUS}} |

## 2. Categories of Personal Data Processed (Actual Data Flow)

The website operates as a thin client without its own separate member database; membership and game records are fetched on demand from the connected Discord bot's internal REST API. Based on our actual codebase data flow, we process:

- **Discord Identity & Session Data:** Discord user ID, username, display name, avatar URL, and server role/level information obtained via Discord OAuth2 (`identify` scope only — email is NOT requested). OAuth access tokens are never stored in session or exposed to the browser.
- **Community Registration & Game Profile Data (Bot API):** The name/nickname, gender selection, chosen games and game usernames (Roblox, CS2, Zula, Minecraft), Roblox ID/username/avatar, and disciplinary warning history submitted or maintained via the bot.
- **Monthly Game Activity Data (Bot API):** For registered members who keep activity tracking enabled, cumulative play duration for the current calendar month only (automatically reset on the 1st of each month; no historical timeline is stored). Members with `tracking: false` are neither tracked nor displayed anywhere.
- **Private Chat & Moderation Data (when `CHAT_ENABLED` is active):** Private one-to-one messages, uploaded attachments (JPEG EXIF/location metadata is automatically stripped before saving), chat preferences (profile ring, blocked users, first-contact request toggle), copied case snapshots triggered strictly by user reports or our local text-only auto-filter, sanctions, and contentless audit logs.
- **Session, Cookie & Browser Storage Data:** Strictly necessary session cookie (`piyade.sid`, holding CSRF token and OAuth state), language preference cookie (`lang`), and UI preferences (`localStorage` / `sessionStorage`). See the full inventory in our [Cookie Policy](/en/yasal/cerez-politikasi).
- **Transaction Security & Error Logs:** Volatile in-memory (RAM-only) IP counters for rate limiting (never written to disk) and sanitized technical error logs with secrets/tokens masked.
- **KVKK Requests & Abuse Reports:** Contact details, descriptions, evidence images, and tracking codes submitted through the [KVKK Request Form](/en/yasal/kvkk-basvuru) or [Abuse Reporting System](/en/bildir).
- **UPCOMING FEATURE (Planned Future Data Flows):** In upcoming updates, **Google Sign-In** (`sub` identifier, email address, display name), an optional **"remember me" cookie**, **direct site member registration**, **Google member disciplinary history**, and **displaying game usernames on your chat profile to other members** will be added. Each will be clearly disclosed at launch.

## 3. Purposes of Processing

- Receiving and verifying game-based community registrations and synchronizing Discord server roles,
- Operating private one-to-one chat, file attachments, and safety controls,
- Enforcing community rules and reviewing abuse, copyright/DMCA, and unlawful content reports,
- Protecting sessions, CSRF integrity, and mitigating spam/automated abuse,
- Fulfilling KVKK Article 11 data subject requests within statutory deadlines,
- Complying with binding legal obligations from competent public authorities.

## 4. Legal Bases for Processing (KVKK Article 5)

> **Note:** The KVKK Article 5 legal basis mappings below are draft classifications; **legal review required** before production sign-off.

| Processing Activity | Proposed KVKK Article 5 Legal Basis | Status |
| --- | --- | --- |
| Discord OAuth login, session management, strictly necessary cookies | Art. 5/2-(c) Performance of contract/service & Art. 5/2-(f) Legitimate interest | *Legal review required* |
| Game-based registration and community profile management | Art. 5/2-(c) Performance of service | *Legal review required* |
| Rate limiting (RAM IP), CSRF, and security error logs | Art. 5/2-(ç) Legal obligation & Art. 5/2-(f) Legitimate interest | *Legal review required* |
| Handling KVKK applications and abuse/DMCA reports | Art. 5/2-(ç) Legal obligation & Art. 5/2-(e) Establishment/protection of rights | *Legal review required* |
| Chat moderation case review, cross-border transfers, chat profile game usernames *(upcoming)* | Art. 5/1 Explicit consent (and/or Art. 9 cross-border transfer safeguard) | *Legal review required* |

## 5. Data Transfers and International Transfers

We never sell your data or share it with advertisers. Strictly necessary technical transfers occur with:

- **Cloud Hosting Provider (Railway):** Web application, persistent disk volume, and technical error logs may reside on servers located abroad.
- **Discord (Discord Inc.):** OAuth2 authentication, server role checks, and avatar delivery (`cdn.discordapp.com`).
- **Roblox (Roblox Corporation):** Roblox account verification during registration and avatar delivery (`rbxcdn.com`).
- **Google (Google LLC):** Web font delivery (`fonts.googleapis.com` / `fonts.gstatic.com`) and, as an **UPCOMING FEATURE**, Google OAuth sign-in.
- **Competent Public Authorities:** Solely where strictly required by lawful official order.

Cross-border transfer safeguards under KVKK Article 9 are presented separately in the [Explicit Consent Notice](/en/yasal/acik-riza) *(legal review required)*.

## 6. Retention Periods and Destruction

| Data Category | Retention Period | Deletion Method |
| --- | --- | --- |
| Session file (`piyade.sid` / `sessions.json`) | 24 hours | Auto-deleted on expiry or logout |
| Chat messages and attachments | Up to **30 days** | Daily permanent cleanup at 03:00 TRT |
| Closed moderation case snapshots & evidence | Within **7 days** after closure | Automatic permanent purge |
| Open moderation cases | Maximum **90 days** | Automatic closure and snapshot purge |
| Chat sanction records & contentless audit logs | **1 year** | Scheduled expiry cleanup |
| Monthly game activity duration (Bot API) | Current calendar month only | Automatic reset on 1st of month (TRT) |
| KVKK application records & audit log | **{{KVKK_RETENTION_DAYS}} days** (~{{KVKK_RETENTION_YEARS}} yrs) | Secure deletion upon expiry |
| Abuse/DMCA report records & evidence images | **{{REPORT_RETENTION_DAYS}} days** | Secure deletion upon expiry |

## 7. Minors and Children's Privacy

- **Children under 13 years of age may NOT use** this website or connected community services; any data identified as belonging to a child under 13 will be deleted immediately.
- Users aged **13 to 17** declare that they have obtained **parental or legal guardian consent** when registering and using the service.
- Parents or guardians may request review or deletion of a minor's data at any time via the [KVKK Request Form](/en/yasal/kvkk-basvuru) or `{{LEGAL_EMAIL}}`.

## 8. Your Rights Under KVKK Article 11 and How to Apply

Under Article 11 of KVKK, you may request to:

1. Learn whether your personal data is processed and request information if so,
2. Learn the purpose of processing and whether data is used accordingly,
3. Know domestic or international third parties to whom data is transferred,
4. Request rectification of incomplete or inaccurate data,
5. Request erasure or destruction under KVKK Article 7,
6. Request notification of rectification/erasure to third-party recipients,
7. Object to adverse outcomes resulting exclusively from automated analysis,
8. Claim compensation for damages caused by unlawful processing.

**Submission Channels:**
- Online form: [KVKK Request Form](/en/yasal/kvkk-basvuru) (generates a tracking code verifiable on the [status lookup page](/en/yasal/kvkk-basvuru/sorgula)),
- Email / KEP: `{{LEGAL_EMAIL}}` (KEP if applicable: `{{LEGAL_KEP}}`),
- Postal address: `{{LEGAL_ADDRESS}}`.

Applications are answered free of charge as soon as possible and **within {{KVKK_RESPONSE_DEADLINE_DAYS}} days at the latest**. Additional verification details may be requested to protect your privacy.
