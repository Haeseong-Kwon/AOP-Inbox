# Instagram DM capture (셜커 봇)

People share a Reel to **your bot account** in an Instagram DM — the same gesture as sending it to a friend — and it lands in their shulker box. The bot replies "셜커박스에 담았어요 ✓".

It uses Meta's official **Instagram API with Instagram Login** (messaging webhooks). No Instagram passwords, cookies, private endpoints, scraping or media downloads. AOP Inbox only sees messages sent *to the bot*.

## How it works

1. In AOP Inbox → Settings → **Instagram DM**, a user taps **Connect Instagram** and gets a one-time code (`SHULKER-XXXXXXXX`, 15 minutes, stored as a hash).
2. They DM the code to the bot. The webhook binds their Instagram-scoped ID (IGSID) to their AOP Inbox account.
3. From then on, anything they DM to the bot is captured for them:
   - shared **Reels / posts** (`ig_reel`, `reel`, `ig_post`, legacy `share`) → an Instagram item keyed by media ID, titled from the caption. Meta sends the caption and a signed CDN asset URL, *not* the `instagram.com/reel/…` permalink, so the item has no "open original" link; the media is never fetched.
   - text with a link → saved like a pasted link (a copied Reel link keeps its permalink).
   - other text → a note.
   - photos, voice, stickers → not saved; the bot says so.
4. Messages from unlinked senders are never stored; the bot only replies with how to link.

Webhook deliveries are verified with `X-Hub-Signature-256` (HMAC-SHA256 of the raw body, app secret), capped at 256 KB, acknowledged immediately and processed with `after()`. Redeliveries are dropped by message ID (`instagram_inbound`, pruned after 7 days, no content).

## One-time setup (server owner)

You need: an Instagram account for the bot, a Meta developer account, and the deployed AOP Inbox URL.

1. **Bot account.** Create an Instagram account (e.g. `@my_shulker_box`) and switch it to a **Professional** account (Creator or Business). No Facebook Page is needed for Instagram Login.
   In the bot's Instagram app: Settings → Messages and story replies → Message controls → Connected tools → turn on **Allow access to messages**.
2. **Meta app.** At developers.facebook.com → Create app → use case **Manage messaging & content on Instagram** (Instagram API).
3. **Roles.** App roles → Roles → **Instagram Testers**: add the bot account *and every person who will DM it* (while the app is in development mode, Meta only delivers messages from accounts with a role). Each person accepts in Instagram → Settings → Website permissions → Apps and websites → Tester invites.
4. **Token.** Instagram → API setup with Instagram login → *Generate access tokens* → add the bot account → copy the token (long-lived, 60 days). Grant `instagram_business_basic` and `instagram_business_manage_messages`.
5. **Account ID and username.**
   ```bash
   curl "https://graph.instagram.com/v25.0/me?fields=user_id,username&access_token=$TOKEN"
   ```
   `user_id` → `INSTAGRAM_ACCOUNT_ID`, `username` → `INSTAGRAM_BOT_USERNAME`.
6. **Environment** (Vercel → Project → Settings → Environment Variables, Production), then redeploy:
   | Variable | Value |
   |---|---|
   | `INSTAGRAM_APP_SECRET` | Instagram app secret (API setup with Instagram login → Instagram app secret) |
   | `INSTAGRAM_VERIFY_TOKEN` | any random string you choose (`openssl rand -hex 16`) |
   | `INSTAGRAM_ACCESS_TOKEN` | token from step 4 |
   | `INSTAGRAM_ACCOUNT_ID` | `user_id` from step 5 |
   | `INSTAGRAM_BOT_USERNAME` | `username` from step 5 |
7. **Webhook.** API setup with Instagram login → Configure webhooks: callback URL `https://<your-domain>/api/instagram/webhook`, verify token = `INSTAGRAM_VERIFY_TOKEN` → Verify and save → subscribe the **messages** field. Then subscribe the bot account:
   ```bash
   curl -X POST "https://graph.instagram.com/v25.0/me/subscribed_apps?subscribed_fields=messages&access_token=$TOKEN"
   ```
8. **Try it.** Settings → Instagram DM → Connect Instagram → DM the code to the bot → share a Reel to it.

## Operating notes

- **Token expiry:** the long-lived token lasts 60 days. Refresh it before then and update `INSTAGRAM_ACCESS_TOKEN`:
  `curl "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=$TOKEN"`. If it lapses, saving keeps failing silently on Meta's side (no webhooks) and replies fail (`instagram.reply_failed` in logs).
- **Signature errors** (`instagram.bad_signature` in logs, 401s in Meta's webhook dashboard): the secret doesn't match the app that signs deliveries — use the Instagram app secret from step 6; for apps using Facebook Login it's the Meta app secret (App settings → Basic).
- **Opening it to the public** (people without a tester role) requires Meta App Review for `instagram_business_manage_messages` and Business Verification.
- **Reply window:** the bot only replies to messages it just received, well inside Meta's 24-hour messaging window.
- **Payload drift:** Meta has been renaming share attachment types (`share` → `ig_post`, 2025–26). Parsing is lenient (`lib/instagram/inbound.ts`); unknown types are ignored, not errors.
