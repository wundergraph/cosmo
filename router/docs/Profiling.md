# Profiling

The router is set up with pprof, so users can run the router with `pprof` running, and get a thorough understanding of the active performance. 

> **We recommend that before adding a new feature, users should profile it to make sure that there aren't any surprise resource drains from the feature.**  

## Running the router with pprof
To run the router with pprof, follow the steps in [Contributing.md](../../CONTRIBUTING.md) (Local Development) to set up a local development environment, aside from running `make start-router`.

In the `router` directory, run the following command:
```shell
go run cmd/router/main.go -pprof-addr=":6060"
```

This will start the router with pprof running on port 6060.

To run a solid workflow and get a sense of the routers performance, you can use [k6](https://grafana.com/docs/k6/latest/).
To do so, run:
```shell
brew install k6
k6 run bench.js
```

This will run a benchmark on the router, and you can see the results in the terminal.
```
     ✓ is status 200

     checks.........................: 100.00% 40978 out of 40978
     data_received..................: 294 MB  5.8 MB/s
     data_sent......................: 114 MB  2.3 MB/s
     http_req_blocked...............: avg=7.01µs  min=2µs    med=5µs     max=2.19ms   p(90)=6µs     p(95)=7µs
     http_req_connecting............: avg=1.57µs  min=0s     med=0s      max=1.06ms   p(90)=0s      p(95)=0s
     http_req_duration..............: avg=52.54ms min=8.68ms med=48.33ms max=235.82ms p(90)=93.36ms p(95)=106.39ms
       { expected_response:true }...: avg=52.54ms min=8.68ms med=48.33ms max=235.82ms p(90)=93.36ms p(95)=106.39ms
     http_req_failed................: 0.00%   0 out of 40978
     http_req_receiving.............: avg=1.88ms  min=32µs   med=318µs   max=153.15ms p(90)=4.24ms  p(95)=6.37ms
     http_req_sending...............: avg=24.66µs min=9µs    med=19µs    max=7.72ms   p(90)=29µs    p(95)=34µs
     http_req_tls_handshaking.......: avg=0s      min=0s     med=0s      max=0s       p(90)=0s      p(95)=0s
     http_req_waiting...............: avg=50.62ms min=8.42ms med=46.39ms max=230.97ms p(90)=90.72ms p(95)=103.53ms
     http_reqs......................: 40978   816.55677/s
     iteration_duration.............: avg=52.83ms min=8.95ms med=48.62ms max=236.13ms p(90)=93.65ms p(95)=106.71ms
     iterations.....................: 40978   816.55677/s
     vus............................: 99      min=2              max=99
     vus_max........................: 100     min=100            max=100


running (0m50.2s), 000/100 VUs, 40978 complete and 0 interrupted iterations
default ✓ [======================================] 000/100 VUs  50s
```

This can show you, for example, how many requests were sent, how long it took, and it can help us diagnose the proper configuration of the router for users. 

## Profiling the router
There are many different things you can use pprof for, and we recommend reading the [pprof documentation](https://pkg.go.dev/net/http/pprof) to get a better understanding of what you can do with it.

As an example, to look at heap and memory usage, you can run the following commands:
In a terminal, as the router is running, run:
```shell
go tool pprof http://localhost:6060/debug/pprof/heap
# or
go tool pprof -http 127.0.0.1:6060 heap.out
```

That will open a `pprof` shell, and in it, you can explore commands. Some useful ones are: `web` (which depends on graphviz, `brew install graphviz`), `top`, and `pdf`, which will give you different ways to look at the heap allocations.
For example, `top20` will return:
```
(pprof) top20
Showing nodes accounting for 13458.23kB, 100% of 13458.23kB total
Showing top 20 nodes out of 69
      flat  flat%   sum%        cum   cum%
 2707.76kB 20.12% 20.12%  3252.42kB 24.17%  compress/flate.NewWriter (inline)
 1862.51kB 13.84% 33.96%  1862.51kB 13.84%  github.com/goccy/go-json/internal/decoder.init.0
 1157.33kB  8.60% 42.56%  1157.33kB  8.60%  github.com/dgraph-io/ristretto.newCmRow (inline)
 1090.58kB  8.10% 50.66%  1090.58kB  8.10%  github.com/goccy/go-json/internal/encoder.init.0
 1032.02kB  7.67% 58.33%  1032.02kB  7.67%  github.com/wundergraph/graphql-go-tools/v2/pkg/astparser.NewTokenizer
 1031.14kB  7.66% 65.99%  1031.14kB  7.66%  github.com/wundergraph/graphql-go-tools/v2/pkg/astparser.(*Parser).parseEnumValueDefinition
  809.97kB  6.02% 72.01%   809.97kB  6.02%  github.com/dgraph-io/ristretto/z.(*Bloom).Size (inline)
  650.62kB  4.83% 76.84%   650.62kB  4.83%  github.com/dgraph-io/ristretto.NewCache[go.shape.uint64,go.shape.struct { github.com/wundergraph/cosmo/router/core.operationID uint64; github.com/wundergraph/cosmo/router/core.normalizedRepresentation string; github.com/wundergraph/cosmo/router/core.operationType string }]
  544.67kB  4.05% 80.89%   544.67kB  4.05%  compress/flate.(*compressor).initDeflate (inline)
  520.04kB  3.86% 84.76%   520.04kB  3.86%  github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1.init
     515kB  3.83% 88.58%      515kB  3.83%  github.com/wundergraph/graphql-go-tools/v2/pkg/ast.(*Document).NextRefIndex
  512.31kB  3.81% 92.39%   512.31kB  3.81%  encoding/gob.map.init.3
  512.25kB  3.81% 96.20%   512.25kB  3.81%  github.com/wundergraph/graphql-go-tools/v2/pkg/astvisitor.(*Walker).RegisterEnterDocumentVisitor
  512.02kB  3.80%   100%   512.02kB  3.80%  github.com/wundergraph/graphql-go-tools/v2/pkg/introspection.(*introspectionVisitor).TypeRef
         0     0%   100%   544.67kB  4.05%  compress/flate.(*compressor).init
         0     0%   100%  3252.42kB 24.17%  compress/gzip.(*Writer).Write
         0     0%   100%   512.31kB  3.81%  encoding/gob.init
         0     0%   100%  1967.30kB 14.62%  github.com/dgraph-io/ristretto.NewCache[go.shape.string,go.shape.[]uint8]
         0     0%   100%  1157.33kB  8.60%  github.com/dgraph-io/ristretto.newCmSketch
         0     0%   100%  1967.30kB 14.62%  github.com/dgraph-io/ristretto.newDefaultPolicy[go.shape.[]uint8]
(pprof) 
```

Then, you can also do `list <function>` to get a better understanding of where the memory is being allocated, line by line, in a function.

In addition, we can also see how allocs work by running 

You can also run a profile for an amount of time (for example, 5 seconds), by running:
```
go tool pprof ‘http://localhost:6060/debug/pprof/profile?seconds=5’
```