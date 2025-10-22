#!/usr/bin/env bun

import * as grpc from '@grpc/grpc-js';

// Import generated gRPC code
import { StudentServiceClient } from '../generated/service_grpc_pb';
import { QueryHelloRequest } from '../generated/service_pb';

async function run() {
  // Create a client using the generated client class
  const client = new StudentServiceClient(
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
      console.log(`Awesome client received`);
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
