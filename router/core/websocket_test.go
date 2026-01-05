package core

import (
	"bytes"
	"compress/flate"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/gobwas/ws"
	"github.com/gobwas/ws/wsflate"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockConn is a mock net.Conn for testing WebSocket operations
type mockConn struct {
	readBuf  *bytes.Buffer
	writeBuf *bytes.Buffer
	mu       sync.Mutex
	closed   bool
}

func newMockConn() *mockConn {
	return &mockConn{
		readBuf:  new(bytes.Buffer),
		writeBuf: new(bytes.Buffer),
	}
}

func (m *mockConn) Read(b []byte) (n int, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.readBuf.Read(b)
}

func (m *mockConn) Write(b []byte) (n int, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.writeBuf.Write(b)
}

func (m *mockConn) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	return nil
}

func (m *mockConn) LocalAddr() net.Addr                { return nil }
func (m *mockConn) RemoteAddr() net.Addr               { return nil }
func (m *mockConn) SetDeadline(t time.Time) error      { return nil }
func (m *mockConn) SetReadDeadline(t time.Time) error  { return nil }
func (m *mockConn) SetWriteDeadline(t time.Time) error { return nil }

// writeFrame writes a WebSocket frame to the mock connection's read buffer
func (m *mockConn) writeFrame(frame ws.Frame) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return ws.WriteFrame(m.readBuf, frame)
}

// getWrittenBytes returns the bytes written to the mock connection
func (m *mockConn) getWrittenBytes() []byte {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.writeBuf.Bytes()
}

// TestWsConnectionWrapper_NoContextTakeover tests compression without context takeover
func TestWsConnectionWrapper_NoContextTakeover(t *testing.T) {
	t.Run("write compressed message without context takeover", func(t *testing.T) {
		conn := newMockConn()
		wrapper, err := newWSConnectionWrapper(conn, 0, 0, compressionMode{enabled: true, level: 6})
		require.NoError(t, err)

		// Write a test message
		testData := map[string]string{"message": "hello world"}
		err = wrapper.WriteJSON(testData)
		require.NoError(t, err)

		// Read the frame from the mock connection
		writtenBytes := conn.getWrittenBytes()
		require.NotEmpty(t, writtenBytes)

		// Parse the frame
		frame, err := ws.ReadFrame(bytes.NewReader(writtenBytes))
		require.NoError(t, err)

		// Verify RSV1 bit is set (compression)
		isCompressed, err := wsflate.IsCompressed(frame.Header)
		require.NoError(t, err)
		assert.True(t, isCompressed, "Frame should be compressed")

		// Decompress and verify content
		decompressed, err := wsflate.DecompressFrame(frame)
		require.NoError(t, err)

		var result map[string]string
		err = json.Unmarshal(decompressed.Payload, &result)
		require.NoError(t, err)
		assert.Equal(t, testData, result)
	})

	t.Run("read compressed message without context takeover", func(t *testing.T) {
		conn := newMockConn()
		wrapper, err := newWSConnectionWrapper(conn, 0, 0, compressionMode{enabled: true, level: 6})
		require.NoError(t, err)

		// Prepare a compressed message
		testData := map[string]string{"message": "hello world"}
		jsonData, _ := json.Marshal(testData)

		// Compress the data
		compressed, err := compressData(jsonData)
		require.NoError(t, err)

		// Create a compressed frame (client frame - masked)
		frame := ws.NewFrame(ws.OpText, true, compressed)
		frame.Header.Rsv = ws.Rsv(true, false, false)
		frame.Header.Masked = true
		frame.Header.Mask = [4]byte{1, 2, 3, 4}
		ws.Cipher(frame.Payload, frame.Header.Mask, 0)

		// Write to mock connection's read buffer
		err = conn.writeFrame(frame)
		require.NoError(t, err)

		// Read and verify
		var result map[string]string
		err = wrapper.ReadJSON(&result)
		require.NoError(t, err)
		assert.Equal(t, testData, result)
	})
}

// TestWsConnectionWrapper_ContextTakeover tests compression with context takeover
func TestWsConnectionWrapper_ContextTakeover(t *testing.T) {
	t.Run("write multiple messages with server context takeover shows compression benefit", func(t *testing.T) {
		conn := newMockConn()
		// Enable server context takeover
		wrapper, err := newWSConnectionWrapper(conn, 0, 0, compressionMode{enabled: true, level: 6, serverContextTakeover: true})
		require.NoError(t, err)

		// Write multiple similar messages - with context takeover,
		// subsequent messages should reference patterns from earlier ones
		messages := []map[string]string{
			{"type": "next", "id": "1", "data": "first message with some repeated content"},
			{"type": "next", "id": "2", "data": "second message with some repeated content"},
			{"type": "next", "id": "3", "data": "third message with some repeated content"},
		}

		var compressedSizes []int

		for _, msg := range messages {
			conn.writeBuf.Reset() // Clear for each message

			err := wrapper.WriteJSON(msg)
			require.NoError(t, err)

			writtenBytes := conn.getWrittenBytes()
			compressedSizes = append(compressedSizes, len(writtenBytes))
		}

		// With context takeover, later messages should be smaller
		// because they can reference patterns from earlier messages
		t.Logf("Compressed sizes with context takeover: %v", compressedSizes)

		// The second and third messages should be smaller than the first
		// due to dictionary reuse
		assert.Less(t, compressedSizes[1], compressedSizes[0],
			"Second message should be smaller due to context takeover")
		assert.Less(t, compressedSizes[2], compressedSizes[0],
			"Third message should be smaller due to context takeover")
	})

	t.Run("write multiple messages without server context takeover for comparison", func(t *testing.T) {
		conn := newMockConn()
		// Disable server context takeover
		wrapper, err := newWSConnectionWrapper(conn, 0, 0, compressionMode{enabled: true, level: 6})
		require.NoError(t, err)

		messages := []map[string]string{
			{"type": "next", "id": "1", "data": "first message with some repeated content"},
			{"type": "next", "id": "2", "data": "second message with some repeated content"},
			{"type": "next", "id": "3", "data": "third message with some repeated content"},
		}

		var compressedSizes []int

		for _, msg := range messages {
			conn.writeBuf.Reset()

			err := wrapper.WriteJSON(msg)
			require.NoError(t, err)

			writtenBytes := conn.getWrittenBytes()
			compressedSizes = append(compressedSizes, len(writtenBytes))
		}

		t.Logf("Compressed sizes without context takeover: %v", compressedSizes)

		// Without context takeover, all messages should be similar size
		// since each is compressed independently
		sizeDiff12 := abs(compressedSizes[1] - compressedSizes[0])
		sizeDiff13 := abs(compressedSizes[2] - compressedSizes[0])

		// Allow some variation but messages should be roughly same size
		assert.Less(t, sizeDiff12, 10, "Messages without context takeover should be similar size")
		assert.Less(t, sizeDiff13, 10, "Messages without context takeover should be similar size")
	})

	t.Run("read compressed messages without context takeover", func(t *testing.T) {
		conn := newMockConn()
		// Disable client context takeover - each message compressed independently
		wrapper, err := newWSConnectionWrapper(conn, 0, 0, compressionMode{enabled: true, level: 6})
		require.NoError(t, err)

		// Prepare multiple independently compressed messages
		messages := []map[string]string{
			{"type": "subscribe", "id": "1"},
			{"type": "subscribe", "id": "2"},
			{"type": "subscribe", "id": "3"},
		}

		for _, msg := range messages {
			conn.readBuf.Reset()

			jsonData, _ := json.Marshal(msg)
			// Compress without context takeover (independent)
			compressed, err := compressData(jsonData)
			require.NoError(t, err)

			// Create frame
			frame := ws.NewFrame(ws.OpText, true, compressed)
			frame.Header.Rsv = ws.Rsv(true, false, false)
			frame.Header.Masked = true
			frame.Header.Mask = [4]byte{1, 2, 3, 4}
			ws.Cipher(frame.Payload, frame.Header.Mask, 0)

			err = conn.writeFrame(frame)
			require.NoError(t, err)

			// Read and verify
			var result map[string]string
			err = wrapper.ReadJSON(&result)
			require.NoError(t, err)
			assert.Equal(t, msg, result)
		}
	})
}

// TestWsConnectionWrapper_FragmentedFrames tests handling of fragmented WebSocket frames
func TestWsConnectionWrapper_FragmentedFrames(t *testing.T) {
	t.Run("read fragmented uncompressed message", func(t *testing.T) {
		conn := newMockConn()
		wrapper, err := newWSConnectionWrapper(conn, 0, 0, compressionMode{enabled: true, level: 6})
		require.NoError(t, err)

		// Prepare a message that will be sent in fragments
		testData := map[string]string{"message": "this is a longer message that will be fragmented"}
		jsonData, _ := json.Marshal(testData)

		// Split into 3 fragments
		fragmentSize := len(jsonData) / 3
		fragments := [][]byte{
			jsonData[:fragmentSize],
			jsonData[fragmentSize : 2*fragmentSize],
			jsonData[2*fragmentSize:],
		}

		// First fragment (not FIN, OpText)
		frame1 := ws.NewFrame(ws.OpText, false, fragments[0])
		frame1.Header.Masked = true
		frame1.Header.Mask = [4]byte{1, 2, 3, 4}
		ws.Cipher(frame1.Payload, frame1.Header.Mask, 0)

		// Middle fragment (not FIN, OpContinuation)
		frame2 := ws.NewFrame(ws.OpContinuation, false, fragments[1])
		frame2.Header.Masked = true
		frame2.Header.Mask = [4]byte{5, 6, 7, 8}
		ws.Cipher(frame2.Payload, frame2.Header.Mask, 0)

		// Final fragment (FIN, OpContinuation)
		frame3 := ws.NewFrame(ws.OpContinuation, true, fragments[2])
		frame3.Header.Masked = true
		frame3.Header.Mask = [4]byte{9, 10, 11, 12}
		ws.Cipher(frame3.Payload, frame3.Header.Mask, 0)

		// Write all frames
		err = conn.writeFrame(frame1)
		require.NoError(t, err)
		err = conn.writeFrame(frame2)
		require.NoError(t, err)
		err = conn.writeFrame(frame3)
		require.NoError(t, err)

		// Read should reassemble the fragments
		var result map[string]string
		err = wrapper.ReadJSON(&result)
		require.NoError(t, err)
		assert.Equal(t, testData, result)
	})

	t.Run("read fragmented compressed message", func(t *testing.T) {
		conn := newMockConn()
		wrapper, err := newWSConnectionWrapper(conn, 0, 0, compressionMode{enabled: true, level: 6})
		require.NoError(t, err)

		// Prepare and compress a message
		testData := map[string]string{"message": "this is a compressed message that will be fragmented"}
		jsonData, _ := json.Marshal(testData)
		compressed, err := compressData(jsonData)
		require.NoError(t, err)

		// Split compressed data into 2 fragments
		midPoint := len(compressed) / 2
		fragments := [][]byte{
			compressed[:midPoint],
			compressed[midPoint:],
		}

		// First fragment (not FIN, OpText, RSV1 set for compression)
		frame1 := ws.NewFrame(ws.OpText, false, fragments[0])
		frame1.Header.Rsv = ws.Rsv(true, false, false) // RSV1 only on first frame
		frame1.Header.Masked = true
		frame1.Header.Mask = [4]byte{1, 2, 3, 4}
		ws.Cipher(frame1.Payload, frame1.Header.Mask, 0)

		// Final fragment (FIN, OpContinuation, RSV1 NOT set per RFC 7692)
		frame2 := ws.NewFrame(ws.OpContinuation, true, fragments[1])
		frame2.Header.Masked = true
		frame2.Header.Mask = [4]byte{5, 6, 7, 8}
		ws.Cipher(frame2.Payload, frame2.Header.Mask, 0)

		// Write frames
		err = conn.writeFrame(frame1)
		require.NoError(t, err)
		err = conn.writeFrame(frame2)
		require.NoError(t, err)

		// Read should reassemble and decompress
		var result map[string]string
		err = wrapper.ReadJSON(&result)
		require.NoError(t, err)
		assert.Equal(t, testData, result)
	})
}

// TestWsConnectionWrapper_ContextTakeoverDictionary tests dictionary accumulation
func TestWsConnectionWrapper_ContextTakeoverDictionary(t *testing.T) {
	t.Run("server context takeover compressor maintains state", func(t *testing.T) {
		conn := newMockConn()
		// Enable server context takeover
		wrapper, err := newWSConnectionWrapper(conn, 0, 0, compressionMode{enabled: true, level: 6, serverContextTakeover: true})
		require.NoError(t, err)

		// Verify compressor is initialized
		assert.NotNil(t, wrapper.compressor, "Compressor should be initialized for context takeover")
		assert.NotNil(t, wrapper.compressBuf, "Compress buffer should be initialized")

		// Write a message
		err = wrapper.WriteJSON(map[string]string{"test": "data"})
		require.NoError(t, err)

		// Compressor should still be valid (not nil) after use
		assert.NotNil(t, wrapper.compressor, "Compressor should persist after use")
	})

	t.Run("client context takeover decompressor is initialized", func(t *testing.T) {
		conn := newMockConn()
		// Enable client context takeover
		wrapper, err := newWSConnectionWrapper(conn, 0, 0, compressionMode{enabled: true, level: 6, clientContextTakeover: true})
		require.NoError(t, err)

		// Verify decompressor is initialized
		assert.NotNil(t, wrapper.decompressor, "Decompressor should be initialized for context takeover")
		assert.NotNil(t, wrapper.decompressDict, "Decompress dictionary should be initialized")
	})

	t.Run("no context takeover does not initialize persistent state", func(t *testing.T) {
		conn := newMockConn()
		// Disable context takeover
		wrapper, err := newWSConnectionWrapper(conn, 0, 0, compressionMode{enabled: true, level: 6})
		require.NoError(t, err)

		// Verify persistent state is not initialized
		assert.Nil(t, wrapper.compressor, "Compressor should not be initialized without server context takeover")
		assert.Nil(t, wrapper.compressBuf, "Compress buffer should not be initialized")
		assert.Nil(t, wrapper.decompressor, "Decompressor should not be initialized without client context takeover")
		assert.Nil(t, wrapper.decompressDict, "Decompress dictionary should not be initialized")
	})

	t.Run("decompress with client context takeover handles wsflate read tail framing", func(t *testing.T) {
		conn := newMockConn()
		wrapper, err := newWSConnectionWrapper(conn, 0, 0, compressionMode{enabled: true, level: 6, clientContextTakeover: true})
		require.NoError(t, err)

		var compressBuf bytes.Buffer
		compressor, err := flate.NewWriter(&compressBuf, 6)
		require.NoError(t, err)
		t.Cleanup(func() {
			_ = compressor.Close()
		})

		compressMessage := func(msg []byte) []byte {
			compressBuf.Reset()
			_, err := compressor.Write(msg)
			require.NoError(t, err)
			require.NoError(t, compressor.Flush())

			compressed := append([]byte(nil), compressBuf.Bytes()...)

			// Match PMCE framing semantics: sender strips the 0x00 0x00 0xff 0xff tail.
			require.GreaterOrEqual(t, len(compressed), 4)
			require.Equal(t, []byte{0x00, 0x00, 0xff, 0xff}, compressed[len(compressed)-4:])
			return compressed[:len(compressed)-4]
		}

		// Second message is highly repetitive so it should benefit from context takeover.
		msg1 := []byte(`{"type":"next","id":"1","payload":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`)
		msg2 := []byte(`{"type":"next","id":"2","payload":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`)

		compressed1 := compressMessage(msg1)
		got1, err := wrapper.decompressWithContextTakeover(compressed1)
		require.NoError(t, err)
		assert.Equal(t, msg1, got1)

		compressed2 := compressMessage(msg2)
		got2, err := wrapper.decompressWithContextTakeover(compressed2)
		require.NoError(t, err)
		assert.Equal(t, msg2, got2)
	})
}

// TestWsConnectionWrapper_CompressionDisabled tests behavior when compression is disabled
func TestWsConnectionWrapper_CompressionDisabled(t *testing.T) {
	t.Run("write uncompressed when compression disabled", func(t *testing.T) {
		conn := newMockConn()
		wrapper, err := newWSConnectionWrapper(conn, 0, 0, compressionMode{enabled: false, level: 6})
		require.NoError(t, err)

		testData := map[string]string{"message": "hello world"}
		err = wrapper.WriteJSON(testData)
		require.NoError(t, err)

		writtenBytes := conn.getWrittenBytes()
		require.NotEmpty(t, writtenBytes)

		// Parse the frame
		frame, err := ws.ReadFrame(bytes.NewReader(writtenBytes))
		require.NoError(t, err)

		// Verify RSV1 bit is NOT set (no compression)
		isCompressed, err := wsflate.IsCompressed(frame.Header)
		require.NoError(t, err)
		assert.False(t, isCompressed, "Frame should not be compressed")
	})
}

// TestWsConnectionWrapper_WriteText tests WriteText method
func TestWsConnectionWrapper_WriteText(t *testing.T) {
	t.Run("write text with compression", func(t *testing.T) {
		conn := newMockConn()
		wrapper, err := newWSConnectionWrapper(conn, 0, 0, compressionMode{enabled: true, level: 6})
		require.NoError(t, err)

		testText := `{"type":"connection_ack"}`
		err = wrapper.WriteText(testText)
		require.NoError(t, err)

		// Verify frame is compressed
		frame, err := ws.ReadFrame(bytes.NewReader(conn.getWrittenBytes()))
		require.NoError(t, err)

		isCompressed, err := wsflate.IsCompressed(frame.Header)
		require.NoError(t, err)
		assert.True(t, isCompressed)

		// Decompress and verify
		decompressed, err := wsflate.DecompressFrame(frame)
		require.NoError(t, err)
		assert.Equal(t, testText, string(decompressed.Payload))
	})

	t.Run("write text without compression", func(t *testing.T) {
		conn := newMockConn()
		wrapper, err := newWSConnectionWrapper(conn, 0, 0, compressionMode{enabled: false, level: 6})
		require.NoError(t, err)

		testText := `{"type":"connection_ack"}`
		err = wrapper.WriteText(testText)
		require.NoError(t, err)

		// Verify frame is not compressed
		frame, err := ws.ReadFrame(bytes.NewReader(conn.getWrittenBytes()))
		require.NoError(t, err)

		isCompressed, err := wsflate.IsCompressed(frame.Header)
		require.NoError(t, err)
		assert.False(t, isCompressed)
		assert.Equal(t, testText, string(frame.Payload))
	})
}

// TestResolveNegotiatedCompression tests the resolveNegotiatedCompression function
func TestResolveNegotiatedCompression(t *testing.T) {
	base := compressionMode{enabled: true, level: 6}

	t.Run("returns disabled when ext is nil", func(t *testing.T) {
		result := resolveNegotiatedCompression(base, nil, nil)
		assert.False(t, result.enabled)
		assert.Equal(t, 6, result.level)
	})

	t.Run("returns disabled when upgrade error occurs", func(t *testing.T) {
		ext := &wsflate.Extension{}
		result := resolveNegotiatedCompression(base, ext, fmt.Errorf("upgrade failed"))
		assert.False(t, result.enabled)
		assert.Equal(t, 6, result.level)
	})

	t.Run("returns disabled when compression not accepted by client", func(t *testing.T) {
		// Extension exists (server supports compression) but Accepted() returns false
		// because the client never offered permessage-deflate.
		ext := &wsflate.Extension{
			Parameters: wsflate.Parameters{
				ServerNoContextTakeover: true,
				ClientNoContextTakeover: true,
			},
		}
		// Without calling ext.Negotiate, ext.Accepted() returns false.
		result := resolveNegotiatedCompression(base, ext, nil)
		assert.False(t, result.enabled, "compression must be disabled when the client did not negotiate it")
		assert.Equal(t, 6, result.level)
		assert.False(t, result.serverContextTakeover)
		assert.False(t, result.clientContextTakeover)
	})

	t.Run("returns enabled with context takeover when accepted without no_context_takeover", func(t *testing.T) {
		ext := &wsflate.Extension{
			Parameters: wsflate.Parameters{
				ServerNoContextTakeover: false,
				ClientNoContextTakeover: false,
			},
		}
		// Simulate successful negotiation by calling Negotiate with a valid offer.
		offer := wsflate.Parameters{
			ServerNoContextTakeover: false,
			ClientNoContextTakeover: false,
		}.Option()
		_, _ = ext.Negotiate(offer)

		result := resolveNegotiatedCompression(base, ext, nil)
		assert.True(t, result.enabled)
		assert.Equal(t, 6, result.level)
		assert.True(t, result.serverContextTakeover)
		assert.True(t, result.clientContextTakeover)
	})

	t.Run("returns enabled without context takeover when no_context_takeover negotiated", func(t *testing.T) {
		ext := &wsflate.Extension{
			Parameters: wsflate.Parameters{
				ServerNoContextTakeover: true,
				ClientNoContextTakeover: true,
			},
		}
		offer := wsflate.Parameters{
			ServerNoContextTakeover: true,
			ClientNoContextTakeover: true,
		}.Option()
		_, _ = ext.Negotiate(offer)

		result := resolveNegotiatedCompression(base, ext, nil)
		assert.True(t, result.enabled)
		assert.Equal(t, 6, result.level)
		assert.False(t, result.serverContextTakeover)
		assert.False(t, result.clientContextTakeover)
	})
}

// Helper functions

// abs returns the absolute value of an integer
func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// compressData compresses data using deflate (without context takeover)
func compressData(data []byte) ([]byte, error) {
	var buf bytes.Buffer
	writer := wsflate.NewWriter(&buf, func(w io.Writer) wsflate.Compressor {
		fw, _ := flate.NewWriter(w, 6)
		return fw
	})
	if _, err := writer.Write(data); err != nil {
		return nil, err
	}
	if err := writer.Flush(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
