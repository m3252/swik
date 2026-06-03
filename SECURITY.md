# Security Policy

`ai-switch` moves project-level agent configuration. Treat migration output as sensitive until you review it.

## Supported Data

In scope:

- project instruction files
- project-local MCP server configuration
- project-local skills

Out of scope:

- account credentials
- session files
- private chat history
- cloud-side memories
- source code from proprietary or leaked tools

## Reporting

Please open a private security advisory or contact the maintainers before publishing a vulnerability that could expose secrets or execute unexpected commands.

## Handling Secrets

The CLI may copy environment values that already exist in project MCP configuration. It does not verify whether those values are secrets. Always review generated config before running migrated agents.
