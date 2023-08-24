# Connect RPC API Protobuf Definitions

This directory contains the protobuf definitions for the [Connect RPC API](https://connectrpc.com/). We generate TypeScript and Go code from these definitions.

The TypeScript code is generated to [TypeScript Generated Code](../connect) and the Go client is generated to [Go Generated Code](../router/gen).

## Structure

- `node` contains the protobuf definitions for the Router API.
- `platform` contains the protobuf definitions for the Platform API.
- `common` contains the protobuf definitions for common types used by both APIs.