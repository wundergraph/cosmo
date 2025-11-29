# ConnectRPC Test Helper

Test helpers for ConnectRPC server testing.

## Usage

```go
import "github.com/wundergraph/cosmo/router-tests/connectrpc"

func TestMyFeature(t *testing.T) {
    ts := connectrpc.NewTestServer(t)
    require.NoError(t, ts.Start())
    
    ts.AssertServiceDiscovered(t, "employee.v1.EmployeeService")
    ts.AssertMinOperationCount(t, 1)
}
```

## Options

- `WithServicesDir(dir string)` - Set services directory (default: `testdata/connectrpc/services`)
- `WithGraphQLHandler(handler http.HandlerFunc)` - Set custom GraphQL handler
- `WithLogger(logger *zap.Logger)` - Set custom logger

## Methods

**Server Control:**
- `Start() error`
- `Reload() error`
- `Close()`
- `WaitForReady(ctx context.Context) error`

**Information:**
- `ServiceCount() int`
- `ServiceNames() []string`
- `OperationCount() int`

**Assertions:**
- `AssertServiceDiscovered(t, serviceName)`
- `AssertServiceCount(t, expected)`
- `AssertMinServiceCount(t, min)`
- `AssertOperationCount(t, expected)`
- `AssertMinOperationCount(t, min)`

## Directory Structure

```
router-tests/
├── connectrpc/
│   ├── server.go
│   └── README.md
├── connectrpc_test.go
└── testdata/
    └── connectrpc/
        └── services/
```