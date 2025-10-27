import * as grpc from '@grpc/grpc-js';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Simple health check service implementation compatible with Bun
 */
class SimpleHealthCheck {
    private statuses: Map<string, number> = new Map();

    constructor() {
        // Default to serving
        this.setStatus('', 1); // SERVING = 1
    }

    setStatus(service: string, status: number): void {
        this.statuses.set(service, status);
    }

    check(call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>): void {
        const service = call.request.service || '';
        const status = this.statuses.get(service) ?? 1; // Default to SERVING

        callback(null, { status });
    }

    watch(call: grpc.ServerWritableStream<any, any>): void {
        const service = call.request.service || '';
        const status = this.statuses.get(service) ?? 1;

        call.write({ status });
    }

    addToServer(server: grpc.Server): void {
        const healthCheckService = {
            check: {
                path: '/grpc.health.v1.Health/Check',
                requestStream: false,
                responseStream: false,
                requestSerialize: (value: any) => Buffer.from(JSON.stringify(value)),
                requestDeserialize: (value: Buffer) => JSON.parse(value.toString()),
                responseSerialize: (value: any) => Buffer.from(JSON.stringify(value)),
                responseDeserialize: (value: Buffer) => JSON.parse(value.toString()),
            },
            watch: {
                path: '/grpc.health.v1.Health/Watch',
                requestStream: false,
                responseStream: true,
                requestSerialize: (value: any) => Buffer.from(JSON.stringify(value)),
                requestDeserialize: (value: Buffer) => JSON.parse(value.toString()),
                responseSerialize: (value: any) => Buffer.from(JSON.stringify(value)),
                responseDeserialize: (value: Buffer) => JSON.parse(value.toString()),
            },
        };

        server.addService(healthCheckService as any, {
            check: this.check.bind(this),
            watch: this.watch.bind(this),
        });
    }
}

/**
 * Plugin server that manages gRPC server with Unix domain socket
 */
export class PluginServer {
    private readonly socketPath: string;
    private readonly network: string = 'unix';

    private server: grpc.Server;
    private healthImpl: SimpleHealthCheck;

    constructor(socketDir: string = os.tmpdir()) {
        // Generate a unique temporary file path
        const tempPath = path.join(socketDir, `plugin_${Date.now()}${Math.floor(Math.random() * 1000000)}`);
        this.socketPath = tempPath;

        // Ensure the socket file doesn't exist
        if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
        }

        // Create the gRPC server
        this.server = new grpc.Server();

        // Initialize health check service with overall server status and plugin service
        this.healthImpl = new SimpleHealthCheck();
        this.healthImpl.setStatus('plugin', 1); // SERVING = 1
        this.healthImpl.addToServer(this.server);
    }

    /**
     * Add a service implementation to the server
     */
    public addService(service: grpc.ServiceDefinition, implementation: grpc.UntypedServiceImplementation): void {
        this.server.addService(service, implementation);
    }

    /**
     * Start the server and output handshake information for go-plugin
     */
    public serve(): Promise<void> {
        const address = `${this.network}://${this.socketPath}`;

        return new Promise<void>((resolve, reject) => {
            this.server.bindAsync(
                address,
                grpc.ServerCredentials.createInsecure(),
                (error, port) => {
                    if (error) {
                        reject(error);
                        return;
                    }

                    // Output the handshake information for go-plugin
                    // Format: VERSION|PROTOCOL_VERSION|NETWORK|ADDRESS|PROTOCOL
                    console.log(`1|1|${this.network}|${this.socketPath}|grpc`);

                    resolve();
                }
            );
        });
    }
}

