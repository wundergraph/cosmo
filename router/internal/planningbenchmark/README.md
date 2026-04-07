# Planning Benchmark

Allows to benchmark query planning performance of a single graphql query

## Prerequisites

- Compose subgraphs to get execution config.json
- Create `benchmark_config.json` file in the `router/internal/planningbenchmark` directory with the following content:

```json
{
  "executionConfigPath": "<path-to-composed-config.json>",
  "operationPath": "<path-to-graphql-query-file>.graphql",
}
```

## Running the Benchmark

Run `BenchmarkPlanning` benchmark from benchmark_test.go

## Running benchmark using taskfile

- Modify step name in `router/internal/planningbenchmark/Taskfile.yml` if needed
- Run `task bench-cpu` from `router/internal/planningbenchmark` directory
- Profile will be generated in file `<step>_cpu.out`

You could use different profiles or combine profile. See Taskfile.yml for more details.