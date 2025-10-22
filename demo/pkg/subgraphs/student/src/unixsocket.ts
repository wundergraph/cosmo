import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Creates a Unix domain socket listener similar to Go's serverListener_unix
 */
export class UnixSocketListener {
    private server: net.Server;
    private socketPath: string;

    constructor(socketDir: string = os.tmpdir()) {
        // Generate a unique temporary file path
        const tempPath = path.join(socketDir, `plugin${Date.now()}${Math.floor(Math.random() * 1000000)}`);
        this.socketPath = tempPath;

        // Ensure the socket file doesn't exist
        if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
        }

        // Create the Unix domain socket server
        this.server = net.createServer();
    }

    /**
     * Start listening on the Unix socket
     */
    async listen(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.listen(this.socketPath, () => {
                resolve();
            });
            this.server.on('error', reject);
        });
    }

    /**
     * Returns the network type (equivalent to listener.Addr().Network() in Go)
     */
    network(): string {
        return 'unix';
    }

    /**
     * Returns the socket path (equivalent to listener.Addr().String() in Go)
     */
    address(): string {
        return this.socketPath;
    }

    /**
     * Handle incoming connections
     */
    onConnection(callback: (socket: net.Socket) => void): void {
        this.server.on('connection', callback);
    }

    /**
     * Close the server and remove the socket file (like Go's rmListener)
     */
    async close(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.close((err) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Remove the socket file
                if (fs.existsSync(this.socketPath)) {
                    try {
                        fs.unlinkSync(this.socketPath);
                    } catch (unlinkErr) {
                        reject(unlinkErr);
                        return;
                    }
                }

                resolve();
            });
        });
    }
}