# @wundergraph/wgc-plugin-forge

`wgc forge` builds a Cosmo Router with your own Go modules compiled in, and tests a new router release against those modules before you adopt it. It is the wgc entry point to Forge, WunderGraph's CLI for custom router workspaces.

```sh
wgc plugins install forge
wgc forge --help
```

## Which Forge runs

`wgc forge` is a thin layer. When the Forge CLI is installed, wgc hands every `wgc forge …` invocation to it unchanged: the arguments (including `--json`), stdin, stdout, stderr and the exit code.

1. `WGC_FORGE_BINARY=/path/to/forge` runs that binary.
2. Otherwise the first executable `forge` on `PATH` runs.
3. Otherwise wgc runs its builtin implementation of the Forge v0.1 commands.

Set `WGC_FORGE_BINARY=builtin` to use the builtin commands even when another `forge` is on `PATH`, such as Foundry's.

## The builtin implementation is temporary

The Forge CLI has no release yet. Until it does, `src/builtin/` implements the Forge v0.1 specification: the eight commands, the `forge.yaml` and `forge.lock` formats, and output that adapts to the caller (readable text for a person at a terminal, JSON for agents, CI and `--json`).

Both implementations sit behind the `ForgeEngine` interface in `src/engine.ts`. When Forge ships, delete `src/builtin/`, `test/builtin/` and `gomodules/`, and drop the builtin branch in `src/index.ts`. `wgc forge` then always runs the Forge binary.
