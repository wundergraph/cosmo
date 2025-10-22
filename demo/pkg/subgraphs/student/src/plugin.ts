#!/usr/bin/env bun

import * as grpc from '@grpc/grpc-js';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { UnixSocketListener } from './unixsocket';

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

// Counter for generating unique IDs
let counter = 0;

// Define the service implementation using the generated types
const StudentServiceImplementation: IStudentServiceServer = {
  queryHello: (call: grpc.ServerUnaryCall<QueryHelloRequest, QueryHelloResponse>, callback: grpc.sendUnaryData<QueryHelloResponse>) => {
    const name = call.request.getName();

    counter += 1;

    const world = new World();
    world.setId(`world-`+counter);
    world.setName(`Hello There 7, `+ name);

    const response = new QueryHelloResponse();
    response.setHello(world);

    callback(null, response);
  }
};

async function serve() {
  // Create the server
  const server = new grpc.Server();

  server.addService(StudentServiceService, StudentServiceImplementation);

  // Create Unix socket listener to get a unique socket path
  const socketListener = new UnixSocketListener();
  const socketPath = socketListener.address();
  const address = `${socketListener.network()}://${socketPath}`;

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
          console.log(`1|1|${socketListener.network()}|${socketPath}|grpc|`);

          resolve();
        }
    );
  });
}

// Start the server
serve().catch((error) => {
  process.exit(1);
});


