
const clientTs = `
#!/usr/bin/env bun

import * as grpc from '@grpc/grpc-js';

// Import generated gRPC code
import { AwesomeServiceClient } from '../generated/service_grpc_pb';
import { QueryHelloRequest } from '../generated/service_pb';

async function run() {
  // Create a client using the generated client class
  const client = new AwesomeServiceClient(
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

const pluginTs = `
#!/usr/bin/env bun

import * as grpc from '@grpc/grpc-js';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Import generated gRPC code
import { 
  AwesomeServiceService, 
  IAwesomeServiceServer 
} from '../generated/service_grpc_pb';
import { 
  QueryHelloRequest, 
  QueryHelloResponse, 
  World 
} from '../generated/service_pb';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const awesomeServiceImplementation: IAwesomeServiceServer = {
  queryHello: (call: grpc.ServerUnaryCall<QueryHelloRequest, QueryHelloResponse>, callback: grpc.sendUnaryData<QueryHelloResponse>) => {
    const name = call.request.getName();

    counter += 1;

    const world = new World();
    world.setId(\`world-\`+counter);
    world.setName(\`Hello Thereeeee 17 17 17 17 17 17 17 17 1777 \`+ name);

    const response = new QueryHelloResponse();
    response.setHello(world);

    logger.info("Returning world: id="+world.getId()+", name="+world.getName()+", counter="+counter);
    callback(null, response);
  }
};

async function serve() {
  // Create the server
  const server = new grpc.Server();

  // Add the AwesomeService using generated service definition
  server.addService(AwesomeServiceService, awesomeServiceImplementation);

  // Bind the server to a port
  const address = '127.0.0.1:1234';
  
  return new Promise<void>((resolve, reject) => {
    server.bindAsync(
      address,
      grpc.ServerCredentials.createInsecure(),
      (error, port) => {
        if (error) {
          reject(error);
          return;
        }

        // Output the handshake information for go-plugin
        // Format: VERSION|PROTOCOL_VERSION|NETWORK|ADDRESS|PROTOCOL
        console.log('1|1|tcp|127.0.0.1:1234|grpc');
        
        resolve();
      }
    );
  });
}

// Start the server
serve().catch((error) => {
  logger.error(\`Failed to start serverL \`+ error.message);
  process.exit(1);
});
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
    "client": "bun run src/client.ts",
    "generate": "grpc_tools_node_protoc --js_out=import_style=commonjs,binary:generated --grpc_out=grpc_js:generated --ts_out=grpc_js:generated -I generated generated/service.proto"
  },
  "dependencies": {
    "@grpc/grpc-js": "^1.10.0",
    "google-protobuf": "^3.21.2"
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