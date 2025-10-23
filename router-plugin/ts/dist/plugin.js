import * as grpc from '@grpc/grpc-js';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { HealthImplementation } from 'grpc-health-check';
/**
 * Plugin server that manages gRPC server with Unix domain socket
 */
export class PluginServer {
    socketPath;
    network = 'unix';
    server;
    healthImpl;
    constructor(socketDir = os.tmpdir()) {
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
        this.healthImpl = new HealthImplementation();
        this.healthImpl.setStatus('plugin', 'SERVING');
        this.healthImpl.addToServer(this.server);
    }
    /**
     * Add a service implementation to the server
     */
    addService(service, implementation) {
        this.server.addService(service, implementation);
    }
    /**
     * Start the server and output handshake information for go-plugin
     */
    serve() {
        const address = `${this.network}://${this.socketPath}`;
        return new Promise((resolve, reject) => {
            this.server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (error, port) => {
                if (error) {
                    reject(error);
                    return;
                }
                // Output the handshake information for go-plugin
                // Format: VERSION|PROTOCOL_VERSION|NETWORK|ADDRESS|PROTOCOL
                console.log(`1|1|${this.network}|${this.socketPath}|grpc`);
                resolve();
            });
        });
    }
}
//# sourceMappingURL=plugin.js.map