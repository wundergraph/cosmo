// GENERATED CODE -- DO NOT EDIT!

'use strict';
var grpc = require('@grpc/grpc-js');
var service_pb = require('./service_pb.js');

function serialize_service_QueryHelloRequest(arg) {
  if (!(arg instanceof service_pb.QueryHelloRequest)) {
    throw new Error('Expected argument of type service.QueryHelloRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_QueryHelloRequest(buffer_arg) {
  return service_pb.QueryHelloRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_service_QueryHelloResponse(arg) {
  if (!(arg instanceof service_pb.QueryHelloResponse)) {
    throw new Error('Expected argument of type service.QueryHelloResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_QueryHelloResponse(buffer_arg) {
  return service_pb.QueryHelloResponse.deserializeBinary(new Uint8Array(buffer_arg));
}


// Service definition for AwesomeService
var AwesomeServiceService = exports.AwesomeServiceService = {
  // The hello query
queryHello: {
    path: '/service.AwesomeService/QueryHello',
    requestStream: false,
    responseStream: false,
    requestType: service_pb.QueryHelloRequest,
    responseType: service_pb.QueryHelloResponse,
    requestSerialize: serialize_service_QueryHelloRequest,
    requestDeserialize: deserialize_service_QueryHelloRequest,
    responseSerialize: serialize_service_QueryHelloResponse,
    responseDeserialize: deserialize_service_QueryHelloResponse,
  },
};

exports.AwesomeServiceClient = grpc.makeGenericClientConstructor(AwesomeServiceService, 'AwesomeService');
