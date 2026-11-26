---
title: Cookie Policy
version: 1.1
lastUpdated: 2026-11-26
---

# Cookie and Browser Storage Policy

**Piyade World (Piyade Dünyası)** does **not** use advertising, behavioral profiling, or third-party analytics tracking cookies. Only the strictly necessary cookies and local browser storage keys listed below are used to keep the site functional and secure.

## 1. Cookies Inventory

| Name | Purpose | Duration | Type |
| --- | --- | --- | --- |
| `piyade.sid` | Maintains your login session, CSRF protection token, OAuth2 `state`/`nonce`/PKCE verification, and form idempotency keys (`HttpOnly`, `Secure` in prod, `SameSite=Lax`). | 24 hours | Strictly Necessary (Session / Security) |
| `lang` | Remembers your selected language (`tr` or `en`) across visits (`SameSite=Lax`, `Secure` in prod). | 1 year | Strictly Necessary / Functional |
| `pw_remember` | Persistent "remember me" token for Google site members (`HttpOnly`, `Secure` in prod, `SameSite=Lax`). Uses a `selector.validator` split where only the SHA-256 digest of the validator is stored server-side; rotates on every use; supports up to 5 devices per member; revokes all devices on mismatch (theft detection); and can be revoked on logout or via Profile → My Sessions. Does not affect Discord sessions. | 90 days (rolling on use) | Functional / Session Continuity |

## 2. Browser Storage (`localStorage` & `sessionStorage`) Inventory

These keys remain on your device to remember interface preferences and are never used for advertising:

| Key Name | Storage | Purpose | Duration | Type |
| --- | --- | --- | --- | --- |
| `piyade_sidebar_state` | `localStorage` | Remembers whether the left navigation sidebar is `open` or `collapsed`. | Until cleared | Functional (UI) |
| `piyade_activity_panel_state` | `localStorage` | Remembers whether the "My Activity" sidebar panel is expanded or collapsed. | Until cleared | Functional (UI) |
| `piyade_chat_recent_emojis` | `localStorage` | Stores up to 24 recently used chat emojis locally in your browser. | Until cleared | Functional (UI) |
| `ui-sounds` | `localStorage` | Remembers whether interface sound effects are muted (`off`). | Until cleared | Functional (UI) |
| `piyade_cookie_notice_ack` | `localStorage` | Remembers that you dismissed the strictly-necessary cookie notice bar. | Until cleared | Functional (UI) |
| `piyade_chat_draft_<userId>` | `sessionStorage` | Preserves unsent chat message drafts across reloads in the same tab. | Cleared when tab closes | Functional (Temporary) |
| `piyade_dock_last_y` | `sessionStorage` | Remembers the last vertical position of the sidebar dock dot animation. | Cleared when tab closes | Functional (Temporary) |

## 3. Third-Party Resource Requests

The site makes standard browser requests only to **Google Fonts** (`fonts.googleapis.com`, `fonts.gstatic.com`) for typography and to **Discord CDN** (`cdn.discordapp.com`) and **Roblox CDN** (`rbxcdn.com`) for member avatars. No ad networks or tracking pixels are loaded.

## 4. Managing or Deleting Cookies

You can clear cookies and browser storage anytime from your browser's Privacy & Security settings. Blocking the strictly necessary `piyade.sid` cookie will prevent signing in, CSRF-protected form submissions, and member panels from working.

For privacy inquiries, see our [KVKK Privacy Notice](/en/yasal/kvkk-aydinlatma) or contact `{{LEGAL_EMAIL}}`.
