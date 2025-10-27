// GENERATED CODE -- DO NOT EDIT!

'use strict';
var grpc = require('@grpc/grpc-js');
var service_pb = require('./service_pb.js');

function serialize_service_QueryHello2Request(arg) {
  if (!(arg instanceof service_pb.QueryHello2Request)) {
    throw new Error('Expected argument of type service.QueryHello2Request');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_QueryHello2Request(buffer_arg) {
  return service_pb.QueryHello2Request.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_service_QueryHello2Response(arg) {
  if (!(arg instanceof service_pb.QueryHello2Response)) {
    throw new Error('Expected argument of type service.QueryHello2Response');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_QueryHello2Response(buffer_arg) {
  return service_pb.QueryHello2Response.deserializeBinary(new Uint8Array(buffer_arg));
}


// Service definition for StudentService
var StudentServiceService = exports.StudentServiceService = {
  // The hello query
queryHello2: {
    path: '/service.StudentService/QueryHello2',
    requestStream: false,
    responseStream: false,
    requestType: service_pb.QueryHello2Request,
    responseType: service_pb.QueryHello2Response,
    requestSerialize: serialize_service_QueryHello2Request,
    requestDeserialize: deserialize_service_QueryHello2Request,
    responseSerialize: serialize_service_QueryHello2Response,
    responseDeserialize: deserialize_service_QueryHello2Response,
  },
};

exports.StudentServiceClient = grpc.makeGenericClientConstructor(StudentServiceService, 'StudentService');
