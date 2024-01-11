# Router Execution config generation for development

This directory contains files and scripts used to generate a Router execution config based on a federated graph setup.

## Setup

1. Start the subgraphs in the `subgraphs` directory by running `dc-subgraphs-demo` from the root of the repository.
2. `./compose.sh` to generate the Router execution config from the subgraphs. The generated file will be placed in the `__schemas/config.json`.

You can use the generate file by setting the `router_config_path` property to `./__schemas/config.json` in the Router config [`config.yml`](../config.yml).