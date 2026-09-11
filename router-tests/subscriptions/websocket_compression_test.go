package integration

import (
	"bytes"
	"compress/flate"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"testing"
	"time"

	"github.com/gobwas/httphead"
	"github.com/gobwas/ws"
	"github.com/gobwas/ws/wsflate"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// deflateTestClient is a minimal permessage-deflate client with full context
// takeover, implemented directly on WebSocket frames. Unlike gorilla/websocket
// (which always negotiates no_context_takeover) and coder/websocket (which
// skips compression for messages under 128 bytes), it compresses every
// outgoing message and fails on any uncompressed incoming data frame, so both
// directions of the router's context-takeover code paths are exercised on a
// real connection.
type deflateTestClient struct {
	t    *testing.T
	conn io.ReadWriter

	compressBuf *bytes.Buffer
	compressor  *flate.Writer

	decompressor   io.ReadCloser
	decompressDict []byte
}

// deflateReadTail is the DEFLATE stream tail appended before decompression,
// per RFC 7692 §7.2.2: the 4-byte sync flush marker stripped by the sender
// plus an empty stored block to avoid premature EOF.
var deflateReadTail = []byte{0x00, 0x00, 0xff, 0xff, 0x01, 0x00, 0x00, 0xff, 0xff}

func newDeflateTestClient(t *testing.T, conn io.ReadWriter) *deflateTestClient {
	t.Helper()
	compressBuf := new(bytes.Buffer)
	compressor, err := flate.NewWriter(compressBuf, flate.DefaultCompression)
	require.NoError(t, err)
	return &deflateTestClient{
		t:            t,
		conn:         conn,
		compressBuf:  compressBuf,
		compressor:   compressor,
		decompressor: flate.NewReader(bytes.NewReader(nil)),
	}
}

// writeJSON compresses v with the persistent compressor (maintaining the
// sliding window across messages) and sends it as a masked text frame with
// RSV1 set.
func (c *deflateTestClient) writeJSON(v any) {
	c.t.Helper()
	data, err := json.Marshal(v)
	require.NoError(c.t, err)

	c.compressBuf.Reset()
	_, err = c.compressor.Write(data)
	require.NoError(c.t, err)
	require.NoError(c.t, c.compressor.Flush())

	compressed := c.compressBuf.Bytes()
	require.True(c.t, len(compressed) >= 4, "flate output too short")
	require.True(c.t, bytes.HasSuffix(compressed, []byte{0x00, 0x00, 0xff, 0xff}), "expected sync flush marker")
	compressed = compressed[:len(compressed)-4]

	frame := ws.NewFrame(ws.OpText, true, compressed)
	frame.Header.Rsv = ws.Rsv(true, false, false)
	frame = ws.MaskFrameInPlace(frame)
	require.NoError(c.t, ws.WriteFrame(c.conn, frame))
}

// readFrame reads the next data frame and requires it to be compressed.
// It returns the raw compressed payload.
func (c *deflateTestClient) readFrame() []byte {
	c.t.Helper()
	for {
		frame, err := ws.ReadFrame(c.conn)
		require.NoError(c.t, err)
		if frame.Header.OpCode.IsControl() {
			if frame.Header.OpCode == ws.OpClose {
				c.t.Fatalf("unexpected close frame: %q", frame.Payload)
			}
			continue
		}
		require.True(c.t, frame.Header.Fin, "expected unfragmented server frame")
		compressed, err := wsflate.IsCompressed(frame.Header)
		require.NoError(c.t, err)
		require.True(c.t, compressed, "server sent an uncompressed data frame despite negotiated compression")
		return frame.Payload
	}
}

// decompress inflates payload with the persistent decompressor and updates
// the sliding-window dictionary, mirroring RFC 7692 context takeover.
func (c *deflateTestClient) decompress(payload []byte) []byte {
	c.t.Helper()
	data := append(append([]byte{}, payload...), deflateReadTail...)
	resetter, ok := c.decompressor.(flate.Resetter)
	require.True(c.t, ok)
	require.NoError(c.t, resetter.Reset(bytes.NewReader(data), c.decompressDict))

	var out bytes.Buffer
	_, err := io.Copy(&out, c.decompressor)
	require.NoError(c.t, err)

	const maxDictSize = 32 * 1024
	c.decompressDict = append(c.decompressDict, out.Bytes()...)
	if len(c.decompressDict) > maxDictSize {
		c.decompressDict = c.decompressDict[len(c.decompressDict)-maxDictSize:]
	}
	return out.Bytes()
}

func (c *deflateTestClient) readJSON() testenv.WebSocketMessage {
	c.t.Helper()
	var msg testenv.WebSocketMessage
	require.NoError(c.t, json.Unmarshal(c.decompress(c.readFrame()), &msg))
	return msg
}

// TestWebSocketCompressionContextTakeoverFrameLevel verifies permessage-deflate
// with context takeover in both directions against a real router connection:
// every client message is compressed against the shared sliding window, every
// server frame must carry RSV1, and the final assertions prove the server
// compresses across message boundaries rather than per message.
func TestWebSocketCompressionContextTakeoverFrameLevel(t *testing.T) {
	t.Parallel()

	testenv.Run(t, &testenv.Config{
		ModifyWebsocketConfiguration: func(cfg *config.WebSocketConfiguration) {
			cfg.Compression.Enabled = true
			cfg.Compression.Level = 6
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()

		dialer := ws.Dialer{
			Protocols: []string{"graphql-transport-ws"},
			// Offer permessage-deflate without no_context_takeover parameters,
			// so context takeover stays enabled in both directions.
			Extensions: []httphead.Option{(wsflate.Parameters{}).Option()},
		}
		conn, br, hs, err := dialer.Dial(ctx, xEnv.GraphQLWebSocketSubscriptionURL())
		require.NoError(t, err)
		t.Cleanup(func() { _ = conn.Close() })
		require.NoError(t, conn.SetDeadline(time.Now().Add(20*time.Second)))

		// Verify the negotiated extension keeps context takeover enabled.
		require.Len(t, hs.Extensions, 1, "expected permessage-deflate to be negotiated")
		negotiated := hs.Extensions[0].String()
		require.Contains(t, negotiated, "permessage-deflate")
		require.NotContains(t, negotiated, "server_no_context_takeover")
		require.NotContains(t, negotiated, "client_no_context_takeover")

		var reader io.Reader = conn
		if br != nil {
			reader = br
		}
		client := newDeflateTestClient(t, struct {
			io.Reader
			io.Writer
		}{reader, conn})

		// connection_init / connection_ack, both compressed.
		client.writeJSON(testenv.WebSocketMessage{Type: "connection_init"})
		require.Equal(t, "connection_ack", client.readJSON().Type)

		expectedEmployeeDetails := `{"data":{"employees":[{"id":1,"details":{"forename":"Jens","surname":"Neuse"}},{"id":2,"details":{"forename":"Dustin","surname":"Deus"}},{"id":3,"details":{"forename":"Stefan","surname":"Avram"}},{"id":4,"details":{"forename":"Björn","surname":"Schwenzer"}},{"id":5,"details":{"forename":"Sergiy","surname":"Petrunin"}},{"id":7,"details":{"forename":"Suvij","surname":"Surya"}},{"id":8,"details":{"forename":"Nithin","surname":"Kumar"}},{"id":10,"details":{"forename":"Eelco","surname":"Wiersma"}},{"id":11,"details":{"forename":"Alexandra","surname":"Neuse"}},{"id":12,"details":{"forename":"David","surname":"Stutt"}}]}}`
		expectedEmployeeIDs := `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`

		subscribe := func(id, query string) {
			t.Helper()
			client.writeJSON(testenv.WebSocketMessage{
				ID:      id,
				Type:    "subscribe",
				Payload: json.RawMessage(fmt.Sprintf(`{"query":"%s"}`, query)),
			})
		}

		// Query 1: large response that seeds the server's compression window.
		subscribe("1", "{ employees { id details { forename surname } } }")
		next := client.readJSON()
		require.Equal(t, "next", next.Type)
		require.Equal(t, "1", next.ID)
		require.JSONEq(t, expectedEmployeeDetails, string(next.Payload))
		require.Equal(t, "complete", client.readJSON().Type)

		// Query 2: different content. The client compresses this subscribe
		// against the window seeded by earlier messages; if the server did
		// not maintain its decompression dictionary, parsing would fail here.
		subscribe("2", "{ employees { id } }")
		next = client.readJSON()
		require.Equal(t, "next", next.Type)
		require.Equal(t, "2", next.ID)
		require.JSONEq(t, expectedEmployeeIDs, string(next.Payload))
		require.Equal(t, "complete", client.readJSON().Type)

		// Query 3 repeats query 1. Its ~600-byte response payload already
		// sits in the compression window, so a context-takeover compressor
		// emits back-references reaching into earlier messages.
		subscribe("3", "{ employees { id details { forename surname } } }")
		rawNext3 := client.readFrame()

		// Prove the server compresses across message boundaries: the frame
		// must not be independently decompressible. A per-message compressor
		// (or a takeover implementation that resets its window) would produce
		// a self-contained stream here.
		freshReader := flate.NewReader(bytes.NewReader(append(append([]byte{}, rawNext3...), deflateReadTail...)))
		fresh, freshErr := io.ReadAll(freshReader)
		var freshMsg testenv.WebSocketMessage
		selfContained := freshErr == nil && json.Unmarshal(fresh, &freshMsg) == nil && freshMsg.Type == "next"
		require.False(t, selfContained, "server frame decompressed without the shared dictionary; context takeover is not in effect")

		// With the dictionary, the same frame decodes correctly.
		next = testenv.WebSocketMessage{}
		require.NoError(t, json.Unmarshal(client.decompress(rawNext3), &next))
		require.Equal(t, "next", next.Type)
		require.Equal(t, "3", next.ID)
		require.JSONEq(t, expectedEmployeeDetails, string(next.Payload))
		require.Equal(t, "complete", client.readJSON().Type)
	})
}
