# Cosmo Terraform Provider

This repository is for the [Cosmo](https://registry.terraform.io/wundergraph/cosmo) Terraform provider, designed to manage Cosmo resources within Terraform. It includes a resource and a data source, examples, and generated documentation.

## Requirements

- [Terraform](https://developer.hashiCorp.com/terraform/downloads) >= 1.0
- [Go](https://golang.org/doc/install) >= 1.21

## Implemented Resources

The Cosmo Terraform provider includes the following resources and data sources:

### Resources

- [cosmo_namespace](docs/resources/namespace.md): Manages namespaces within Cosmo.
- [cosmo_monograph](docs/resources/monograph.md): Manages monographs in Cosmo.
- [cosmo_federated_graph](docs/resources/federated_graph.md): Manages federated graphs in Cosmo.
- [cosmo_subgraph](docs/resources/subgraph.md): Manages subgraphs in Cosmo.

### Data Sources

- [cosmo_namespace](docs/data-sources/namespace.md): Retrieves information about namespaces in Cosmo.
- [cosmo_monograph](docs/data-sources/monograph.md): Retrieves information about monographs in Cosmo.
- [cosmo_federated_graph](docs/data-sources/federated_graph.md): Retrieves information about federated graphs in Cosmo.
- [cosmo_subgraph](docs/data-sources/subgraph.md): Retrieves information about subgraphs in Cosmo.

Each resource and data source allows you to define and manage specific aspects of your Cosmo infrastructure seamlessly within Terraform.

## Building The Provider

To build the provider, clone the repository, enter the directory, and run `make install` to compile and install the provider binary. Note that the `install` command will first build the provider to ensure the binary is up to date.

## Usage

To use the Cosmo Terraform provider:

1. **Install the Provider**: Run the following command to build and install the provider binary locally for use with end-to-end tests:

   ```bash
   make clean build install
   ```

2. **Run Tests**: Execute acceptance tests to ensure the provider works as expected:

   ```bash
   make testacc
   ```

3. **Generate Files**: Update any generated files with this command:

   ```bash
   make generate
   ```

4. **Format Code**: Format Go and Terraform files for consistency:

   ```bash
   make fmt
   ```

5. **Build for All Architectures**: Compile the provider for various operating systems and architectures:

   ```bash
   make build-all-arches
   ```

## Makefile Tasks

The Makefile includes several tasks to facilitate development and testing. For local development, `make build install` should be used to install the provider locally.

- **default**: Runs acceptance tests.
- **testacc**: Runs tests with a timeout.
- **generate**: Updates generated files.
- **tidy**: Cleans up the `go.mod` file.
- **fmt**: Formats code.
- **build**: Compiles the provider binary.
- **install**: Installs the binary in the Terraform plugin directory after building it.
- **build-all-arches**: Compiles the binary for multiple OS and architectures.
- **release**: Generates files and builds binaries for all architectures.
- **e2e-cd-apply**: Runs end-to-end tests for apply. (References: `examples/provider`)
- **e2e-cd-destroy**: Runs end-to-end tests for destroy. (References: `examples/provider`)
- **e2e-cosmo-apply**: Runs end-to-end tests for the cosmo feature. (References: `examples/cosmo`)
- **e2e-cosmo-destroy**: Runs end-to-end tests for cosmo destroy. (References: `examples/cosmo`)
- **e2e-cosmo-monograph-apply**: Runs end-to-end tests for the monograph feature. (References: `examples/resources/comso_monograph`)
- **e2e-cosmo-monograph-destroy**: Runs end-to-end tests for monograph destroy. (References: `examples/resources/comso_monograph`)
