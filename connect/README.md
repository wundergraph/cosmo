# Proto

This NPM package host the proto files for Cosmo. It also serve as a dependency for other NPM packages that wants to use the auto-generated TypeScript files.

## Usage

Transpile the proto files to Javascript files:

```bash
pnpm build
```

You can generate the TypeScript files by running `pnpm generate` from the root of the repository.