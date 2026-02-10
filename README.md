# pi-voice

Voice interface for the [Pi Coding Agent](https://github.com/badlogic/pi-mono). Hold a key, speak, and pi executes your instructions with voice feedback.

https://github.com/user-attachments/assets/a4e23ac6-fad4-40a9-86c9-5919b3c4de31

## Installation

```bash
npm i -g pi-voice
# or
bun i -g pi-voice
```

## Usage

pi-voice is a daemon-style application that runs in the background once started. You can push-to-talk with the agent.

```bash
pi-voice start    # start the daemon in the background
pi-voice status   # show state, PID, and uptime
pi-voice stop     # stop the daemon
```

The push-to-talk trigger defaults to `Cmd+Shift+I` (macOS) / `Win+Shift+I` (Windows). Hold the key to record, release to send.

## Setting

### pi agent configuration

pi-voice launches a Pi agent session with the directory where `pi-voice start` was executed. This means **all standard pi configuration works as-is**:

- `AGENTS.md` — walked up from `cwd` to the filesystem root
- `.pi/settings.json` — project-level settings
- `.pi/skills/`, `.pi/extensions/`, `.pi/prompts/` — project-level resources
- `~/.pi/agent/` — global settings, skills, extensions, prompts, and models
- and more

Refer to the [Pi documentation](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) for details on these settings.

### pi-voice configuration

You can configure pi-voice in `.pi/pi-voice.json`:

```json
{
  "key": "ctrl+t",
  "provider": "local"
}
```

| Key | Description |
| --- | --- |
| `key` | Push-to-talk shortcut. Combine modifiers (`ctrl`, `shift`, `alt`/`opt`, `meta`/`cmd`) and a main key with `+`. Examples: `"ctrl+t"`, `"alt+space"`, `"ctrl+shift+r"`. Default: `"meta+shift+i"`. |
| `provider` | Speech provider for STT & TTS. `"local"`, `"gemini"` (Vertex AI), or `"openai"`. Default: `"local"`. |

### Environment variables

| Provider | Required variables |
| --- | --- |
| `local` | None (model is auto-downloaded on first launch). Optional: `WHISPER_MODEL_PATH` (custom model path), `WHISPER_MODEL` (model name, default `medium-q5_0`), `SAY_VOICE` (macOS `say` voice name, e.g. `"Kyoko"`). |
| `gemini` | `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` (optional, default `us-central1`) |
| `openai` | `OPENAI_API_KEY` |

#### Whisper model (local provider)

The `local` provider uses [Whisper](https://github.com/openai/whisper) for STT and the macOS `say` command for TTS. On first launch, a ggml-format Whisper model (`medium-q5_0`, ~514 MB) is automatically downloaded to `~/.pi-agent/whisper/` and cached for subsequent runs.

To use a different model, set `WHISPER_MODEL`:

```bash
export WHISPER_MODEL=base     # smaller & faster
```

Or point to your own model file directly:

```bash
export WHISPER_MODEL_PATH=/path/to/ggml-custom.bin
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, build commands, and release workflow.
