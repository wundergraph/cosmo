#!/usr/bin/env bun

import * as grpc from '@grpc/grpc-js';
import { PluginServer } from './unixsocket';

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

function run() {
  // Create the plugin server and add service
  const pluginServer = new PluginServer();
  pluginServer.addService(StudentServiceService, StudentServiceImplementation);

  // Start the server
  pluginServer.serve().catch((error) => {
    process.exit(1);
  });
}

run();

