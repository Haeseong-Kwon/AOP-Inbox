# Save from iPhone (Shortcuts)

iOS doesn’t let installed web apps appear in the share sheet, but Shortcuts can. One Shortcut gives you:

```
Instagram → Share → Save to AOP Inbox → “Saved to AOP Inbox” notification
```

No app switch, no exports, works for Reels, posts, YouTube, web pages and plain text. The same Shortcut appears in the macOS share sheet.

## Set it up (≈ 2 minutes)

Easiest: **Settings → Save from iPhone → Set up iPhone Shortcut**. It creates a token and shows every value pre-filled with copy buttons and a “Test the token” button. The steps:

1. Shortcuts app → **+** → name it **Save to AOP Inbox**.
2. **ⓘ Details** → **Show in Share Sheet** on; types **URLs** and **Text**.
3. Action **Get Contents of URL**
   - URL: `https://<your AOP Inbox>/api/capture`
   - Method: **POST**
   - Header: `Authorization` = `Bearer aopc_…` (your token)
   - Request Body: **JSON**, field `input` (Text) = **Shortcut Input**
4. Action **Get Dictionary Value** → `message` from *Contents of URL*.
5. Action **Show Notification** → *Dictionary Value*.
6. Instagram → **Share** → **More** → **Save to AOP Inbox** (Edit Actions → add to Favorites for one tap).

The address must be reachable from the phone: your deployed HTTPS URL, or a private tunnel (Tailscale, Cloudflare Tunnel) to a local instance. `localhost` won’t work from the phone.

## The API it uses

`POST /api/capture` with `Authorization: Bearer aopc_…`. Body: JSON `{ "input": "…" }` or `{ "url", "text", "title" }`, form fields, or a plain-text body. Responses always include `message` for the notification:

| Status | `message` |
|---|---|
| 201 | `Saved to AOP Inbox` / `Note saved to AOP Inbox` |
| 200 | `Already in your Inbox — <title>` (same Reel shared again; a caption you add is appended as a note) |
| 401 | token revoked or unknown |
| 429 | more than 300 saves from this token in an hour |

`GET /api/capture` with the token answers `{"ok":true,"message":"Connected to AOP Inbox"}` — handy for checking a Shortcut.

## Security

- **Capture-only:** the token can save items and nothing else. Every other endpoint ignores it and still requires your session; it can’t read your inbox.
- Shown once; only a SHA-256 hash is stored. Up to 10 tokens, each revocable in Settings (last-used time and count shown).
- Atomic per-token limit of 300 saves/hour, so a leaked token can’t flood the inbox.
- Use https: a token over plain http on a shared network can be read in transit.
