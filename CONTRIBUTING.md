# Contributing

## Development

### Dev mode (daemon foreground)

```bash
bun run dev
```

Starts the pi-voice daemon in the foreground with hot-reload. Press the configured push-to-talk key to test.

### Dev mode (CLI only)

```bash
bun run dev:cli
```

## Build

```bash
bun run build
```

Outputs a production build to `out/`.
