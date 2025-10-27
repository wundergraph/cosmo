
const pluginServerTs = `import * as grpc from '@grpc/grpc-js';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Simple health check service implementation compatible with Bun
 */
class SimpleHealthCheck {
    private statuses: Map<string, number> = new Map();

    constructor() {
        // Default to serving
        this.setStatus('', 1); // SERVING = 1
    }

    setStatus(service: string, status: number): void {
        this.statuses.set(service, status);
    }

    check(call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>): void {
        const service = call.request.service || '';
        const status = this.statuses.get(service) ?? 1; // Default to SERVING

        callback(null, { status });
    }

    watch(call: grpc.ServerWritableStream<any, any>): void {
        const service = call.request.service || '';
        const status = this.statuses.get(service) ?? 1;

        call.write({ status });
    }

    addToServer(server: grpc.Server): void {
        const healthCheckService = {
            check: {
                path: '/grpc.health.v1.Health/Check',
                requestStream: false,
                responseStream: false,
                requestSerialize: (value: any) => Buffer.from(JSON.stringify(value)),
                requestDeserialize: (value: Buffer) => JSON.parse(value.toString()),
                responseSerialize: (value: any) => Buffer.from(JSON.stringify(value)),
                responseDeserialize: (value: Buffer) => JSON.parse(value.toString()),
            },
            watch: {
                path: '/grpc.health.v1.Health/Watch',
                requestStream: false,
                responseStream: true,
                requestSerialize: (value: any) => Buffer.from(JSON.stringify(value)),
                requestDeserialize: (value: Buffer) => JSON.parse(value.toString()),
                responseSerialize: (value: any) => Buffer.from(JSON.stringify(value)),
                responseDeserialize: (value: Buffer) => JSON.parse(value.toString()),
            },
        };

        server.addService(healthCheckService as any, {
            check: this.check.bind(this),
            watch: this.watch.bind(this),
        });
    }
}

/**
 * Plugin server that manages gRPC server with Unix domain socket
 */
export class PluginServer {
    private readonly socketPath: string;
    private readonly network: string = 'unix';

    private server: grpc.Server;
    private healthImpl: SimpleHealthCheck;

    constructor(socketDir: string = os.tmpdir()) {
        // Generate a unique temporary file path
        const tempPath = path.join(socketDir, \`plugin_${Date.now()}${Math.floor(Math.random() * 1000000)}\`);
        this.socketPath = tempPath;

        // Ensure the socket file doesn't exist
        if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
        }

        // Create the gRPC server
        this.server = new grpc.Server();

        // Initialize health check service with overall server status and plugin service
        this.healthImpl = new SimpleHealthCheck();
        this.healthImpl.setStatus('plugin', 1); // SERVING = 1
        this.healthImpl.addToServer(this.server);
    }

    /**
     * Add a service implementation to the server
     */
    public addService(service: grpc.ServiceDefinition, implementation: grpc.UntypedServiceImplementation): void {
        this.server.addService(service, implementation);
    }

    /**
     * Start the server and output handshake information for go-plugin
     */
    public serve(): Promise<void> {
        const address = this.network + "://" + this.socketPath;

        return new Promise<void>((resolve, reject) => {
            this.server.bindAsync(
                address,
                grpc.ServerCredentials.createInsecure(),
                (error, port) => {
                    if (error) {
                        reject(error);
                        return;
                    }

                    // Output the handshake information for go-plugin
                    // Format: VERSION|PROTOCOL_VERSION|NETWORK|ADDRESS|PROTOCOL
                    const logEntry = "1|1|" +this.network + "|" + this.socketPath + "|grpc
                    console.log(logEntry);

                    resolve();
                }
            );
        });
    }
}
`

const pluginTs = `#!/usr/bin/env bun

import * as grpc from '@grpc/grpc-js';
import { PluginServer } from '../lib/router-plugin';

// Import generated gRPC code
import { 
  {serviceName}Service, 
  I{serviceName}Server 
} from '../generated/service_grpc_pb';
import { 
  QueryHel\`lo\`Request, 
  QueryHelloResponse, 
  World 
} from '../generated/service_pb';

// Counter for generating unique IDs
let counter = 0;

// Define the service implementation using the generated types
const {serviceName}Implementation: I{serviceName}Server = {
  queryHello: (call: grpc.ServerUnaryCall<QueryHelloRequest, QueryHelloResponse>, callback: grpc.sendUnaryData<QueryHelloResponse>) => {
    const name = call.request.getName();

    counter += 1;

    const world = new World();
    world.setId(\`world-\`+counter);
    world.setName(\`Hello from {serviceName} plugin! \`+ name);

    const response = new QueryHelloResponse();
    response.setHello(world);

    callback(null, response);
  }
};

function run() {
  // Create the plugin server (health check automatically initialized)
  const pluginServer = new PluginServer();
  
  // Add the {serviceName} service
  pluginServer.addService({serviceName}Service, {serviceName}Implementation);

  // Start the server
  pluginServer.serve().catch((error) => {
    process.exit(1);
  });
}

run();
`

const packageJson = `
{
  "name": "awesome-plugin-bun",
  "version": "1.0.0",
  "description": "Awesome gRPC Plugin using Bun runtime",
  "type": "module",
  "scripts": {
    "build": "bun build src/plugin.ts --compile --outfile dist/plugin",
    "dev": "bun run src/plugin.ts",
    "client": "bun run src/client.ts"
  },
  "dependencies": {
    "@grpc/grpc-js": "^1.14.0",
    "@wundergraph/cosmo-router-plugin": "^0.0.1",
    "google-protobuf": "^4.0.0",
    "grpc-health-check": "^2.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/node": "^20.11.5",
    "grpc-tools": "^1.12.4",
    "grpc_tools_node_protoc_ts": "^5.3.3"
  }
}
`

const dockerfileTs = `
FROM --platform=$BUILDPLATFORM oven/bun:1.3.0-alpine AS builder

# Multi-platform build arguments
ARG TARGETOS
ARG TARGETARCH

WORKDIR /build

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install

# Copy all source code
COPY src/ ./src/
COPY generated/ ./generated/

# Set BUN_TARGET based on OS and architecture
ARG TARGETOS
ARG TARGETARCH

RUN BUN_TARGET="bun-\${TARGETOS}-$([ "$TARGETARCH" = "amd64" ] && echo "x64" || echo "$TARGETARCH")" && \\
    echo "Building for $BUN_TARGET" && \\
    bun build src/plugin.ts --compile --outfile bin/plugin --target=$BUN_TARGET

FROM --platform=$BUILDPLATFORM scratch

COPY --from=builder /build/bin/plugin ./student-plugin

ENTRYPOINT ["./student-plugin"]
`

export default {
    pluginServerTs,
    pluginTs,
    packageJson,
    dockerfileTs,
}