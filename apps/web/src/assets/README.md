# Assets

Landing-page visual assets.

- `agents/*.svg`: AI agent marks from [@lobehub/icons-static-svg](https://github.com/lobehub/lobe-icons) (MIT).
- `frameworks/*.svg`: framework marks from [Simple Icons](https://simpleicons.org) (CC0).

Each mark remains a trademark of its owner. They are used only to say that DevMap
works with, or maps routes for, that product. Elysia has no file here on purpose:
its card falls back to a letter mark (see `src/lib/icons.ts`). To add or swap an
icon, drop an SVG (with `fill="currentColor"`) here and set `icon` in
`src/data/agents.ts` or `src/data/frameworks.ts`.
