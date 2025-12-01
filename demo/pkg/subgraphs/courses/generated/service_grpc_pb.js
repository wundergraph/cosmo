// GENERATED CODE -- DO NOT EDIT!

'use strict';
var grpc = require('@grpc/grpc-js');
var service_pb = require('./service_pb.js');
var google_protobuf_wrappers_pb = require('google-protobuf/google/protobuf/wrappers_pb.js');

function serialize_service_LookupEmployeeByIdRequest(arg) {
  if (!(arg instanceof service_pb.LookupEmployeeByIdRequest)) {
    throw new Error('Expected argument of type service.LookupEmployeeByIdRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_LookupEmployeeByIdRequest(buffer_arg) {
  return service_pb.LookupEmployeeByIdRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_service_LookupEmployeeByIdResponse(arg) {
  if (!(arg instanceof service_pb.LookupEmployeeByIdResponse)) {
    throw new Error('Expected argument of type service.LookupEmployeeByIdResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_LookupEmployeeByIdResponse(buffer_arg) {
  return service_pb.LookupEmployeeByIdResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_service_MutationAddCourseRequest(arg) {
  if (!(arg instanceof service_pb.MutationAddCourseRequest)) {
    throw new Error('Expected argument of type service.MutationAddCourseRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_MutationAddCourseRequest(buffer_arg) {
  return service_pb.MutationAddCourseRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_service_MutationAddCourseResponse(arg) {
  if (!(arg instanceof service_pb.MutationAddCourseResponse)) {
    throw new Error('Expected argument of type service.MutationAddCourseResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_MutationAddCourseResponse(buffer_arg) {
  return service_pb.MutationAddCourseResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_service_MutationAddLessonRequest(arg) {
  if (!(arg instanceof service_pb.MutationAddLessonRequest)) {
    throw new Error('Expected argument of type service.MutationAddLessonRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_MutationAddLessonRequest(buffer_arg) {
  return service_pb.MutationAddLessonRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_service_MutationAddLessonResponse(arg) {
  if (!(arg instanceof service_pb.MutationAddLessonResponse)) {
    throw new Error('Expected argument of type service.MutationAddLessonResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_MutationAddLessonResponse(buffer_arg) {
  return service_pb.MutationAddLessonResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_service_QueryCourseRequest(arg) {
  if (!(arg instanceof service_pb.QueryCourseRequest)) {
    throw new Error('Expected argument of type service.QueryCourseRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_QueryCourseRequest(buffer_arg) {
  return service_pb.QueryCourseRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_service_QueryCourseResponse(arg) {
  if (!(arg instanceof service_pb.QueryCourseResponse)) {
    throw new Error('Expected argument of type service.QueryCourseResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_QueryCourseResponse(buffer_arg) {
  return service_pb.QueryCourseResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_service_QueryCoursesRequest(arg) {
  if (!(arg instanceof service_pb.QueryCoursesRequest)) {
    throw new Error('Expected argument of type service.QueryCoursesRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_QueryCoursesRequest(buffer_arg) {
  return service_pb.QueryCoursesRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_service_QueryCoursesResponse(arg) {
  if (!(arg instanceof service_pb.QueryCoursesResponse)) {
    throw new Error('Expected argument of type service.QueryCoursesResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_QueryCoursesResponse(buffer_arg) {
  return service_pb.QueryCoursesResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_service_QueryKillCoursesServiceRequest(arg) {
  if (!(arg instanceof service_pb.QueryKillCoursesServiceRequest)) {
    throw new Error('Expected argument of type service.QueryKillCoursesServiceRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_QueryKillCoursesServiceRequest(buffer_arg) {
  return service_pb.QueryKillCoursesServiceRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_service_QueryKillCoursesServiceResponse(arg) {
  if (!(arg instanceof service_pb.QueryKillCoursesServiceResponse)) {
    throw new Error('Expected argument of type service.QueryKillCoursesServiceResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_QueryKillCoursesServiceResponse(buffer_arg) {
  return service_pb.QueryKillCoursesServiceResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_service_QueryLessonsRequest(arg) {
  if (!(arg instanceof service_pb.QueryLessonsRequest)) {
    throw new Error('Expected argument of type service.QueryLessonsRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_QueryLessonsRequest(buffer_arg) {
  return service_pb.QueryLessonsRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_service_QueryLessonsResponse(arg) {
  if (!(arg instanceof service_pb.QueryLessonsResponse)) {
    throw new Error('Expected argument of type service.QueryLessonsResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_QueryLessonsResponse(buffer_arg) {
  return service_pb.QueryLessonsResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_service_QueryThrowErrorCoursesRequest(arg) {
  if (!(arg instanceof service_pb.QueryThrowErrorCoursesRequest)) {
    throw new Error('Expected argument of type service.QueryThrowErrorCoursesRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_QueryThrowErrorCoursesRequest(buffer_arg) {
  return service_pb.QueryThrowErrorCoursesRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_service_QueryThrowErrorCoursesResponse(arg) {
  if (!(arg instanceof service_pb.QueryThrowErrorCoursesResponse)) {
    throw new Error('Expected argument of type service.QueryThrowErrorCoursesResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_service_QueryThrowErrorCoursesResponse(buffer_arg) {
  return service_pb.QueryThrowErrorCoursesResponse.deserializeBinary(new Uint8Array(buffer_arg));
}


// Service definition for CoursesService
var CoursesServiceService = exports.CoursesServiceService = {
  // Lookup Employee entity by id
lookupEmployeeById: {
    path: '/service.CoursesService/LookupEmployeeById',
    requestStream: false,
    responseStream: false,
    requestType: service_pb.LookupEmployeeByIdRequest,
    responseType: service_pb.LookupEmployeeByIdResponse,
    requestSerialize: serialize_service_LookupEmployeeByIdRequest,
    requestDeserialize: deserialize_service_LookupEmployeeByIdRequest,
    responseSerialize: serialize_service_LookupEmployeeByIdResponse,
    responseDeserialize: deserialize_service_LookupEmployeeByIdResponse,
  },
  mutationAddCourse: {
    path: '/service.CoursesService/MutationAddCourse',
    requestStream: false,
    responseStream: false,
    requestType: service_pb.MutationAddCourseRequest,
    responseType: service_pb.MutationAddCourseResponse,
    requestSerialize: serialize_service_MutationAddCourseRequest,
    requestDeserialize: deserialize_service_MutationAddCourseRequest,
    responseSerialize: serialize_service_MutationAddCourseResponse,
    responseDeserialize: deserialize_service_MutationAddCourseResponse,
  },
  mutationAddLesson: {
    path: '/service.CoursesService/MutationAddLesson',
    requestStream: false,
    responseStream: false,
    requestType: service_pb.MutationAddLessonRequest,
    responseType: service_pb.MutationAddLessonResponse,
    requestSerialize: serialize_service_MutationAddLessonRequest,
    requestDeserialize: deserialize_service_MutationAddLessonRequest,
    responseSerialize: serialize_service_MutationAddLessonResponse,
    responseDeserialize: deserialize_service_MutationAddLessonResponse,
  },
  queryCourse: {
    path: '/service.CoursesService/QueryCourse',
    requestStream: false,
    responseStream: false,
    requestType: service_pb.QueryCourseRequest,
    responseType: service_pb.QueryCourseResponse,
    requestSerialize: serialize_service_QueryCourseRequest,
    requestDeserialize: deserialize_service_QueryCourseRequest,
    responseSerialize: serialize_service_QueryCourseResponse,
    responseDeserialize: deserialize_service_QueryCourseResponse,
  },
  queryCourses: {
    path: '/service.CoursesService/QueryCourses',
    requestStream: false,
    responseStream: false,
    requestType: service_pb.QueryCoursesRequest,
    responseType: service_pb.QueryCoursesResponse,
    requestSerialize: serialize_service_QueryCoursesRequest,
    requestDeserialize: deserialize_service_QueryCoursesRequest,
    responseSerialize: serialize_service_QueryCoursesResponse,
    responseDeserialize: deserialize_service_QueryCoursesResponse,
  },
  queryKillCoursesService: {
    path: '/service.CoursesService/QueryKillCoursesService',
    requestStream: false,
    responseStream: false,
    requestType: service_pb.QueryKillCoursesServiceRequest,
    responseType: service_pb.QueryKillCoursesServiceResponse,
    requestSerialize: serialize_service_QueryKillCoursesServiceRequest,
    requestDeserialize: deserialize_service_QueryKillCoursesServiceRequest,
    responseSerialize: serialize_service_QueryKillCoursesServiceResponse,
    responseDeserialize: deserialize_service_QueryKillCoursesServiceResponse,
  },
  queryLessons: {
    path: '/service.CoursesService/QueryLessons',
    requestStream: false,
    responseStream: false,
    requestType: service_pb.QueryLessonsRequest,
    responseType: service_pb.QueryLessonsResponse,
    requestSerialize: serialize_service_QueryLessonsRequest,
    requestDeserialize: deserialize_service_QueryLessonsRequest,
    responseSerialize: serialize_service_QueryLessonsResponse,
    responseDeserialize: deserialize_service_QueryLessonsResponse,
  },
  queryThrowErrorCourses: {
    path: '/service.CoursesService/QueryThrowErrorCourses',
    requestStream: false,
    responseStream: false,
    requestType: service_pb.QueryThrowErrorCoursesRequest,
    responseType: service_pb.QueryThrowErrorCoursesResponse,
    requestSerialize: serialize_service_QueryThrowErrorCoursesRequest,
    requestDeserialize: deserialize_service_QueryThrowErrorCoursesRequest,
    responseSerialize: serialize_service_QueryThrowErrorCoursesResponse,
    responseDeserialize: deserialize_service_QueryThrowErrorCoursesResponse,
  },
};

exports.CoursesServiceClient = grpc.makeGenericClientConstructor(CoursesServiceService, 'CoursesService');
