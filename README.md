# PTT

A local-first AI frontend where translation is a first-class citizen.
Runs in the browser, connects to AI backends that you already have, and keeps
everything on your machine.

PTT does not compile or manage backends. It talks to their OpenAI-compatible
HTTP API, so you can use prebuilt binaries:

- **llama.cpp** — release binaries from the official project
- **ik_llama.cpp** — prebuilt binaries published by Thireus
- **vLLM** — official wheels/binaries
- **Ollama** — install and run the daemon
- any other server exposing `/v1/chat/completions` and `/v1/models`

## Quick start

```bash
npm install
npm start
# first run builds automatically, then open http://127.0.0.1:4750
```

`npm start` keeps the server in the foreground: leave the terminal open.
If the page is unreachable, make sure this process is still running.
To expose PTT on your network (WSL, container, remote box):

```bash
PTT_HOST=0.0.0.0 npm start
```

By default PTT expects llama.cpp at `http://127.0.0.1:8080/v1`.
Create `config.json` (see `config.example.json`) to point at other backends.

```json
{
  "host": "127.0.0.1",
  "port": 4750,
  "providers": [
    { "id": "llama-cpp", "kind": "llama-cpp", "baseUrl": "http://127.0.0.1:8080/v1" },
    { "id": "ollama", "kind": "ollama", "baseUrl": "http://127.0.0.1:11434/v1" },
    { "id": "vllm", "kind": "openai-compatible", "baseUrl": "http://127.0.0.1:8000/v1" }
  ]
}
```

Environment overrides: `PTT_HOST`, `PTT_PORT`, `PTT_CONFIG`.

### Docker

```bash
docker build -t ptt .
docker run --rm -p 4750:4750 -v "$PWD/config.json:/app/config.json" ptt
```

Inside a container, backends running on the host are reachable at
`http://host.docker.internal:<port>/v1` (Linux may need `--add-host`).

### Single binary

```bash
npm run build:binary   # requires Bun; output: dist/ptt
```

## Development

```bash
npm run dev        # starts API (:4750) and UI (:5173)
# open http://127.0.0.1:5173
```

Then run all checks:

```bash
npm run check        # typecheck + i18n parity + tests
```

## Architecture

```
packages/core        domain types and the ProviderAdapter contract
packages/providers   OpenAI-compatible client and provider factories
packages/i18n        locale list, detection, Fluent translator
apps/server          HTTP API, routing, static assets
apps/web             Vite + TypeScript UI
scripts              asset generation, i18n gate, bundling
```

Every backend is thin: it speaks the OpenAI-compatible protocol. Add a new
backend by adding one factory in `packages/providers/src/registry.ts`.

## Translation workflow

Every user-facing string lives in `packages/i18n/locales/<locale>.ftl`.
Source of truth is `en.ftl`.

A new feature is only done when its keys exist in **every** locale.
`npm run check:i18n` enforces this in CI: missing or unknown keys fail the build.

Add a language:

1. Copy `en.ftl` to `<locale>.ftl` and translate.
2. Add the locale code to `SUPPORTED_LOCALES` in `packages/i18n/src/locales.ts`.
3. Run `npm run check:i18n`.

The UI picks the language from the browser and remembers the user's choice.
No language is hardcoded at runtime; the user can always switch.

## Principles

- Local by default: no telemetry, no remote prompt storage.
- Modular: one file per responsibility, no monoliths.
- Data over code: backends, locales and capabilities are configured, not hardcoded.
- Minimal runtime dependencies: the server uses only Node built-ins.
