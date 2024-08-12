# Cosmo Playground.

A custom graphql playground with [Advanced Request Tracing](https://cosmo-docs.wundergraph.com/router/advanced-request-tracing-art) and more built on top of Graphiql.

## Installation

```bash
npm install @wundergraph/playground
```

## Usage

```tsx
import { Playground} from "@wundergraph/playground"
import "@wundergraph/playground/style.css"

export const YourComponent {
    return (
        <Playground 
            routingUrl={} // the endpoint of the router
            hideLogo={} // boolean to hide the wundergraph logo
            theme={} // 'light' or 'dark';
        />
    );
}
```



# Development
This is a version of the playground that is found in cosmo studio that can be built and bundled into the router.

```bash
pnpm run build:router
```
This will build a single html file and update the [graphiql.html](/router/internal/graphiql/graphiql.html) in the router.

Note: To build it as a plugin just run `pnpm build`

### TODO

This uses components and design language taken from the studio. For now we need to replicate work done for the custom playground in the studio to here. Move common components into its own package to avoid replicating work.
