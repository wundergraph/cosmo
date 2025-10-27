# @wundergraph/cosmo-router-plugin

TypeScript/Bun plugin server library for Cosmo Router. This library provides a simple way to create gRPC-based plugins that work with the Cosmo Router using the go-plugin protocol.

## Installation

```bash
npm install @wundergraph/cosmo-router-plugin
# or
bun add @wundergraph/cosmo-router-plugin
# or
pnpm add @wundergraph/cosmo-router-plugin
```

## Usage

```typescript
import { PluginServer } from '@wundergraph/cosmo-router-plugin';
import { YourServiceService, IYourServiceServer } from './generated/service_grpc_pb';

// Define your service implementation
const serviceImplementation: IYourServiceServer = {
  yourMethod: (call, callback) => {
    // Handle your gRPC method
    callback(null, response);
  }
};

// Create and start the plugin server
const pluginServer = new PluginServer();
pluginServer.addService(YourServiceService, serviceImplementation);

pluginServer.serve().catch((error) => {
  console.error('Failed to start plugin server:', error);
  process.exit(1);
});
```

## Features

- **Unix Domain Socket Support**: Automatically creates and manages Unix domain sockets for efficient IPC
- **Health Check Integration**: Built-in gRPC health check service
- **go-plugin Protocol**: Compatible with HashiCorp's go-plugin protocol
- **TypeScript Support**: Full TypeScript type definitions included

## API

### `PluginServer`

#### Constructor

```typescript
constructor(socketDir?: string)
```

Creates a new plugin server instance.

- `socketDir` (optional): Directory where the Unix socket will be created. Defaults to the system's temporary directory.

#### Methods

##### `addService(service, implementation)`

Adds a gRPC service implementation to the server.

- `service`: gRPC service definition
- `implementation`: Service implementation object

##### `serve()`

Starts the server and outputs the go-plugin handshake information.

Returns a `Promise<void>` that resolves when the server is ready.

## License

Apache-2.0

