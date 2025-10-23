import * as grpc from '@grpc/grpc-js';
/**
 * Plugin server that manages gRPC server with Unix domain socket
 */
export declare class PluginServer {
    private readonly socketPath;
    private readonly network;
    private server;
    private healthImpl;
    constructor(socketDir?: string);
    /**
     * Add a service implementation to the server
     */
    addService(service: grpc.ServiceDefinition, implementation: grpc.UntypedServiceImplementation): void;
    /**
     * Start the server and output handshake information for go-plugin
     */
    serve(): Promise<void>;
}
