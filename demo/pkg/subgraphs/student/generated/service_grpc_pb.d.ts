// package: service
// file: service.proto

/* tslint:disable */
/* eslint-disable */

import * as grpc from "@grpc/grpc-js";
import * as service_pb from "./service_pb";

interface IStudentServiceService extends grpc.ServiceDefinition<grpc.UntypedServiceImplementation> {
    queryHello2: IStudentServiceService_IQueryHello2;
}

interface IStudentServiceService_IQueryHello2 extends grpc.MethodDefinition<service_pb.QueryHello2Request, service_pb.QueryHello2Response> {
    path: "/service.StudentService/QueryHello2";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<service_pb.QueryHello2Request>;
    requestDeserialize: grpc.deserialize<service_pb.QueryHello2Request>;
    responseSerialize: grpc.serialize<service_pb.QueryHello2Response>;
    responseDeserialize: grpc.deserialize<service_pb.QueryHello2Response>;
}

export const StudentServiceService: IStudentServiceService;

export interface IStudentServiceServer extends grpc.UntypedServiceImplementation {
    queryHello2: grpc.handleUnaryCall<service_pb.QueryHello2Request, service_pb.QueryHello2Response>;
}

export interface IStudentServiceClient {
    queryHello2(request: service_pb.QueryHello2Request, callback: (error: grpc.ServiceError | null, response: service_pb.QueryHello2Response) => void): grpc.ClientUnaryCall;
    queryHello2(request: service_pb.QueryHello2Request, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.QueryHello2Response) => void): grpc.ClientUnaryCall;
    queryHello2(request: service_pb.QueryHello2Request, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.QueryHello2Response) => void): grpc.ClientUnaryCall;
}

export class StudentServiceClient extends grpc.Client implements IStudentServiceClient {
    constructor(address: string, credentials: grpc.ChannelCredentials, options?: Partial<grpc.ClientOptions>);
    public queryHello2(request: service_pb.QueryHello2Request, callback: (error: grpc.ServiceError | null, response: service_pb.QueryHello2Response) => void): grpc.ClientUnaryCall;
    public queryHello2(request: service_pb.QueryHello2Request, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: service_pb.QueryHello2Response) => void): grpc.ClientUnaryCall;
    public queryHello2(request: service_pb.QueryHello2Request, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: service_pb.QueryHello2Response) => void): grpc.ClientUnaryCall;
}
