// package: service
// file: service.proto

/* tslint:disable */
/* eslint-disable */

import * as grpc from "@grpc/grpc-js";
import * as service_pb from "./service_pb";

interface ICoursesServiceService extends grpc.ServiceDefinition<grpc.UntypedServiceImplementation> {
    queryHello: ICoursesServiceService_IQueryHello;
}

interface ICoursesServiceService_IQueryHello extends grpc.MethodDefinition<service_pb.QueryHelloRequest, service_pb.QueryHelloResponse> {
    path: "/service.CoursesService/QueryHello";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<service_pb.QueryHelloRequest>;
    requestDeserialize: grpc.deserialize<service_pb.QueryHelloRequest>;
    responseSerialize: grpc.serialize<service_pb.QueryHelloResponse>;
    responseDeserialize: grpc.deserialize<service_pb.QueryHelloResponse>;
}

export const CoursesServiceService: ICoursesServiceService;

export interface ICoursesServiceServer extends grpc.UntypedServiceImplementation {
    queryHello: grpc.handleUnaryCall<service_pb.QueryHelloRequest, service_pb.QueryHelloResponse>;
}

export interface ICoursesServiceClient {
    queryHello(request: service_pb.QueryHelloRequest, callback: (error: grpc.ServiceError | null, response: service_pb.QueryHelloResponse) => void): grpc.ClientUnaryCall;
    queryHello(request: service_pb.QueryHelloRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.QueryHelloResponse) => void): grpc.ClientUnaryCall;
    queryHello(request: service_pb.QueryHelloRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.QueryHelloResponse) => void): grpc.ClientUnaryCall;
}

export class CoursesServiceClient extends grpc.Client implements ICoursesServiceClient {
    constructor(address: string, credentials: grpc.ChannelCredentials, options?: Partial<grpc.ClientOptions>);
    public queryHello(request: service_pb.QueryHelloRequest, callback: (error: grpc.ServiceError | null, response: service_pb.QueryHelloResponse) => void): grpc.ClientUnaryCall;
    public queryHello(request: service_pb.QueryHelloRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.QueryHelloResponse) => void): grpc.ClientUnaryCall;
    public queryHello(request: service_pb.QueryHelloRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.QueryHelloResponse) => void): grpc.ClientUnaryCall;
}
