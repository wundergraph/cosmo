## Plugin development

In the first version we focus on local development of plugins written in Go. We're prefer naming convention over absolute configuration power. The approach is compatible with the CDN deployment.

1. Initialize the plugin

`wgc router plugin init <directory>`

This will scaffold a new plugin in the given directory.

```bash
project_dir
  - myplugin
    - src
      - schema.graphql # User defined schema
      - main.go # Empty, Generated from the scaffold but editable
    - generated
      - service.proto # Generated from schema
      - mapping.json # Generated from schema
      - service.proto.lock.json # Generated lock file
    - go.mod
    - README.md # Getting Started guide
```

2. Compile the plugin

`wgc router plugin build <directory> --generate-only --platform darwin-arm64 linux-amd64`

After initializing the plugin, the user can design the plugin schema. Once the schema is designed, the user can build the plugin. For now, we only support Go plugins.

**Optionally**, the user can skip the compile step with `--generate-only` flag for faster iteration.

```bash
project_dir
  - myplugin
    - src
      - schema.graphql # User defined schema
      - main.go # Main entry point of the plugin
        - main_test.go # Test of the plugin
    - generated
      - service.proto # Generated from schema 
      - mapping.json # Generated from schema
      - service.proto.lock.json # Generated lock file
      - service.pb.go # Generated gRPC code
      - service_grpc.pb.go # Generated gRPC code
    - bin
      - darwin_arm64 (NEW) **Optional**
      - linux_amd64 (NEW) **Optional**
    - go.mod
```

3. Build execution config "compose"

`wgc router compose --config ./config.yaml`

For local development, the user can point to the local plugin directory. All required files are picked from the directory by convention.

```yaml
version: 1
subgraphs:
  # Router Plugin
  - name: grpcdointhings
    plugin:
      version: 1.0.0 # Allows the router to distinguish between a new version of the plugin
      directory: ./project_dir/myplugin # **Optional**, without it will use the CDN
```

4. Start the Router

The router will look for the plugins in the directory specified in the config. It is only interested in the `bin/${PLATFORM}_${ARCH}` binaries of each plugin. The available plugins are listed in the router execution config.

```yaml
plugins:
  directory: ./plugins # Optional, without it will use the CDN
```

## CDN Integration

The plugin binary is hosted on the CDN. The URL is constructed as follows:

```bash
/$orgID/$fedID/plugins/$pluginName/$version/$platform_$arch
```

The plugin name, version are embedded in the router execution config. The router will download the plugin binary from the CDN and store it in the plugin directory.
The architecture is detected at runtime and the correct binary is downloaded.


## Example Go Plugin

We will provide our own SDK for plugin development. It will be a Go package that will be used to implement the plugin.

**main.go**

Only imports the service.go file and serves the plugin.

```go
cosmo "github.com/wundergraph/cosmo/router-plugin"

package main

func main() {
	cosmo.Serve(&GRPCDataSourcePlugin{})
}
```

**service.go**

Defines the plugin implementation.

```go
package main

import (
	"context"

	cosmo "github.com/wundergraph/cosmo/router-plugin"
)

type GRPCDataSourcePlugin struct {
	cosmo.Plugin
}

func (p *GRPCDataSourcePlugin) GRPCServer(broker *cosmo.GRPCBroker, server *cosmo.Server) error {
	productv1.RegisterProductServiceServer(server, &grpctest.MockService{})
	return nil
}

func (p *GRPCDataSourcePlugin) GRPCClient(ctx context.Context, broker *plugin.GRPCBroker, c *cosmo.ClientConn) (interface{}, error) {
	return nil, nil
}
```