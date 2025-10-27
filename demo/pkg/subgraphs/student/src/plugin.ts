#!/usr/bin/env bun

import * as grpc from '@grpc/grpc-js';
import { PluginServer } from 'router-plugin-ts';

// Import generated gRPC code
import { 
  StudentServiceService, 
  IStudentServiceServer 
} from '../generated/service_grpc_pb';
import { 
  QueryHello2Request,
  QueryHello2Response,
  World 
} from '../generated/service_pb';

// Counter for generating unique IDs
let counter = 0;

// Define the service implementation using the generated types
const StudentServiceImplementation: IStudentServiceServer = {
  queryHello2: (call: grpc.ServerUnaryCall<QueryHello2Request, QueryHello2Response>, callback: grpc.sendUnaryData<QueryHello2Response>) => {
    const name = call.request.getName();

    counter += 1;

    const world = new World();
    world.setId(`world-`+counter);
    world.setName(`Hello Awesome aeqwerqwe7, `+ name);

    const response = new QueryHello2Response();
    response.setHello2(world);

    callback(null, response);
  }
};

function run() {
  // Create the plugin server (health check automatically initialized)
  const pluginServer = new PluginServer();
  
  // Add the student service
  pluginServer.addService(StudentServiceService, StudentServiceImplementation);

  // Start the server
  pluginServer.serve().catch((error) => {
    process.exit(1);
  });
}

run();

