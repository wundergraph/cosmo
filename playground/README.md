# Cosmo Playground

A custom GraphQL playground with [Advanced Request Tracing](https://cosmo-docs.wundergraph.com/router/advanced-request-tracing-art) and more built on top of GraphiQL.

## Features

- 🔍 Advanced Request Tracing (ART) visualization
- 📊 Query Plan visualization
- 🔌 **Extensions API** for custom functionality
- 🎨 Customizable theme (light/dark)
- ⚡ WebSocket subscriptions support
- 📝 Custom scripts (pre/post operation)
- 🛠️ Client-side validation

## Installation

```bash
npm install @wundergraph/playground
```

## Basic Usage

```tsx
import { Playground } from "@wundergraph/playground"
import "@wundergraph/playground/styles"

export const YourComponent = () => {
  return (
    <Playground 
      routingUrl="https://your-api.com/graphql" // the endpoint of the router
      hideLogo={false} // boolean to hide the wundergraph logo
      theme="dark" // 'light' or 'dark'
    />
  );
}
```

## Extensions API

The playground supports a powerful extension system that allows you to add custom UI elements and functionality.

### Quick Example

```tsx
import { Playground, PlaygroundExtension } from "@wundergraph/playground"
import "@wundergraph/playground/styles"

const extensions: PlaygroundExtension[] = [
  {
    type: 'toolbar-button',
    id: 'ai-assist',
    position: 'right',
    render: (context) => (
      <button onClick={() => console.log(context.query)}>
        AI Assist
      </button>
    )
  }
];

export const YourComponent = () => {
  return (
    <Playground 
      routingUrl="https://your-api.com/graphql"
      extensions={extensions}
    />
  );
}
```

### Extension Types

- **toolbar-button**: Add custom buttons to the toolbar
- **header**: Inject content above the playground
- **footer**: Inject content below the playground
- **panel**: Add custom tabs in the editor tools section
- **response-view**: Add custom response visualization options

### Extension Context

All extension render functions receive a context object with:

```typescript
interface PlaygroundExtensionContext {
  query?: string;
  setQuery: (query: string) => void;
  headers?: string;
  setHeaders: (headers: string) => void;
  response?: string;
  view: PlaygroundView;
  setView: (view: PlaygroundView) => void;
  status?: number;
  statusText?: string;
  schema?: any;
}
```

For complete documentation, see:
- [EXTENSIONS.md](./EXTENSIONS.md) - Full extensions API documentation
- [EXAMPLE.tsx](./EXAMPLE.tsx) - Working code examples
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture

## Advanced Usage

### Query Change Callback

```tsx
<Playground 
  routingUrl="https://your-api.com/graphql"
  onQueryChange={(setQuery) => {
    // You can now programmatically set queries
    setQuery('{ users { id name } }');
  }}
/>
```

### Custom Scripts

```tsx
<Playground 
  routingUrl="https://your-api.com/graphql"
  scripts={{
    transformHeaders: (headers) => {
      // Modify headers before requests
      return { ...headers, 'X-Custom': 'value' };
    }
  }}
/>
```

### Custom Fetch

```tsx
<Playground 
  routingUrl="https://your-api.com/graphql"
  fetch={customFetchFunction}
/>
```

## Development

This is a version of the playground that is found in Cosmo Studio that can be built and bundled into the router.

### Build for Router

```bash
pnpm run build:router
```

This will build a single HTML file and update the [graphiql.html](/router/internal/graphiql/graphiql.html) in the router.

### Build as Package

```bash
pnpm build
```

This builds the playground as a distributable npm package.

## TypeScript Support

The package includes full TypeScript definitions. Import types as needed:

```typescript
import type {
  PlaygroundExtension,
  PlaygroundExtensionContext,
  ToolbarButtonExtension,
  HeaderExtension,
  FooterExtension,
  PanelExtension,
  ResponseViewExtension,
} from '@wundergraph/playground';
```

## TODO

This uses components and design language taken from the studio. For now we need to replicate work done for the custom playground in the studio to here. Move common components into its own package to avoid replicating work.

