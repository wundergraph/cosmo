
const clientTs = `#!/usr/bin/env bun

import * as grpc from '@grpc/grpc-js';

// Import generated gRPC code
import { {serviceName}Client } from '../generated/service_grpc_pb';
import { QueryHelloRequest } from '../generated/service_pb';

async function run() {
  // Create a client using the generated client class
  const client = new {serviceName}Client(
    'localhost:1234',
    grpc.credentials.createInsecure()
  );

  // Create a request using the generated message class
  const request = new QueryHelloRequest();
  request.setName('World');

  // Make the gRPC call
  client.queryHello(request, (error, response) => {
    if (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }

    const hello = response.getHello();
    if (hello) {
      console.log(\`Awesome client received\`);
    } else {
      console.log('No hello received');
    }
    
    process.exit(0);
  });
}

run().catch((error) => {
  console.error('Failed to run client:', error.message);
  process.exit(1);
});
`

const pluginTs = `#!/usr/bin/env bun

import * as grpc from '@grpc/grpc-js';
import { PluginServer } from '@wundergraph/cosmo-router-plugin';

// Import generated gRPC code
import { 
  {serviceName}Service, 
  I{serviceName}Server 
} from '../generated/service_grpc_pb';
import { 
  QueryHelloRequest, 
  QueryHelloResponse, 
  World 
} from '../generated/service_pb';

// Counter for generating unique IDs
let counter = 0;

// Logger implementation
class Logger {
  log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
  }

  info(message: string): void {
    this.log('INFO', message);
  }

  debug(message: string): void {
    this.log('DEBUG', message);
  }

  error(message: string): void {
    this.log('ERROR', message);
  }
}

const logger = new Logger();

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

    logger.info("Returning world: id="+world.getId()+", name="+world.getName()+", counter="+counter);
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
    logger.error(\`Failed to start server: \`+ error.message);
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

export default {
    clientTs,
    pluginTs,
    packageJson,
}