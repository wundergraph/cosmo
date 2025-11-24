# FlightRecorder

FlightRecorder uses the new [`flightrecorder`](https://go.dev/blog/flight-recorder) module from Go 1.25 to record trace data when a request takes longer than a specified threshold.

```go
package main

import (
	routercmd "github.com/wundergraph/cosmo/router/cmd"
	// Import your modules here
	_ "github.com/wundergraph/cosmo/router/cmd/flightrecorder/module"
)

func main() {
	routercmd.Main()
}
```

## Configuration

FlightRecorder module is configured as follows in the main router configuration file:

```yaml
modules:
  flightRecorder:
    outputPath: './flight_recorder_data'
    requestLatencyRecordThreshold: 100
    recordMultiple: true
```

### `outputPath`

The `outputPath` is the path where the flight recorder will store the data.

### `requestLatencyRecordThreshold`

The `requestLatencyRecordThreshold` is the threshold in milliseconds above which a trace will be recorded.

### `recordMultiple`

The `recordMultiple` is a boolean that indicates whether the flight recorder should record multiple traces. Defaults to `false`.

## Run the Router

Before you can run the router, you need to copy the `.env.example` to `.env` and adjust the values.

```bash
go run ./cmd/flightrecorder/main.go
```



## Build your own Router

```bash
go build -o router ./cmd/flightrecorder/main.go
```
