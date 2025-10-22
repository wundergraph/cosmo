#!/usr/bin/env bun

import * as grpc from '@grpc/grpc-js';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Import generated gRPC code
import { 
  StudentServiceService, 
  IStudentServiceServer 
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
const StudentServiceImplementation: IStudentServiceServer = {
  queryHello: (call: grpc.ServerUnaryCall<QueryHelloRequest, QueryHelloResponse>, callback: grpc.sendUnaryData<QueryHelloResponse>) => {
    const name = call.request.getName();

    counter += 1;

    const world = new World();
    world.setId(`world-`+counter);
    world.setName(`Hello Thereeeee 17 17 17 17 17 17 17 17 1777 `+ name);

    const response = new QueryHelloResponse();
    response.setHello(world);

    logger.info("Returning world: id="+world.getId()+", name="+world.getName()+", counter="+counter);
    callback(null, response);
  }
};

async function serve() {
  // Create the server
  const server = new grpc.Server();

  // Add the StudentService using generated service definition
  server.addService(StudentServiceService, StudentServiceImplementation);

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
  logger.error(`Failed to start serverL `+ error.message);
  process.exit(1);
});
