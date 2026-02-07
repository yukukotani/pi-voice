---
name: pi-coding-agent-config
description: Reference for customizing and configuring pi-coding-agent (pi). Covers settings files (settings.json), extensions, skills, prompt templates, package management, and programmatic usage via the SDK. Use when asked about pi configuration or customization.
---

# pi-coding-agent Configuration & Customization Guide

Comprehensive reference for customizing pi-coding-agent (pi).

## Reference Documents

Read the following documents as needed:

### Context Files

- [context-files.md](references/context-files.md) - How pi loads `AGENTS.md` / `CLAUDE.md` context files and system prompt customization (`SYSTEM.md`, `APPEND_SYSTEM.md`).

### Settings

- [settings.md](references/docs/settings.md) - All options for settings files (`~/.pi/agent/settings.json`, `.pi/settings.json`). Model, theme, compaction, retry, and more.

### Extensions

- [extensions.md](references/docs/extensions.md) - How to create TypeScript extensions. Custom tools, event hooks, custom UI, command registration, etc.
- [Extension examples](references/examples/extensions/) - Numerous sample extensions.

### Skills

- [skills.md](references/docs/skills.md) - How to create Agent Skills. SKILL.md format, frontmatter, discovery rules.

### Prompt Templates

- [prompt-templates.md](references/docs/prompt-templates.md) - How to create prompt templates invoked via `/name`. Argument support.

### Package Management

- [packages.md](references/docs/packages.md) - How to share extensions, skills, themes, etc. as npm/git packages. `pi install`, `pi remove`, `pi update`.

### SDK (Programmatic Usage)

- [sdk.md](references/docs/sdk.md) - How to use pi as a library to build custom UIs or automated pipelines.
- [SDK examples](references/examples/sdk/) - Step-by-step examples from minimal to full control.

## Typical Configuration Workflow

1. **Global settings**: Edit `~/.pi/agent/settings.json` (shared across all projects)
2. **Project settings**: Edit `.pi/settings.json` (project-specific, overrides global)
3. **Add extensions**: Place TypeScript files in `.pi/extensions/`
4. **Add skills**: Create `.pi/skills/<name>/SKILL.md`
5. **Prompt templates**: Create `.pi/prompts/<name>.md`
6. **Use packages**: `pi install npm:<package>` or `pi install git:<repo>`

Use `read` to load the reference documents above as needed.
