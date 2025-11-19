import * as grpc from '@grpc/grpc-js';

// Import generated gRPC code
import { 
  Awes17ServiceService, 
  IAwes17ServiceServer 
} from '../generated/service_grpc_pb.js';
import { 
  QueryHelloRequest, 
  QueryHelloResponse, 
  World 
} from '../generated/service_pb.js';
import { PluginServer } from './plugin-server.js';

// Thread-safe counter for generating unique IDs using atomics
const counterBuffer = new SharedArrayBuffer(4);
const counterArray = new Int32Array(counterBuffer);
Atomics.store(counterArray, 0, 0); // Initialize counter to 0

// Define the service implementation using the generated types
const Awes17ServiceImplementation: IAwes17ServiceServer = {
  queryHello: (call: grpc.ServerUnaryCall<QueryHelloRequest, QueryHelloResponse>, callback: grpc.sendUnaryData<QueryHelloResponse>) => {
    const name = call.request.getName();

    const currentCounter = Atomics.add(counterArray, 0, 1) + 1;

    const world = new World();
    world.setId(`world-`+currentCounter);
    world.setName(`Hello from Awes17Service plugin! `+ name);

    const response = new QueryHelloResponse();
    response.setHello(world);

    callback(null, response);
  }
};

function run() {
  // Create the plugin server (health check automatically initialized)
  const pluginServer = new PluginServer();
  
  // Add the Awes17Service service
  pluginServer.addService(Awes17ServiceService, Awes17ServiceImplementation);

  // Start the server
  pluginServer.serve().catch((error) => {
    console.error('Failed to start plugin server:', error);
    process.exit(1);
  });
}

run();
