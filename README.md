# @deepseek-ai/dsh-client-ui-hello

A browser-only DSH web GUI plugin that adds a "hello" button at the bottom of
the sidebar; clicking it opens a centered dialog showing **hello world**. It
mounts into the official sidebar footer seat (`sidebar.footer.action`) — no DSH
source changes, nothing runs on the host.

## What it does

- Adds a 36px circular icon trigger beside the sidebar settings row, in both
  the 56px rail and the wide sidebar (label stays as the accessible name and
  hover tooltip).
- Clicking the trigger opens a centered modal dialog showing **hello world**.
  Click the mask or the Close button (or press Esc) to dismiss.
- Locale-aware: registers `zh` / `en` dictionaries through the official
  `ctx.locale` service; switching language updates the button tooltip and
  dialog title/close label in place.

## Install

### From the repository (development)

```sh
dsh plugin --profile web add link:/Users/Ray/TraeProjects/dsh-hello
```

Restart `dsh web` (or wait for the hot-reload) and look for the 👋 trigger at
the bottom of the sidebar.

### From npm (once published)

```sh
dsh plugin --profile web add @deepseek-ai/dsh-client-ui-hello@latest
```

## Build

```sh
pnpm install
pnpm run build         # tsc -p tsconfig.build.json && tsdown
pnpm run watch         # tsdown --watch (rebuild on file change)
pnpm run typecheck     # tsc --noEmit
pnpm run test          # vitest run
```

Outputs land under `lib/`:

- `lib/index.js` — host entry (empty `apply`)
- `lib/invariant.js` — invariant companion (empty `apply`)
- `lib/client.js` — browser bundle, wrapped in a `window.__ModuleLoader__.load`
  closure as required by the loader module table
- `lib/types/` — TypeScript declarations

## Architecture

```
src/
├── index.ts                 # Host apply (no-op; pure browser plugin)
├── invariant.ts             # Invariant companion (no assertions)
└── client/
    ├── index.ts             # Client apply: register dictionaries + sidebar.footer.action occupant
    ├── HelloButton.tsx      # Trigger button + portal dialog (React component)
    ├── hello.module.css     # Styles (design tokens only)
    ├── css-modules.d.ts     # CSS Modules type declaration for the tsdown inline preset
    └── locales.ts           # zh / en dictionaries (zh is the key-set source)

shared/
├── tsdown.client.ts         # Self-contained tsdown preset (vendored from dsh-web-ui)
└── web-platform.ts          # PLATFORM_MODULES frozen module table

cordis.patch.yml             # bundle layer — inserts ui-hello row into web profile
tsdown.config.ts             # clientBundle('@deepseek-ai/dsh-client-ui-hello', [...])
```

### Why no source changes are needed

DSH exposes the sidebar through the declarative **slot system**. `ui-sidebar`
declares `sidebar.footer.action` as a `kind: 'list'` slot, which any plugin may
populate without modifying the sidebar. This plugin registers a single occupant
with id `hello` and component `HelloButton`.

## Security model

This plugin renders only a static trigger and a static dialog. It performs no
network requests, reads no host state, and writes no logs. It is fully
client-side.

## License

MIT