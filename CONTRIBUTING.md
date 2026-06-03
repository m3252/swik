# Contributing

Thanks for helping improve `ai-switch`.

## Project Boundaries

This project must stay clean-room and open-source-safe:

- do not copy proprietary source code
- do not copy leaked Claude Code, Codex, Gemini, Cursor, Windsurf, or Aider internals
- do not add code based on decompiled binaries or private repositories
- do not add fixtures containing real tokens, cookies, session data, or private MCP endpoints

Contributions should be based on public documentation, user-created project files, and observable configuration formats.

## Development

```sh
npm test
node src/cli.js --help
node src/cli.js convert cc codex --dry-run --cwd <project>
```

The CLI currently has no runtime dependencies. Keep it that way unless a dependency removes enough risk or complexity to justify the supply-chain cost.

## Pull Requests

Please include tests for converter changes. For new provider adapters, add fixtures that use fake paths, fake commands, and fake environment values.
