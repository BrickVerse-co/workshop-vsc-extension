# Test Workspace

This folder is a ready-to-open BrickLua test project for validating:

- `brickverse.project.json` discovery
- built-in default Lua + Engine API loading
- API-powered completions and hover
- type annotation diagnostics

Open this folder as the VS Code workspace root and edit `scripts/main.bricklua`.

Optional custom API override:

- Add `.brickverse/api.json`
- Set `"api": "./.brickverse/api.json"` in `brickverse.project.json`
