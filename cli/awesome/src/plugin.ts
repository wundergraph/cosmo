import * as grpc from '@grpc/grpc-js';
import { PluginServer } from './plugin-server';

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

// Counter for generating unique IDs
let counter = 0;

// Define the service implementation using the generated types
const AwesomeServiceImplementation: IAwesomeServiceServer = {
  queryHello: (call: grpc.ServerUnaryCall<QueryHelloRequest, QueryHelloResponse>, callback: grpc.sendUnaryData<QueryHelloResponse>) => {
    const name = call.request.getName();

    counter += 1;

    const world = new World();
    world.setId(`world-`+counter);
    world.setName(`Hello from AwesomeService plugin! `+ name);

    const response = new QueryHelloResponse();
    response.setHello(world);

    callback(null, response);
  }
};

function run() {
  // Create the plugin server (health check automatically initialized)
  const pluginServer = new PluginServer();
  
  // Add the AwesomeService service
  pluginServer.addService(AwesomeServiceService, AwesomeServiceImplementation);

  // Start the server
  pluginServer.serve().catch((error) => {
    process.exit(1);
  });
}

run();

