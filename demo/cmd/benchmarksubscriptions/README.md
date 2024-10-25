# Run the benchmark

## Prerequisites

1. run edfs infra
2. run demo subgraphs
3. go run -tags=pprof cmd/router/main.go -override-env=.env.bench
4. run test to generate load
5. curl http://localhost:6060/debug/pprof/profile > profile.out && go tool pprof -http 127.0.0.1:8085 profile.out
6. go tool pprof -inuse_space http://localhost:6060/debug/pprof/heap
7. go tool pprof -alloc_space http://localhost:6060/debug/pprof/heap