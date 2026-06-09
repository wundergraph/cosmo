module github.com/wundergraph/cosmo/demo/code-mode/yoko-mock

go 1.25.0

require (
	connectrpc.com/connect v1.19.1
	github.com/dgraph-io/ristretto/v2 v2.4.0
	github.com/stretchr/testify v1.11.1
	github.com/wundergraph/cosmo/router v0.0.0
	google.golang.org/protobuf v1.36.10
)

require (
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	golang.org/x/sys v0.40.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

replace github.com/wundergraph/cosmo/router => ../../../router
