# Cosmo Router Plugin

This package provides a simple framework for building gRPC-based plugins for the Cosmo router.

## Overview

The Router Plugin system allows you to extend the Cosmo router with custom gRPC services. This README focuses on how to build a server-side plugin.

## Getting Started

Read the official [documentation](https://cosmo-docs.wundergraph.com/router/plugins) for the Cosmo router to understand how to set up your environment and build a plugin.

## API Reference

The router plugin package provides a simple API:

- `NewRouterPlugin(registrationFunc func(*grpc.Server)) (*RouterPlugin, error)`: Creates a new router plugin with a function to register services
- `(*RouterPlugin) Serve()`: Starts serving the plugin

## Requirements

- Go 1.16 or later
- Protocol Buffer compiler (protoc)
- Go plugins for Protocol Buffers
