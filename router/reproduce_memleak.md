# Reproduce memory leak after hot reloads

1. Create local engine config file

```jsx
cd demo && ./compose.sh && cd ..
```

2. Switch to Router dir

```bash
cd router
```

3. Run Router

```bash
PPROF_ADDR=:6060 go run cmd/router/main.go
```

4. Run queries to fill caches

```bash
k6 run --vus=5 --duration=10s bench/slow-plan-cache-stress.js
```

5. Capture baseline memory footprint

```bash
curl -s 'http://localhost:6060/debug/pprof/heap' -o /tmp/heap-before.pb.gz
```

6. Force a bunch of router hot reloads

```bash
# do this a bunch of times, wait for router logs to confirm hot reload
printf '\n' >> ../demo/config.json
```

7. Do a bunch of GC runs

```bash
for i in $(seq 1 2); do curl -s -o /dev/null 'http://localhost:3002/debug/pprof/heap?gc=1'; sleep 1; done
```

8. Capture another profile

```bash
curl -s 'http://localhost:6060/debug/pprof/heap?gc=1' -o /tmp/heap-after.pb.gz
```

9. Diff both profiles with inuse_space

```bash
go tool pprof -base /tmp/heap-before.pb.gz -inuse_space -cum /tmp/heap-after.pb.gz
```