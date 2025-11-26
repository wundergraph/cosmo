// package: service
// file: service.proto

/* tslint:disable */
/* eslint-disable */

import * as grpc from "@grpc/grpc-js";
import * as service_pb from "./service_pb";
import * as google_protobuf_wrappers_pb from "google-protobuf/google/protobuf/wrappers_pb";

interface ICoursesServiceService extends grpc.ServiceDefinition<grpc.UntypedServiceImplementation> {
    lookupEmployeeById: ICoursesServiceService_ILookupEmployeeById;
    mutationAddCourse: ICoursesServiceService_IMutationAddCourse;
    mutationAddLesson: ICoursesServiceService_IMutationAddLesson;
    queryCourse: ICoursesServiceService_IQueryCourse;
    queryCourses: ICoursesServiceService_IQueryCourses;
    queryKillCoursesService: ICoursesServiceService_IQueryKillCoursesService;
    queryLessons: ICoursesServiceService_IQueryLessons;
    queryThrowErrorCourses: ICoursesServiceService_IQueryThrowErrorCourses;
}

interface ICoursesServiceService_ILookupEmployeeById extends grpc.MethodDefinition<service_pb.LookupEmployeeByIdRequest, service_pb.LookupEmployeeByIdResponse> {
    path: "/service.CoursesService/LookupEmployeeById";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<service_pb.LookupEmployeeByIdRequest>;
    requestDeserialize: grpc.deserialize<service_pb.LookupEmployeeByIdRequest>;
    responseSerialize: grpc.serialize<service_pb.LookupEmployeeByIdResponse>;
    responseDeserialize: grpc.deserialize<service_pb.LookupEmployeeByIdResponse>;
}
interface ICoursesServiceService_IMutationAddCourse extends grpc.MethodDefinition<service_pb.MutationAddCourseRequest, service_pb.MutationAddCourseResponse> {
    path: "/service.CoursesService/MutationAddCourse";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<service_pb.MutationAddCourseRequest>;
    requestDeserialize: grpc.deserialize<service_pb.MutationAddCourseRequest>;
    responseSerialize: grpc.serialize<service_pb.MutationAddCourseResponse>;
    responseDeserialize: grpc.deserialize<service_pb.MutationAddCourseResponse>;
}
interface ICoursesServiceService_IMutationAddLesson extends grpc.MethodDefinition<service_pb.MutationAddLessonRequest, service_pb.MutationAddLessonResponse> {
    path: "/service.CoursesService/MutationAddLesson";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<service_pb.MutationAddLessonRequest>;
    requestDeserialize: grpc.deserialize<service_pb.MutationAddLessonRequest>;
    responseSerialize: grpc.serialize<service_pb.MutationAddLessonResponse>;
    responseDeserialize: grpc.deserialize<service_pb.MutationAddLessonResponse>;
}
interface ICoursesServiceService_IQueryCourse extends grpc.MethodDefinition<service_pb.QueryCourseRequest, service_pb.QueryCourseResponse> {
    path: "/service.CoursesService/QueryCourse";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<service_pb.QueryCourseRequest>;
    requestDeserialize: grpc.deserialize<service_pb.QueryCourseRequest>;
    responseSerialize: grpc.serialize<service_pb.QueryCourseResponse>;
    responseDeserialize: grpc.deserialize<service_pb.QueryCourseResponse>;
}
interface ICoursesServiceService_IQueryCourses extends grpc.MethodDefinition<service_pb.QueryCoursesRequest, service_pb.QueryCoursesResponse> {
    path: "/service.CoursesService/QueryCourses";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<service_pb.QueryCoursesRequest>;
    requestDeserialize: grpc.deserialize<service_pb.QueryCoursesRequest>;
    responseSerialize: grpc.serialize<service_pb.QueryCoursesResponse>;
    responseDeserialize: grpc.deserialize<service_pb.QueryCoursesResponse>;
}
interface ICoursesServiceService_IQueryKillCoursesService extends grpc.MethodDefinition<service_pb.QueryKillCoursesServiceRequest, service_pb.QueryKillCoursesServiceResponse> {
    path: "/service.CoursesService/QueryKillCoursesService";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<service_pb.QueryKillCoursesServiceRequest>;
    requestDeserialize: grpc.deserialize<service_pb.QueryKillCoursesServiceRequest>;
    responseSerialize: grpc.serialize<service_pb.QueryKillCoursesServiceResponse>;
    responseDeserialize: grpc.deserialize<service_pb.QueryKillCoursesServiceResponse>;
}
interface ICoursesServiceService_IQueryLessons extends grpc.MethodDefinition<service_pb.QueryLessonsRequest, service_pb.QueryLessonsResponse> {
    path: "/service.CoursesService/QueryLessons";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<service_pb.QueryLessonsRequest>;
    requestDeserialize: grpc.deserialize<service_pb.QueryLessonsRequest>;
    responseSerialize: grpc.serialize<service_pb.QueryLessonsResponse>;
    responseDeserialize: grpc.deserialize<service_pb.QueryLessonsResponse>;
}
interface ICoursesServiceService_IQueryThrowErrorCourses extends grpc.MethodDefinition<service_pb.QueryThrowErrorCoursesRequest, service_pb.QueryThrowErrorCoursesResponse> {
    path: "/service.CoursesService/QueryThrowErrorCourses";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<service_pb.QueryThrowErrorCoursesRequest>;
    requestDeserialize: grpc.deserialize<service_pb.QueryThrowErrorCoursesRequest>;
    responseSerialize: grpc.serialize<service_pb.QueryThrowErrorCoursesResponse>;
    responseDeserialize: grpc.deserialize<service_pb.QueryThrowErrorCoursesResponse>;
}

export const CoursesServiceService: ICoursesServiceService;

export interface ICoursesServiceServer extends grpc.UntypedServiceImplementation {
    lookupEmployeeById: grpc.handleUnaryCall<service_pb.LookupEmployeeByIdRequest, service_pb.LookupEmployeeByIdResponse>;
    mutationAddCourse: grpc.handleUnaryCall<service_pb.MutationAddCourseRequest, service_pb.MutationAddCourseResponse>;
    mutationAddLesson: grpc.handleUnaryCall<service_pb.MutationAddLessonRequest, service_pb.MutationAddLessonResponse>;
    queryCourse: grpc.handleUnaryCall<service_pb.QueryCourseRequest, service_pb.QueryCourseResponse>;
    queryCourses: grpc.handleUnaryCall<service_pb.QueryCoursesRequest, service_pb.QueryCoursesResponse>;
    queryKillCoursesService: grpc.handleUnaryCall<service_pb.QueryKillCoursesServiceRequest, service_pb.QueryKillCoursesServiceResponse>;
    queryLessons: grpc.handleUnaryCall<service_pb.QueryLessonsRequest, service_pb.QueryLessonsResponse>;
    queryThrowErrorCourses: grpc.handleUnaryCall<service_pb.QueryThrowErrorCoursesRequest, service_pb.QueryThrowErrorCoursesResponse>;
}

export interface ICoursesServiceClient {
    lookupEmployeeById(request: service_pb.LookupEmployeeByIdRequest, callback: (error: grpc.ServiceError | null, response: service_pb.LookupEmployeeByIdResponse) => void): grpc.ClientUnaryCall;
    lookupEmployeeById(request: service_pb.LookupEmployeeByIdRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.LookupEmployeeByIdResponse) => void): grpc.ClientUnaryCall;
    lookupEmployeeById(request: service_pb.LookupEmployeeByIdRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.LookupEmployeeByIdResponse) => void): grpc.ClientUnaryCall;
    mutationAddCourse(request: service_pb.MutationAddCourseRequest, callback: (error: grpc.ServiceError | null, response: service_pb.MutationAddCourseResponse) => void): grpc.ClientUnaryCall;
    mutationAddCourse(request: service_pb.MutationAddCourseRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.MutationAddCourseResponse) => void): grpc.ClientUnaryCall;
    mutationAddCourse(request: service_pb.MutationAddCourseRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.MutationAddCourseResponse) => void): grpc.ClientUnaryCall;
    mutationAddLesson(request: service_pb.MutationAddLessonRequest, callback: (error: grpc.ServiceError | null, response: service_pb.MutationAddLessonResponse) => void): grpc.ClientUnaryCall;
    mutationAddLesson(request: service_pb.MutationAddLessonRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.MutationAddLessonResponse) => void): grpc.ClientUnaryCall;
    mutationAddLesson(request: service_pb.MutationAddLessonRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.MutationAddLessonResponse) => void): grpc.ClientUnaryCall;
    queryCourse(request: service_pb.QueryCourseRequest, callback: (error: grpc.ServiceError | null, response: service_pb.QueryCourseResponse) => void): grpc.ClientUnaryCall;
    queryCourse(request: service_pb.QueryCourseRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.QueryCourseResponse) => void): grpc.ClientUnaryCall;
    queryCourse(request: service_pb.QueryCourseRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.QueryCourseResponse) => void): grpc.ClientUnaryCall;
    queryCourses(request: service_pb.QueryCoursesRequest, callback: (error: grpc.ServiceError | null, response: service_pb.QueryCoursesResponse) => void): grpc.ClientUnaryCall;
    queryCourses(request: service_pb.QueryCoursesRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.QueryCoursesResponse) => void): grpc.ClientUnaryCall;
    queryCourses(request: service_pb.QueryCoursesRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.QueryCoursesResponse) => void): grpc.ClientUnaryCall;
    queryKillCoursesService(request: service_pb.QueryKillCoursesServiceRequest, callback: (error: grpc.ServiceError | null, response: service_pb.QueryKillCoursesServiceResponse) => void): grpc.ClientUnaryCall;
    queryKillCoursesService(request: service_pb.QueryKillCoursesServiceRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.QueryKillCoursesServiceResponse) => void): grpc.ClientUnaryCall;
    queryKillCoursesService(request: service_pb.QueryKillCoursesServiceRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.QueryKillCoursesServiceResponse) => void): grpc.ClientUnaryCall;
    queryLessons(request: service_pb.QueryLessonsRequest, callback: (error: grpc.ServiceError | null, response: service_pb.QueryLessonsResponse) => void): grpc.ClientUnaryCall;
    queryLessons(request: service_pb.QueryLessonsRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.QueryLessonsResponse) => void): grpc.ClientUnaryCall;
    queryLessons(request: service_pb.QueryLessonsRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.QueryLessonsResponse) => void): grpc.ClientUnaryCall;
    queryThrowErrorCourses(request: service_pb.QueryThrowErrorCoursesRequest, callback: (error: grpc.ServiceError | null, response: service_pb.QueryThrowErrorCoursesResponse) => void): grpc.ClientUnaryCall;
    queryThrowErrorCourses(request: service_pb.QueryThrowErrorCoursesRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.QueryThrowErrorCoursesResponse) => void): grpc.ClientUnaryCall;
    queryThrowErrorCourses(request: service_pb.QueryThrowErrorCoursesRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.QueryThrowErrorCoursesResponse) => void): grpc.ClientUnaryCall;
}

export class CoursesServiceClient extends grpc.Client implements ICoursesServiceClient {
    constructor(address: string, credentials: grpc.ChannelCredentials, options?: Partial<grpc.ClientOptions>);
    public lookupEmployeeById(request: service_pb.LookupEmployeeByIdRequest, callback: (error: grpc.ServiceError | null, response: service_pb.LookupEmployeeByIdResponse) => void): grpc.ClientUnaryCall;
    public lookupEmployeeById(request: service_pb.LookupEmployeeByIdRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.LookupEmployeeByIdResponse) => void): grpc.ClientUnaryCall;
    public lookupEmployeeById(request: service_pb.LookupEmployeeByIdRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.LookupEmployeeByIdResponse) => void): grpc.ClientUnaryCall;
    public mutationAddCourse(request: service_pb.MutationAddCourseRequest, callback: (error: grpc.ServiceError | null, response: service_pb.MutationAddCourseResponse) => void): grpc.ClientUnaryCall;
    public mutationAddCourse(request: service_pb.MutationAddCourseRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.MutationAddCourseResponse) => void): grpc.ClientUnaryCall;
    public mutationAddCourse(request: service_pb.MutationAddCourseRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.MutationAddCourseResponse) => void): grpc.ClientUnaryCall;
    public mutationAddLesson(request: service_pb.MutationAddLessonRequest, callback: (error: grpc.ServiceError | null, response: service_pb.MutationAddLessonResponse) => void): grpc.ClientUnaryCall;
    public mutationAddLesson(request: service_pb.MutationAddLessonRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.MutationAddLessonResponse) => void): grpc.ClientUnaryCall;
    public mutationAddLesson(request: service_pb.MutationAddLessonRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.MutationAddLessonResponse) => void): grpc.ClientUnaryCall;
    public queryCourse(request: service_pb.QueryCourseRequest, callback: (error: grpc.ServiceError | null, response: service_pb.QueryCourseResponse) => void): grpc.ClientUnaryCall;
    public queryCourse(request: service_pb.QueryCourseRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.QueryCourseResponse) => void): grpc.ClientUnaryCall;
    public queryCourse(request: service_pb.QueryCourseRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.QueryCourseResponse) => void): grpc.ClientUnaryCall;
    public queryCourses(request: service_pb.QueryCoursesRequest, callback: (error: grpc.ServiceError | null, response: service_pb.QueryCoursesResponse) => void): grpc.ClientUnaryCall;
    public queryCourses(request: service_pb.QueryCoursesRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.QueryCoursesResponse) => void): grpc.ClientUnaryCall;
    public queryCourses(request: service_pb.QueryCoursesRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.QueryCoursesResponse) => void): grpc.ClientUnaryCall;
    public queryKillCoursesService(request: service_pb.QueryKillCoursesServiceRequest, callback: (error: grpc.ServiceError | null, response: service_pb.QueryKillCoursesServiceResponse) => void): grpc.ClientUnaryCall;
    public queryKillCoursesService(request: service_pb.QueryKillCoursesServiceRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.QueryKillCoursesServiceResponse) => void): grpc.ClientUnaryCall;
    public queryKillCoursesService(request: service_pb.QueryKillCoursesServiceRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.QueryKillCoursesServiceResponse) => void): grpc.ClientUnaryCall;
    public queryLessons(request: service_pb.QueryLessonsRequest, callback: (error: grpc.ServiceError | null, response: service_pb.QueryLessonsResponse) => void): grpc.ClientUnaryCall;
    public queryLessons(request: service_pb.QueryLessonsRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.QueryLessonsResponse) => void): grpc.ClientUnaryCall;
    public queryLessons(request: service_pb.QueryLessonsRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.QueryLessonsResponse) => void): grpc.ClientUnaryCall;
    public queryThrowErrorCourses(request: service_pb.QueryThrowErrorCoursesRequest, callback: (error: grpc.ServiceError | null, response: service_pb.QueryThrowErrorCoursesResponse) => void): grpc.ClientUnaryCall;
    public queryThrowErrorCourses(request: service_pb.QueryThrowErrorCoursesRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.QueryThrowErrorCoursesResponse) => void): grpc.ClientUnaryCall;
    public queryThrowErrorCourses(request: service_pb.QueryThrowErrorCoursesRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.QueryThrowErrorCoursesResponse) => void): grpc.ClientUnaryCall;
}
