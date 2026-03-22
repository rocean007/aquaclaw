# Contributing to AquaClaw

Thanks for wanting to help! AquaClaw welcomes contributions of all kinds.

## Ways to contribute

- **Bug reports** — open an issue with reproduction steps
- **New channels** — add a file to `src/channels/` following `BaseChannel`
- **New tools** — add to `ToolRegistry._registerBuiltins()` in `src/tools/registry.mjs`
- **New skills** — add to `BUILTIN_SKILLS` in `src/skills/registry.mjs` or submit to AquaHub
- **Docs improvements** — edit `README.md`, `VISION.md`, or files in `docs/`
- **AI/vibe-coded PRs welcome** 🤖

## Dev setup

```bash
git clone https://github.com/aquaclaw/aquaclaw.git
cd aquaclaw
pnpm install
pnpm gateway:watch   # auto-reload
```

Set your API key in `~/.aquaclaw/aquaclaw.json` or as `ANTHROPIC_API_KEY` env var.

## Adding a channel

1. Create `src/channels/<name>.mjs`
2. Export a class extending `BaseChannel` with `start()`, `stop()`, `send()`
3. Add it to the `channelMap` in `src/channels/router.mjs`
4. Add config prompts to `packages/cli/onboard/wizard.mjs`
5. Add to the channel table in `README.md`

## Adding a tool

1. Call `this._register({ name, description, inputSchema, handler })` in `ToolRegistry._registerBuiltins()`
2. The handler receives `(input, ctx)` and should return a string result
3. Set `requiresHost: true` if the tool requires running on the gateway machine (not in sandbox)

## Code style

- ESM modules (`.mjs`)
- No TypeScript required — JSDoc comments for types where helpful
- Async/await throughout
- Errors thrown as `new Error(...)` with clear messages

## PR checklist

- [ ] New channel/tool has a working implementation
- [ ] README updated if adding a user-facing feature
- [ ] `aquaclaw doctor` still passes
- [ ] No new required dependencies added without discussion

## License

MIT. By contributing you agree your code will be licensed under MIT.
