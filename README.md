# ismaeel-funnels

Reel → comment → DM → landing page → email. One landing page per tool, hosted free on GitHub Pages.

Live hub: https://mismail278.github.io/ismaeel-funnels/

## How it works

1. A reel says "comment KEYWORD for the full setup."
2. The comment-to-DM tool sends the commenter a link to `/<slug>/`.
3. The visitor enters a first name and email. That posts to a Kit form.
4. Kit sends the confirmation email. Its button confirms the address and opens `/<slug>/setup.html`.
5. The page sends the tag `lead-<slug>` with each signup, and Kit records which form they joined, so the list can be sold to later by topic.

## Layout

| Path | What it is |
|---|---|
| `index.html` | Hub for link-in-bio. Generated. |
| `assets/` | Shared CSS, JS, fonts, logo, favicon, preview images |
| `_template/` | Opt-in, setup, hub, preview image and Funnel Card templates |
| `_content/<slug>.json` | The copy for one funnel. Edit this, not the generated pages. |
| `<slug>/` | Generated opt-in page and setup page |
| `funnels.json` | Registry: slug, keyword, tool, Kit form ID, page URL, date, video file |
| `site.config.json` | Brand, handle, and the offer shown at the bottom of every setup page |
| `scripts/funnel.mjs` | Build, Kit, publish and live check commands |

## Commands

```
node scripts/funnel.mjs build
node scripts/funnel.mjs tag <slug>
node scripts/funnel.mjs wire <slug>
node scripts/funnel.mjs publish -m "message"
node scripts/funnel.mjs check <slug>
node scripts/funnel.mjs card <slug> --out <path>/funnel-card.md
```

## Kit

The key comes from the `KIT_API_KEY` environment variable and is never stored here. Kit's API can create tags but not forms, so each funnel needs one form made in Kit's dashboard, named `lead-<slug>`. The `wire` command finds it by name. Until then the page shows "Sign-up opens soon".

## Rules

No API keys, no raw footage. `publish` refuses to commit video, audio, `.env` files, files over 5 MB, or anything containing the Kit key.
