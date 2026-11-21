// Package planworker runs query planning in separate worker processes.
//
// The router owns a Pool. Callers put planning requests on its bounded queue, and a
// fixed number of workers take them off, one request per worker at a time. Every worker
// is its own process, so a planning run that is too slow or uses too much memory can be
// stopped by killing the process, without affecting the router.
//
// Router and worker talk over a single byte stream using a request/response protocol.
// Today the stream is the standard input and output of a child process the router
// starts. Nothing in the protocol depends on that: the worker gets everything it needs
// to plan over the stream, so the same worker can be served over a network connection
// to run it as a separate deployment.
//
// The package only knows how to move requests and results around. What a plan is and
// how it is encoded is up to the Handler and the caller of the Pool.
package planworker

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"
)

// ProtocolVersion has to change whenever the framing or one of the messages changes.
const ProtocolVersion = 1

// maxFrameSize protects both sides from allocating absurd amounts of memory when the
// stream gets out of sync.
const maxFrameSize = 1 << 30

type messageType uint8

const (
	// messageHello is sent by the worker once, right after it started.
	messageHello messageType = iota + 1
	messageConfigure
	messageConfigureResult
	// messageRelease tells the worker to drop a configuration. It has no result.
	messageRelease
	messagePlan
	messagePlanResult
)

// Hello describes a worker. The router only talks to workers that produce plans it
// can read.
type Hello struct {
	ProtocolVersion int `json:"protocol_version"`
	// Version is the version of the router the worker was built from.
	Version string `json:"version"`
	// PlanFormat identifies the encoding of the plans the worker returns.
	PlanFormat string `json:"plan_format"`
	PID        int    `json:"pid"`
}

// Config is everything a worker needs to plan operations for one graph. The payload is
// opaque to this package.
type Config struct {
	// ID identifies the payload. Requests refer to the configuration by this ID.
	ID      string
	Payload []byte
}

type configureHeader struct {
	ID string `json:"id"`
}

type configureResultHeader struct {
	Error string `json:"error,omitempty"`
}

// Request asks a worker to plan a single operation.
type Request struct {
	// ConfigID is the configuration to plan with.
	ConfigID string `json:"config_id"`
	// Content is the normalized operation.
	Content       string `json:"content"`
	OperationName string `json:"operation_name"`
	// IncludeQueryPlan makes the planner attach a printable query plan to every fetch.
	IncludeQueryPlan bool `json:"include_query_plan,omitempty"`
}

type Status string

const (
	// StatusOK means the result carries a plan.
	StatusOK Status = "ok"
	// StatusUnsupported means the operation was planned, but the plan can't be sent to
	// the router. The router has to plan the operation itself.
	StatusUnsupported Status = "unsupported"
	// StatusFailed means that planning failed. The router plans the operation itself
	// to report the error exactly like it would without workers.
	StatusFailed Status = "failed"
)

// Result is the outcome of a Request.
type Result struct {
	Status Status `json:"status"`
	// Message explains why there is no plan.
	Message string `json:"message,omitempty"`
	// OperationDocument is the operation as it looks after planning.
	// The planner rewrites parts of it, and the router needs the result for usage tracking.
	OperationDocument string `json:"operation_document,omitempty"`
	// PlanningDuration is the time the worker spent planning, without encoding the plan.
	PlanningDuration time.Duration `json:"planning_duration,omitempty"`
	// Plan is the encoded plan.
	Plan []byte `json:"-"`
}

// frame is the unit of the protocol: a type, a small JSON header and an optional blob
// for large binary payloads.
type frame struct {
	typ    messageType
	header []byte
	blob   []byte
}

// A frame is laid out as:
//
//	uint32  length of everything that follows
//	uint8   message type
//	uint32  length of the header
//	[]byte  header (JSON)
//	[]byte  blob
func writeFrame(w io.Writer, typ messageType, header any, blob []byte) error {
	headerBytes, err := json.Marshal(header)
	if err != nil {
		return fmt.Errorf("failed to encode header: %w", err)
	}
	size := 1 + 4 + len(headerBytes) + len(blob)
	if size > maxFrameSize {
		return fmt.Errorf("message of %d bytes exceeds the limit of %d bytes", size, maxFrameSize)
	}
	// A single write keeps the frame intact if the stream is shared with other writers.
	buf := make([]byte, 0, 4+size)
	buf = binary.BigEndian.AppendUint32(buf, uint32(size))
	buf = append(buf, byte(typ))
	buf = binary.BigEndian.AppendUint32(buf, uint32(len(headerBytes)))
	buf = append(buf, headerBytes...)
	buf = append(buf, blob...)
	_, err = w.Write(buf)
	return err
}

func readFrame(r io.Reader) (*frame, error) {
	var prefix [4]byte
	if _, err := io.ReadFull(r, prefix[:]); err != nil {
		return nil, err
	}
	size := binary.BigEndian.Uint32(prefix[:])
	if size < 5 || size > maxFrameSize {
		return nil, fmt.Errorf("invalid frame size %d", size)
	}
	buf := make([]byte, size)
	if _, err := io.ReadFull(r, buf); err != nil {
		if errors.Is(err, io.EOF) {
			err = io.ErrUnexpectedEOF
		}
		return nil, err
	}
	headerSize := binary.BigEndian.Uint32(buf[1:5])
	if uint64(headerSize) > uint64(len(buf)-5) {
		return nil, fmt.Errorf("invalid header size %d", headerSize)
	}
	return &frame{
		typ:    messageType(buf[0]),
		header: buf[5 : 5+headerSize],
		blob:   buf[5+headerSize:],
	}, nil
}

func (f *frame) decode(expected messageType, header any) error {
	if f.typ != expected {
		return fmt.Errorf("unexpected message type %d, expected %d", f.typ, expected)
	}
	if err := json.Unmarshal(f.header, header); err != nil {
		return fmt.Errorf("failed to decode header: %w", err)
	}
	return nil
}
