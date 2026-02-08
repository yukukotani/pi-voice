# Contributing

## Development

### Dev mode (Electron + HMR)

```bash
bun run dev:electron
```

Starts a Vite dev server with HMR and launches Electron as a background daemon (no visible window).

### Dev mode (CLI only)

```bash
bun run dev:cli
```

## Build

```bash
bun run build
```

Outputs a production build to `out/`.

## Preview

```bash
bun run preview
```

Launches Electron with the built artifacts for manual verification.
