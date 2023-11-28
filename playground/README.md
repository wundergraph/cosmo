# Standalone Custom GraphiQL Playground.

A version of playground available in studio that can be built and bundled into the router.

```
npm run build
```

This will build a single html file and update the [graphiql.html](/router/internal/graphiql/graphiql.html) in the router.

## TODO

This uses components and design language taken from the studio. For now we need to replicate work done for the custom playground in the studio to here. Move common components into its own package to avoid replicating work.
