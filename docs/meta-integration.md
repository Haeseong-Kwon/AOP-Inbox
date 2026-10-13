# Meta / Instagram integration

What AOP Inbox does **not** do (and won't add): store Instagram credentials, reuse session cookies, call private APIs, crawl DMs, automate login, auto-comment/auto-follow to unlock guides, or download media around policy.

What it does: Web Share Target and paste for new items; Meta's official “Download your information” export (parsed in the browser) for history; Instagram oEmbed only with an app token (`META_OEMBED_TOKEN`).

## Comment-gated guides

Detected as `guideRequired`. The app explains the steps (follow if you choose, leave the keyword yourself, paste what you receive) and links the received guide to the original item (`parent_item_id`) as evidence; the setup is re-derived from it.

## Future official options (to verify before building)

- Instagram Messaging API (Meta for Developers) for receiving messages sent *to a business account* — requires app review and business account; not a personal-DM reader.
- Instagram Graph API media/oEmbed scopes for richer previews.

Neither is required for the current product and neither is assumed to allow reading personal DMs.
