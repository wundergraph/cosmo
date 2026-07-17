package core

import (
	"bytes"
	stdflate "compress/flate"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"slices"
	"sync"
	"syscall"
	"time"

	"github.com/buger/jsonparser"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/gobwas/httphead"
	"github.com/gobwas/ws"
	"github.com/gobwas/ws/wsflate"
	"github.com/gobwas/ws/wsutil"
	"github.com/gorilla/websocket"
	kpflate "github.com/klauspost/compress/flate"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
	"github.com/wundergraph/astjson"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/wsproto"
	"github.com/wundergraph/cosmo/router/pkg/authentication"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"github.com/wundergraph/cosmo/router/pkg/statistics"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/netpoll"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

// errClientTerminatedConnection is returned by HandleMessage when the client
// sends a terminate message. It surfaces as *wsproto.CloseError so the read
// loops handle it via the same errors.As path as any other close-kind error.
var errClientTerminatedConnection = &wsproto.CloseError{
	Err:  errors.New("client terminated connection"),
	Kind: wsproto.CloseKindNormal,
}

type compressionMode struct {
	enabled               bool
	level                 int
	serverContextTakeover bool
	clientContextTakeover bool
	// clientWindowBits is the negotiated LZ77 window size (8-15) used by the
	// client for compression. The decompression dictionary is sized as
	// 1 << clientWindowBits. Default is 15 (32 KB, the DEFLATE maximum).
	clientWindowBits int
}

// flateReadTail is the DEFLATE stream tail appended before decompression, per
// RFC 7692: the 4-byte sync flush marker stripped by the sender plus an empty
// stored block, which avoids premature EOF on some streams.
var flateReadTail = []byte{
	0x00, 0x00, 0xff, 0xff, // sync flush marker
	0x01, 0x00, 0x00, 0xff, 0xff, // empty stored block
}

// Two DEFLATE implementations are used deliberately:
//
//   - klauspost/compress/flate (kpflate) for the pooled no-context-takeover
//     writer and for all decompression. Its writer is 6-12x faster than the
//     standard library, and inflate has no behavioral differences.
//   - compress/flate (stdflate) for the persistent context-takeover
//     compressor only. kpflate's fast encoders (levels <= 6) skip history
//     matching for small inputs, so consecutive small messages would not
//     reference the shared sliding window - forfeiting the compression-ratio
//     benefit that justifies keeping per-connection compressor state.
//
// Pools below serve the no-context-takeover compression paths. Without
// context takeover every message is an independent DEFLATE stream, so
// writers and readers hold no state between messages and can be shared
// across connections once reset. This matters because flate writers carry
// large internal hash tables that make per-message construction
// prohibitively expensive.
//
// These pools must never be used for the context-takeover paths: those
// compressors and decompressors are per-connection state precisely because
// of the shared sliding-window dictionary.
//
// Writers keep their compression level across Reset, so each level gets its
// own pool. The index covers the full flate range from HuffmanOnly (-2) to
// BestCompression (9).
var flateWriterPools [kpflate.BestCompression - kpflate.HuffmanOnly + 1]sync.Pool

// pooledFlateWriter returns a flate writer for the given level together with
// the pool it must be returned to after a successful write. Callers must drop
// the writer (not Put it back) if any write or flush fails, since its state
// is undefined after an error.
func pooledFlateWriter(level int) (*kpflate.Writer, *sync.Pool, error) {
	if level < kpflate.HuffmanOnly || level > kpflate.BestCompression {
		return nil, nil, fmt.Errorf("invalid flate compression level: %d", level)
	}
	pool := &flateWriterPools[level-kpflate.HuffmanOnly]
	if fw, ok := pool.Get().(*kpflate.Writer); ok {
		return fw, pool, nil
	}
	fw, err := kpflate.NewWriter(nil, level)
	if err != nil {
		return nil, nil, err
	}
	return fw, pool, nil
}

var flateReaderPool = sync.Pool{
	New: func() any {
		return kpflate.NewReader(bytes.NewReader(nil))
	},
}

type WebsocketMiddlewareOptions struct {
	OperationProcessor *OperationProcessor
	OperationBlocker   *OperationBlocker
	Planner            *OperationPlanner
	GraphQLHandler     *GraphQLHandler
	PreHandler         *PreHandler
	Metrics            RouterMetrics
	AccessController   *AccessController
	Logger             *zap.Logger
	Stats              statistics.EngineStatistics
	ReadTimeout        time.Duration
	WriteTimeout       time.Duration

	EnableNetPoll         bool
	NetPollTimeout        time.Duration
	NetPollConnBufferSize int

	WebSocketConfiguration *config.WebSocketConfiguration
	ClientHeader           config.ClientHeader

	DisableVariablesRemapping bool

	ApolloCompatibilityFlags config.ApolloCompatibilityFlags
}

func NewWebsocketMiddleware(ctx context.Context, opts WebsocketMiddlewareOptions) func(http.Handler) http.Handler {
	handler := &WebsocketHandler{
		ctx:                       ctx,
		operationProcessor:        opts.OperationProcessor,
		operationBlocker:          opts.OperationBlocker,
		planner:                   opts.Planner,
		graphqlHandler:            opts.GraphQLHandler,
		preHandler:                opts.PreHandler,
		metrics:                   opts.Metrics,
		accessController:          opts.AccessController,
		logger:                    opts.Logger,
		stats:                     opts.Stats,
		readTimeout:               opts.ReadTimeout,
		writeTimeout:              opts.WriteTimeout,
		config:                    opts.WebSocketConfiguration,
		clientHeader:              opts.ClientHeader,
		disableVariablesRemapping: opts.DisableVariablesRemapping,
		apolloCompatibilityFlags:  opts.ApolloCompatibilityFlags,
	}
	if opts.WebSocketConfiguration != nil && opts.WebSocketConfiguration.Compression.Enabled {
		handler.compression.enabled = true
		handler.compression.level = opts.WebSocketConfiguration.Compression.Level
		if handler.compression.level < 1 || handler.compression.level > 9 {
			handler.compression.level = kpflate.DefaultCompression
		}
		handler.compression.clientWindowBits = opts.WebSocketConfiguration.Compression.ClientMaxWindowBits
		if handler.compression.clientWindowBits < 8 || handler.compression.clientWindowBits > 15 {
			handler.compression.clientWindowBits = 15
		}
	}
	if opts.WebSocketConfiguration != nil && opts.WebSocketConfiguration.AbsintheProtocol.Enabled {
		handler.absintheHandlerEnabled = true
		handler.absintheHandlerPath = opts.WebSocketConfiguration.AbsintheProtocol.HandlerPath
	}
	if opts.WebSocketConfiguration.ForwardUpgradeHeaders.Enabled {
		handler.forwardUpgradeHeadersConfig.enabled = true
		for _, str := range opts.WebSocketConfiguration.ForwardUpgradeHeaders.AllowList {
			if detectNonRegex.MatchString(str) {
				canonicalHeaderKey := http.CanonicalHeaderKey(str)
				handler.forwardUpgradeHeadersConfig.staticAllowList = append(handler.forwardUpgradeHeadersConfig.staticAllowList, canonicalHeaderKey)
			} else {
				re, err := regexp.Compile(str)
				if err != nil {
					opts.Logger.Warn("Invalid regex in forward upgrade headers allow list", zap.String("regex", str), zap.Error(err))
					continue
				}
				handler.forwardUpgradeHeadersConfig.regexAllowList = append(handler.forwardUpgradeHeadersConfig.regexAllowList, re)
			}
		}
		handler.forwardUpgradeHeadersConfig.withStaticAllowList = len(handler.forwardUpgradeHeadersConfig.staticAllowList) > 0
		handler.forwardUpgradeHeadersConfig.withRegexAllowList = len(handler.forwardUpgradeHeadersConfig.regexAllowList) > 0
	}
	if opts.WebSocketConfiguration.ForwardUpgradeQueryParams.Enabled {
		handler.forwardQueryParamsConfig.enabled = true
		for _, str := range opts.WebSocketConfiguration.ForwardUpgradeQueryParams.AllowList {
			if detectNonRegex.MatchString(str) {
				handler.forwardQueryParamsConfig.staticAllowList = append(handler.forwardQueryParamsConfig.staticAllowList, str)
			} else {
				re, err := regexp.Compile(str)
				if err != nil {
					opts.Logger.Warn("Invalid regex in forward upgrade query params allow list", zap.String("regex", str), zap.Error(err))
					continue
				}
				handler.forwardQueryParamsConfig.regexAllowList = append(handler.forwardQueryParamsConfig.regexAllowList, re)
			}
		}
		handler.forwardQueryParamsConfig.withStaticAllowList = len(handler.forwardQueryParamsConfig.staticAllowList) > 0
		handler.forwardQueryParamsConfig.withRegexAllowList = len(handler.forwardQueryParamsConfig.regexAllowList) > 0
	}
	if opts.EnableNetPoll {
		poller, err := netpoll.NewPoller(opts.NetPollConnBufferSize, opts.NetPollTimeout)
		if err == nil {
			opts.Logger.Debug("Net poller is available")

			handler.netPoll = poller
			handler.connections = make(map[int]*WebSocketConnectionHandler)
			go handler.runPoller()
		}

	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !websocket.IsWebSocketUpgrade(r) {
				next.ServeHTTP(w, r)
				return
			}
			handler.handleUpgradeRequest(w, r)
		})
	}
}

// wsConnectionWrapper is a wrapper around websocket.Conn that allows
// writing from multiple goroutines
type wsConnectionWrapper struct {
	conn         net.Conn
	mu           sync.Mutex
	readTimeout  time.Duration
	writeTimeout time.Duration

	// Compression and takeover mode negotiated for this connection.
	compression compressionMode

	// Persistent compression state (only used with context takeover)
	compressBuf *bytes.Buffer
	compressor  *stdflate.Writer

	// Persistent decompression state (only used with context takeover)
	decompressor   io.ReadCloser
	decompressDict []byte
}

func newWSConnectionWrapper(conn net.Conn, readTimeout, writeTimeout time.Duration, compression compressionMode) (*wsConnectionWrapper, error) {
	w := &wsConnectionWrapper{
		conn:         conn,
		readTimeout:  readTimeout,
		writeTimeout: writeTimeout,
		compression:  compression,
	}

	// Initialize persistent compression state only if context takeover is enabled
	if compression.enabled && compression.serverContextTakeover {
		w.compressBuf = new(bytes.Buffer)
		var err error
		// stdflate: see the package-level note on the two DEFLATE
		// implementations. kpflate would not reference the shared window for
		// small messages at levels <= 6, defeating context takeover.
		w.compressor, err = stdflate.NewWriter(w.compressBuf, compression.level)
		if err != nil {
			return nil, fmt.Errorf("failed to create flate compressor: %w", err)
		}
	}

	if compression.enabled && compression.clientContextTakeover {
		w.decompressor = kpflate.NewReader(bytes.NewReader(nil))
		w.decompressDict = make([]byte, 0, 1<<compression.clientWindowBits)
	}

	return w, nil
}

func (c *wsConnectionWrapper) ReadJSON(v any) error {
	if err := c.setReadDeadline(); err != nil {
		return err
	}

	text, err := c.readJSONPayload()
	if err != nil {
		return err
	}

	return json.Unmarshal(text, v)
}

func (c *wsConnectionWrapper) setReadDeadline() error {
	if c.readTimeout <= 0 {
		return nil
	}
	return c.conn.SetReadDeadline(time.Now().Add(c.readTimeout))
}

func (c *wsConnectionWrapper) readJSONPayload() ([]byte, error) {
	if !c.compression.enabled {
		return wsutil.ReadClientText(c.conn)
	}

	payload, _, isCompressed, err := c.readDataFrames()
	if err != nil {
		return nil, err
	}

	if !isCompressed {
		return payload, nil
	}

	return c.decompressPayload(payload)
}

func (c *wsConnectionWrapper) readDataFrames() ([]byte, ws.OpCode, bool, error) {
	// Read frames directly and handle compression, buffering fragmented messages.
	controlHandler := wsutil.ControlFrameHandler(c.conn, ws.StateServerSide)
	var (
		frame        ws.Frame
		payload      []byte
		isCompressed bool
		op           ws.OpCode
		started      bool
		err          error
	)

	for {
		frame, err = ws.ReadFrame(c.conn)
		if err != nil {
			return nil, 0, false, err
		}

		// RFC 6455 §5.1: all client-to-server frames MUST be masked.
		if !frame.Header.Masked {
			return nil, 0, false, fmt.Errorf("received unmasked frame (opcode %v)", frame.Header.OpCode)
		}
		ws.Cipher(frame.Payload, frame.Header.Mask, 0)

		if frame.Header.OpCode.IsControl() {
			if err := controlHandler(frame.Header, bytes.NewReader(frame.Payload)); err != nil {
				return nil, 0, false, err
			}
			continue
		}

		if !started {
			// First data frame must be text or binary.
			if frame.Header.OpCode != ws.OpText && frame.Header.OpCode != ws.OpBinary {
				continue
			}
			op = frame.Header.OpCode
			started = true
			// Per RFC 7692, the RSV1 compression bit is only set on the first frame.
			isCompressed, err = wsflate.IsCompressed(frame.Header)
			if err != nil {
				return nil, 0, false, err
			}
		} else if frame.Header.OpCode != ws.OpContinuation {
			// After the first frame, we expect continuation frames until FIN.
			return nil, 0, false, fmt.Errorf("unexpected opcode %v while waiting for continuation", frame.Header.OpCode)
		}

		// Buffer the payload from this frame.
		payload = append(payload, frame.Payload...)

		// Check if this is the final frame.
		if frame.Header.Fin {
			return payload, op, isCompressed, nil
		}
	}
}

func (c *wsConnectionWrapper) decompressPayload(payload []byte) ([]byte, error) {
	if c.compression.clientContextTakeover {
		// Use persistent decompressor with dictionary for context takeover.
		return c.decompressWithContextTakeover(payload)
	}
	return decompressNoContextTakeover(payload)
}

// decompressNoContextTakeover decompresses a self-contained message using a
// pooled flate reader. Resetting with an empty dictionary guarantees no state
// crosses messages or connections.
func decompressNoContextTakeover(payload []byte) ([]byte, error) {
	fr := flateReaderPool.Get().(io.ReadCloser)
	resetter, ok := fr.(kpflate.Resetter)
	if !ok {
		return nil, errors.New("flate reader does not implement flate.Resetter")
	}
	if err := resetter.Reset(io.MultiReader(bytes.NewReader(payload), bytes.NewReader(flateReadTail)), nil); err != nil {
		return nil, err
	}

	var decompressed bytes.Buffer
	if _, err := io.Copy(&decompressed, fr); err != nil {
		// The reader state is undefined after an error; drop it instead of
		// returning it to the pool.
		return nil, err
	}
	flateReaderPool.Put(fr)

	return decompressed.Bytes(), nil
}

// decompressWithContextTakeover decompresses data using the persistent decompressor,
// maintaining dictionary state across messages for better decompression.
func (c *wsConnectionWrapper) decompressWithContextTakeover(compressed []byte) ([]byte, error) {
	// Reset the decompressor to read from the new compressed data followed by
	// the RFC 7692 read tail, using the accumulated dictionary.
	if resetter, ok := c.decompressor.(kpflate.Resetter); ok {
		src := io.MultiReader(bytes.NewReader(compressed), bytes.NewReader(flateReadTail))
		if err := resetter.Reset(src, c.decompressDict); err != nil {
			return nil, err
		}
	}

	// Read all decompressed data
	var decompressed bytes.Buffer
	if _, err := io.Copy(&decompressed, c.decompressor); err != nil {
		return nil, err
	}

	// Update the dictionary with the decompressed data (keep last 32KB per DEFLATE spec)
	c.updateDecompressDict(decompressed.Bytes())

	return decompressed.Bytes(), nil
}

// updateDecompressDict updates the decompression dictionary with new data.
// The dictionary is capped to the negotiated client window size (1 << clientWindowBits).
func (c *wsConnectionWrapper) updateDecompressDict(data []byte) {
	maxDictSize := 1 << c.compression.clientWindowBits

	if len(data) >= maxDictSize {
		c.decompressDict = make([]byte, maxDictSize)
		copy(c.decompressDict, data[len(data)-maxDictSize:])
	} else {
		c.decompressDict = append(c.decompressDict, data...)
		if len(c.decompressDict) > maxDictSize {
			c.decompressDict = c.decompressDict[len(c.decompressDict)-maxDictSize:]
		}
	}
}

func (c *wsConnectionWrapper) WriteText(text string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.writeTimeout > 0 {
		err := c.conn.SetWriteDeadline(time.Now().Add(c.writeTimeout))
		if err != nil {
			return err
		}
	}

	if c.compression.enabled {
		return c.writeCompressed([]byte(text))
	}

	return wsutil.WriteServerText(c.conn, []byte(text))
}

func (c *wsConnectionWrapper) WriteJSON(v any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}

	if c.writeTimeout > 0 {
		err := c.conn.SetWriteDeadline(time.Now().Add(c.writeTimeout))
		if err != nil {
			return err
		}
	}

	if c.compression.enabled {
		return c.writeCompressed(data)
	}

	return wsutil.WriteServerText(c.conn, data)
}

// writeCompressed writes data with compression. Must be called with the mutex held.
func (c *wsConnectionWrapper) writeCompressed(data []byte) error {
	if c.compression.serverContextTakeover {
		return c.writeCompressedWithContextTakeover(data)
	}
	return c.writeCompressedNoContextTakeover(data)
}

// writeCompressedNoContextTakeover compresses data as an independent DEFLATE
// stream using a pooled flate.Writer. Resetting the writer provides the empty
// LZ77 window RFC 7692 requires per message in this mode, so no state crosses
// messages or connections.
func (c *wsConnectionWrapper) writeCompressedNoContextTakeover(data []byte) error {
	fw, pool, err := pooledFlateWriter(c.compression.level)
	if err != nil {
		return err
	}

	var buf bytes.Buffer
	fw.Reset(&buf)
	if _, err := fw.Write(data); err != nil {
		// The writer state is undefined after an error; drop it instead of
		// returning it to the pool.
		return err
	}
	if err := fw.Flush(); err != nil {
		return err
	}
	pool.Put(fw)

	return c.writeCompressedFrame(buf.Bytes())
}

// writeCompressedWithContextTakeover compresses data while preserving dictionary state
// between messages for better compression ratios.
func (c *wsConnectionWrapper) writeCompressedWithContextTakeover(data []byte) error {
	// Reset buffer but NOT the compressor - this preserves the dictionary
	c.compressBuf.Reset()

	if _, err := c.compressor.Write(data); err != nil {
		return err
	}
	if err := c.compressor.Flush(); err != nil {
		return err
	}

	return c.writeCompressedFrame(c.compressBuf.Bytes())
}

// writeCompressedFrame removes the trailing sync marker (0x00 0x00 0xff 0xff)
// per RFC 7692 when present and writes the result as a final text frame with
// the RSV1 bit set.
func (c *wsConnectionWrapper) writeCompressedFrame(compressed []byte) error {
	if len(compressed) >= 4 &&
		compressed[len(compressed)-4] == 0x00 &&
		compressed[len(compressed)-3] == 0x00 &&
		compressed[len(compressed)-2] == 0xff &&
		compressed[len(compressed)-1] == 0xff {
		compressed = compressed[:len(compressed)-4]
	}

	frame := ws.NewFrame(ws.OpText, true, compressed)
	frame.Header.Rsv = ws.Rsv(true, false, false) // Set RSV1 bit for compression
	return ws.WriteFrame(c.conn, frame)
}

func (c *wsConnectionWrapper) WriteCloseFrame(code ws.StatusCode, reason string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.writeTimeout > 0 {
		err := c.conn.SetWriteDeadline(time.Now().Add(c.writeTimeout))
		if err != nil {
			return err
		}
	}

	return ws.WriteFrame(c.conn, ws.NewCloseFrame(ws.NewCloseFrameBody(code, reason)))
}

func (c *wsConnectionWrapper) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.compressor != nil {
		_ = c.compressor.Close()
	}
	if c.decompressor != nil {
		_ = c.decompressor.Close()
	}
	return c.conn.Close()
}

type WebsocketHandler struct {
	ctx                context.Context
	config             *config.WebSocketConfiguration
	operationProcessor *OperationProcessor
	operationBlocker   *OperationBlocker
	planner            *OperationPlanner
	graphqlHandler     *GraphQLHandler
	preHandler         *PreHandler
	metrics            RouterMetrics
	accessController   *AccessController
	logger             *zap.Logger

	netPoll       netpoll.Poller
	connections   map[int]*WebSocketConnectionHandler
	connectionsMu sync.RWMutex

	stats statistics.EngineStatistics

	readTimeout  time.Duration
	writeTimeout time.Duration

	absintheHandlerEnabled bool
	absintheHandlerPath    string

	forwardUpgradeHeadersConfig forwardConfig
	forwardQueryParamsConfig    forwardConfig
	clientHeader                config.ClientHeader

	disableVariablesRemapping bool

	apolloCompatibilityFlags config.ApolloCompatibilityFlags

	compression compressionMode
}

func (h *WebsocketHandler) configureCompressionNegotiation(upgrader *ws.HTTPUpgrader) *wsflate.Extension {
	if !h.compression.enabled {
		return nil
	}

	ext := &wsflate.Extension{
		Parameters: wsflate.Parameters{
			ServerNoContextTakeover: true,
			ClientNoContextTakeover: true,
			// Accept any client offer for server_max_window_bits (up to 15).
			ServerMaxWindowBits: 15,
		},
	}
	upgrader.Negotiate = func(opt httphead.Option) (accept httphead.Option, err error) {
		accept, err = ext.Negotiate(opt)
		if err != nil || accept.Size() == 0 {
			return accept, err
		}

		params, accepted := ext.Accepted()
		if !accepted {
			return accept, nil
		}

		response := wsflate.Parameters{
			// Mirror no_context_takeover only when explicitly requested by the client.
			ServerNoContextTakeover: params.ServerNoContextTakeover,
			ClientNoContextTakeover: params.ClientNoContextTakeover,
			// Go's compress/flate always uses a 32 KB window (bits=15).
			ServerMaxWindowBits: 15,
		}

		// RFC 7692 §7.1.2.2: only include client_max_window_bits in the
		// response when the client included it in the offer.
		if params.ClientMaxWindowBits.Defined() {
			configBits := wsflate.WindowBits(h.compression.clientWindowBits)
			// Use the more restrictive of the client's offer and server config.
			// ClientMaxWindowBits == 1 means "parameter present, no value" —
			// the client accepts any server-chosen value.
			if params.ClientMaxWindowBits == 1 || configBits < params.ClientMaxWindowBits {
				response.ClientMaxWindowBits = configBits
			} else {
				response.ClientMaxWindowBits = params.ClientMaxWindowBits
			}
		}

		return response.Option(), nil
	}

	return ext
}

func resolveNegotiatedCompression(base compressionMode, ext *wsflate.Extension, upgradeErr error) compressionMode {
	if ext == nil || upgradeErr != nil {
		return compressionMode{
			enabled: false,
			level:   base.level,
		}
	}
	params, accepted := ext.Accepted()
	if !accepted {
		return compressionMode{
			enabled: false,
			level:   base.level,
		}
	}
	// Derive the effective client window bits from the negotiation.
	// If the client offered client_max_window_bits, use min(offer, config);
	// otherwise fall back to the configured default.
	clientWindowBits := base.clientWindowBits
	if params.ClientMaxWindowBits.Defined() && params.ClientMaxWindowBits > 1 {
		if int(params.ClientMaxWindowBits) < clientWindowBits {
			clientWindowBits = int(params.ClientMaxWindowBits)
		}
	}

	// Context takeover remains enabled when no_context_takeover is not requested.
	return compressionMode{
		enabled:               true,
		level:                 base.level,
		serverContextTakeover: !params.ServerNoContextTakeover,
		clientContextTakeover: !params.ClientNoContextTakeover,
		clientWindowBits:      clientWindowBits,
	}
}

func (h *WebsocketHandler) handleUpgradeRequest(w http.ResponseWriter, r *http.Request) {
	var subProtocol string

	requestID := middleware.GetReqID(r.Context())
	requestContext := getRequestContext(r.Context())

	requestLogger := h.logger.With(logging.WithRequestID(requestID), logging.WithTraceID(rtrace.GetTraceID(r.Context())))
	if batchedOperationId, ok := r.Context().Value(BatchedOperationId{}).(string); ok {
		requestLogger = requestLogger.With(logging.WithBatchedRequestOperationID(batchedOperationId))
	}
	clientInfo := NewClientInfoFromRequest(r, h.clientHeader)

	if h.accessController != nil && !h.config.Authentication.FromInitialPayload.Enabled {
		// Check access control before upgrading the connection
		validatedReq, err := h.accessController.Access(w, r)
		if err != nil {
			statusCode := http.StatusForbidden
			if errors.Is(err, ErrUnauthorized) {
				statusCode = http.StatusUnauthorized
			}
			http.Error(w, http.StatusText(statusCode), statusCode)
			return
		}
		r = validatedReq

		requestContext.expressionContext.Request.Auth = expr.LoadAuth(r.Context())
	}

	upgrader := ws.HTTPUpgrader{
		Timeout: time.Second * 5,
		Protocol: func(s string) bool {
			if wsproto.IsSupportedSubprotocol(s) {
				subProtocol = s
				return true
			}
			return false
		},
	}

	compressionExt := h.configureCompressionNegotiation(&upgrader)

	c, _, _, err := upgrader.Upgrade(r, w)
	connectionCompression := resolveNegotiatedCompression(h.compression, compressionExt, err)

	if err != nil {
		requestLogger.Warn("Websocket upgrade", zap.Error(err))
		_ = c.Close()
		return
	}

	// legacy absinthe clients don't set the Sec-WebSocket-Protocol header (Subprotocol)
	// so we need to check the path to determine if it's an absinthe client and set the subprotocol manually
	if subProtocol == "" && h.absintheHandlerEnabled && r.URL.Path == h.absintheHandlerPath {
		subProtocol = wsproto.AbsintheWSSubProtocol
	}

	// After successful upgrade, we can't write to the response writer anymore
	// because it's hijacked by the websocket connection

	conn, err := newWSConnectionWrapper(c, h.readTimeout, h.writeTimeout, connectionCompression)
	if err != nil {
		requestLogger.Error("Create websocket connection wrapper", zap.Error(err))
		_ = c.Close()
		return
	}
	protocol, err := wsproto.NewProtocol(subProtocol, conn)
	if err != nil {
		requestLogger.Error("Create websocket protocol", zap.Error(err))
		_ = c.Close()
		return
	}

	// We can parse the request options before creating the handler
	// this avoids touching the client request across goroutines

	executionOptions, traceOptions, err := h.preHandler.parseExecutionAndTraceOptions(r, clientInfo, requestLogger)
	if err != nil {
		requestLogger.Error("Parse request options", zap.Error(err))
		_ = c.Close()
		return
	}

	planOptions := PlanOptions{
		ClientInfo:           clientInfo,
		TraceOptions:         traceOptions,
		ExecutionOptions:     executionOptions,
		TrackSchemaUsageInfo: h.preHandler.trackSchemaUsageInfo,
	}

	handler := NewWebsocketConnectionHandler(h.ctx, WebSocketConnectionHandlerOptions{
		ClientInfoFromInitialPayload: h.config.ClientInfoFromInitialPayload,
		ForwardInitialPayload:        h.config.ForwardInitialPayload,
		OperationProcessor:           h.operationProcessor,
		OperationBlocker:             h.operationBlocker,
		Planner:                      h.planner,
		GraphQLHandler:               h.graphqlHandler,
		PreHandler:                   h.preHandler,
		Metrics:                      h.metrics,
		PlanOptions:                  planOptions,
		ResponseWriter:               w,
		Request:                      r,
		Connection:                   conn,
		Protocol:                     protocol,
		Logger:                       requestLogger,
		Stats:                        h.stats,
		ConnectionID:                 resolve.NewConnectionID(),
		ClientInfo:                   clientInfo,
		InitRequestID:                requestID,
		ForwardUpgradeHeaders:        h.forwardUpgradeHeadersConfig,
		ForwardQueryParams:           h.forwardQueryParamsConfig,
		DisableVariablesRemapping:    h.disableVariablesRemapping,
		ApolloCompatibilityFlags:     h.apolloCompatibilityFlags,
	})
	err = handler.Initialize()
	if err != nil {

		// Don't produce errors logs here because it can only be client side errors
		// e.g. slow client, aborted connection, invalid JSON, etc.
		// We log it as debug because it's not a server side error

		requestLogger.Debug("Initializing websocket connection", zap.Error(err))

		handler.Close(false, wsproto.CloseKindOf(err))
		return
	}

	// Authenticate the connection using the initial payload
	fromInitialPayloadConfig := h.config.Authentication.FromInitialPayload
	if fromInitialPayloadConfig.Enabled {
		// Setting the initialPayload in the context to be used by the websocketInitialPayloadAuthenticator
		r = r.WithContext(authentication.WithWebsocketInitialPayloadContextKey(r.Context(), handler.initialPayload))

		// Later check access control after initial payload is read and set into the context
		if h.accessController != nil {
			handler.request, err = h.accessController.Access(w, r)
			if err != nil {
				statusCode := http.StatusForbidden
				errorMessage := err
				if errors.Is(err, ErrUnauthorized) {
					statusCode = http.StatusUnauthorized
					errorMessage = ErrUnauthorized
				}
				http.Error(handler.w, http.StatusText(statusCode), statusCode)
				_ = handler.writeErrorMessage(requestID, errorMessage)
				handler.Close(false, wsproto.CloseKindNormal)
				return
			}
		}

		// Export the token from the initial payload to the request header
		if fromInitialPayloadConfig.ExportToken.Enabled {
			var initialPayloadMap map[string]any
			err := json.Unmarshal(handler.initialPayload, &initialPayloadMap)
			if err != nil {
				requestLogger.Error("Error parsing initial payload: %v", zap.Error(err))
				_ = handler.writeErrorMessage(requestID, err)
				handler.Close(false, wsproto.CloseKindNormal)
				return
			}
			jwtToken, ok := initialPayloadMap[fromInitialPayloadConfig.Key].(string)
			if !ok {
				err := fmt.Errorf("invalid JWT token in initial payload: JWT token is not a string")
				requestLogger.Error(err.Error())
				_ = handler.writeErrorMessage(requestID, err)
				handler.Close(false, wsproto.CloseKindNormal)
				return
			}
			handler.request.Header.Set(fromInitialPayloadConfig.ExportToken.HeaderKey, jwtToken)
		}

		requestContext.expressionContext.Request.Auth = expr.LoadAuth(handler.request.Context())
	}

	// Only when epoll/kqueue is available. On Windows, epoll is not available
	if h.netPoll != nil {
		err = h.addConnection(c, handler)
		if err != nil {
			requestLogger.Error("Adding connection to net poller", zap.Error(err))
			handler.Close(true, wsproto.CloseKindNormal)
		}
		return
	}

	// Handle messages sync when net poller implementation is not available

	go h.handleConnectionSync(handler)
}

func (h *WebsocketHandler) handleConnectionSync(handler *WebSocketConnectionHandler) {
	h.stats.ConnectionsInc()
	defer h.stats.ConnectionsDec()
	serverDone := h.ctx.Done()

	for {
		select {
		case <-serverDone:
			handler.Close(true, wsproto.CloseKindGoingAway)
			return
		default:
			msg, err := handler.protocol.ReadMessage()
			if err != nil {
				if isReadTimeout(err) {
					continue
				}
				h.logger.Debug("Client closed connection", zap.Error(err))
				handler.Close(true, wsproto.CloseKindOf(err))
				return
			}
			err = h.HandleMessage(handler, msg)
			if err != nil {
				h.logger.Debug("Handling websocket message", zap.Error(err))
				var closeErr *wsproto.CloseError
				if errors.As(err, &closeErr) {
					handler.Close(true, closeErr.Kind)
					return
				}
			}
		}
	}
}

func (h *WebsocketHandler) addConnection(conn net.Conn, handler *WebSocketConnectionHandler) error {
	h.stats.ConnectionsInc()
	h.connectionsMu.Lock()
	defer h.connectionsMu.Unlock()
	fd := socketFd(conn)
	if fd == 0 {
		return fmt.Errorf("unable to get socket fd for conn: %d", handler.connectionID)
	}
	h.connections[fd] = handler
	return h.netPoll.Add(underlyingConn(conn))
}

func (h *WebsocketHandler) removeConnection(conn net.Conn, handler *WebSocketConnectionHandler, fd int, closeKind wsproto.CloseKind) {
	h.stats.ConnectionsDec()
	h.connectionsMu.Lock()
	delete(h.connections, fd)
	h.connectionsMu.Unlock()
	err := h.netPoll.Remove(conn)
	if err != nil {
		h.logger.Warn("Removing connection from net poller", zap.Error(err))
	}
	handler.Close(true, closeKind)
}

// underlyingConn unwraps a *tls.Conn to the network connection it wraps. wss
// connections are presented as *tls.Conn, which implements neither syscall.Conn
// nor netpoll.ConnImpl, so its socket fd can only be resolved via the underlying
// connection. Non-TLS connections are returned unchanged.
func underlyingConn(conn net.Conn) net.Conn {
	if tlsConn, ok := conn.(*tls.Conn); ok {
		return tlsConn.NetConn()
	}
	return conn
}

func socketFd(conn net.Conn) int {
	conn = underlyingConn(conn)
	if con, ok := conn.(syscall.Conn); ok {
		raw, err := con.SyscallConn()
		if err != nil {
			return 0
		}
		sfd := 0
		_ = raw.Control(func(fd uintptr) {
			sfd = int(fd)
		})
		return sfd
	}
	if con, ok := conn.(netpoll.ConnImpl); ok {
		return con.GetFD()
	}
	return 0
}

func isReadTimeout(err error) bool {
	if err == nil {
		return false
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return netErr.Timeout()
	}
	return false
}

func (h *WebsocketHandler) runPoller() {
	done := h.ctx.Done()
	defer func() {
		_ = h.netPoll.Close(false)
	}()
	for {
		select {
		case <-done:
			h.closeAllConnections()
			return
		default:
			connections, err := h.netPoll.Wait(128)
			if err != nil {
				h.logger.Warn("Net Poller wait", zap.Error(err))
				continue
			}
			for i := range len(connections) {
				if connections[i] == nil {
					continue
				}
				conn := connections[i].(netpoll.ConnImpl)
				// check if the connection is still valid
				fd := socketFd(conn)
				h.connectionsMu.RLock()
				handler, exists := h.connections[fd]
				h.connectionsMu.RUnlock()

				if !exists {
					h.logger.Debug("Connection not found", zap.Int("fd", fd))
					continue
				}

				if fd == 0 {
					h.logger.Debug("Invalid socket fd", zap.Int("fd", fd))
					h.removeConnection(conn, handler, fd, wsproto.CloseKindNormal)
					continue
				}

				msg, err := handler.protocol.ReadMessage()
				if err != nil {
					if isReadTimeout(err) {
						continue
					}
					h.logger.Debug("Client closed connection", zap.Error(err))
					h.removeConnection(conn, handler, fd, wsproto.CloseKindOf(err))
					continue
				}
				err = h.HandleMessage(handler, msg)
				if err != nil {
					h.logger.Debug("Handling websocket message", zap.Error(err))

					// Only closeErr closes, which is why we're not using wsproto.CloseKindOf,
					// which defaults to CloseKindNormal
					var closeErr *wsproto.CloseError
					if errors.As(err, &closeErr) {
						h.removeConnection(conn, handler, fd, closeErr.Kind)
						continue
					}
				}
			}
		}
	}
}

func (h *WebsocketHandler) closeAllConnections() {
	h.connectionsMu.Lock()
	handlers := make([]*WebSocketConnectionHandler, 0, len(h.connections))
	for fd, handler := range h.connections {
		handlers = append(handlers, handler)
		delete(h.connections, fd)
	}
	h.connectionsMu.Unlock()

	for _, handler := range handlers {
		h.stats.ConnectionsDec()
		handler.Close(true, wsproto.CloseKindGoingAway)
	}
}

type websocketResponseWriter struct {
	id              string
	protocol        wsproto.Proto
	header          http.Header
	buf             bytes.Buffer
	writtenBytes    int
	logger          *zap.Logger
	stats           statistics.EngineStatistics
	propagateErrors bool
	subscriptions   *sync.Map
}

var (
	_ http.ResponseWriter                = (*websocketResponseWriter)(nil)
	_ resolve.SubscriptionResponseWriter = (*websocketResponseWriter)(nil)
)

func newWebsocketResponseWriter(id string, protocol wsproto.Proto, propagateErrors bool, logger *zap.Logger, stats statistics.EngineStatistics, subscriptions *sync.Map) *websocketResponseWriter {
	return &websocketResponseWriter{
		id:              id,
		protocol:        protocol,
		header:          make(http.Header),
		logger:          logger.With(zap.String("subscription_id", id)),
		stats:           stats,
		propagateErrors: propagateErrors,
		subscriptions:   subscriptions,
	}
}

func (rw *websocketResponseWriter) Header() http.Header {
	return rw.header
}

func (rw *websocketResponseWriter) WriteHeader(statusCode int) {
	rw.logger.Debug("Response status code", zap.Int("status_code", statusCode))
}

func (rw *websocketResponseWriter) Complete() {
	if rw.subscriptions != nil {
		rw.subscriptions.Delete(rw.id)
	}
	err := rw.protocol.Complete(rw.id)
	if err != nil {
		rw.logger.Debug("Sending complete message", zap.Error(err))
	}
}

// Heartbeat is a no-op function for WebSocket subscriptions.
func (rw *websocketResponseWriter) Heartbeat() error {
	return nil
}

// Error delivers a terminal error payload. The subscription will not
// produce any further messages after this call, so protocols that need
// an explicit termination frame (subscriptions-transport-ws: complete
// after data+errors) emit it here. Non-terminal per-update errors must
// use Flush with errors buffered via Write, which keeps the subscription
// alive.
func (rw *websocketResponseWriter) Error(data []byte) {
	if rw.subscriptions != nil {
		rw.subscriptions.Delete(rw.id)
	}
	var errors json.RawMessage
	if rw.propagateErrors {
		errorsResult := gjson.GetBytes(data, "errors")
		if errorsResult.Type == gjson.JSON {
			errors = json.RawMessage(errorsResult.Raw)
		} else {
			errors = data
		}
	} else {
		errors = json.RawMessage(`[{"message":"Unable to subscribe"}]`)
	}
	if err := rw.protocol.WriteGraphQLErrors(rw.id, errors, nil); err != nil {
		rw.logger.Debug("Sending error message", zap.Error(err))
		return
	}
	// subscriptions-transport-ws clients rely on an explicit "complete" to end
	// the stream after a data+errors frame. graphql-transport-ws treats the
	// "error" frame as terminal per spec, so no follow-up is needed there.
	if rw.protocol.Subprotocol() == wsproto.SubscriptionsTransportWSSubprotocol {
		if err := rw.protocol.Complete(rw.id); err != nil {
			rw.logger.Debug("Sending complete after error", zap.Error(err))
		}
	}
}

func (rw *websocketResponseWriter) Write(data []byte) (int, error) {
	rw.writtenBytes += len(data)
	return rw.buf.Write(data)
}

func (rw *websocketResponseWriter) Flush() error {
	if rw.buf.Len() > 0 {
		payload := rw.buf.Bytes()
		var extensions []byte
		var err error
		if len(rw.header) > 0 {
			extensions, err = json.Marshal(map[string]any{
				"response_headers": rw.header,
			})
			if err != nil {
				rw.logger.Warn("Serializing response headers", zap.Error(err))
				return err
			}
		}

		// Errors inside the buffered payload are emitted inline as part of the
		// execution result (a non-terminal "next"/"data" frame) so the
		// subscription stays alive. Terminal errors go through Error, which uses
		// the protocol-level error frame.
		if !rw.propagateErrors {
			if errorsResult := gjson.GetBytes(payload, "errors"); errorsResult.Type == gjson.JSON {
				payload, _ = sjson.SetRawBytes(payload, "errors", []byte(`[{"message":"Unable to subscribe"}]`))
			}
		}

		err = rw.protocol.WriteGraphQLData(rw.id, payload, extensions)
		rw.buf.Reset()
		if err != nil {
			return err
		}
	}
	return nil
}

func (rw *websocketResponseWriter) SubscriptionResponseWriter() resolve.SubscriptionResponseWriter {
	return rw
}

type graphqlError struct {
	Message    string      `json:"message"`
	Extensions *Extensions `json:"extensions,omitempty"`
}

type WebSocketConnectionHandlerOptions struct {
	ClientInfoFromInitialPayload config.WebSocketClientInfoFromInitialPayloadConfiguration
	ForwardInitialPayload        bool
	OperationProcessor           *OperationProcessor
	OperationBlocker             *OperationBlocker
	Planner                      *OperationPlanner
	GraphQLHandler               *GraphQLHandler
	PreHandler                   *PreHandler
	Metrics                      RouterMetrics
	ResponseWriter               http.ResponseWriter
	Request                      *http.Request
	Connection                   *wsConnectionWrapper
	Protocol                     wsproto.Proto
	Logger                       *zap.Logger
	Stats                        statistics.EngineStatistics
	PlanOptions                  PlanOptions
	ConnectionID                 resolve.ConnectionID
	ClientInfo                   *ClientInfo
	InitRequestID                string
	ForwardUpgradeHeaders        forwardConfig
	ForwardQueryParams           forwardConfig
	DisableVariablesRemapping    bool
	ApolloCompatibilityFlags     config.ApolloCompatibilityFlags
}

type WebSocketConnectionHandler struct {
	ctx                context.Context
	operationProcessor *OperationProcessor
	operationBlocker   *OperationBlocker
	planner            *OperationPlanner
	graphqlHandler     *GraphQLHandler
	plannerOptions     PlanOptions
	preHandler         *PreHandler
	metrics            RouterMetrics
	w                  http.ResponseWriter
	// request is the original client request. It is not safe for concurrent use.
	// You have to clone it before using it in a goroutine.
	request    *http.Request
	conn       *wsConnectionWrapper
	protocol   wsproto.Proto
	clientInfo *ClientInfo
	logger     *zap.Logger

	initialPayload            json.RawMessage
	upgradeRequestHeaders     json.RawMessage
	upgradeRequestQueryParams json.RawMessage

	initRequestID   string
	connectionID    resolve.ConnectionID
	subscriptionIDs atomic.Int64
	subscriptions   sync.Map
	stats           statistics.EngineStatistics

	forwardInitialPayload bool

	forwardUpgradeHeaders *forwardConfig
	forwardQueryParams    *forwardConfig

	disableVariablesRemapping bool

	apolloCompatibilityFlags config.ApolloCompatibilityFlags

	clientInfoFromInitialPayload config.WebSocketClientInfoFromInitialPayloadConfiguration
}

type forwardConfig struct {
	enabled             bool
	withStaticAllowList bool
	staticAllowList     []string
	withRegexAllowList  bool
	regexAllowList      []*regexp.Regexp
}

var detectNonRegex = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func NewWebsocketConnectionHandler(ctx context.Context, opts WebSocketConnectionHandlerOptions) *WebSocketConnectionHandler {
	return &WebSocketConnectionHandler{
		ctx:                          ctx,
		operationProcessor:           opts.OperationProcessor,
		operationBlocker:             opts.OperationBlocker,
		planner:                      opts.Planner,
		graphqlHandler:               opts.GraphQLHandler,
		preHandler:                   opts.PreHandler,
		metrics:                      opts.Metrics,
		w:                            opts.ResponseWriter,
		request:                      opts.Request,
		conn:                         opts.Connection,
		protocol:                     opts.Protocol,
		logger:                       opts.Logger,
		connectionID:                 opts.ConnectionID,
		stats:                        opts.Stats,
		clientInfo:                   opts.ClientInfo,
		initRequestID:                opts.InitRequestID,
		forwardUpgradeHeaders:        &opts.ForwardUpgradeHeaders,
		forwardQueryParams:           &opts.ForwardQueryParams,
		forwardInitialPayload:        opts.ForwardInitialPayload,
		plannerOptions:               opts.PlanOptions,
		disableVariablesRemapping:    opts.DisableVariablesRemapping,
		apolloCompatibilityFlags:     opts.ApolloCompatibilityFlags,
		clientInfoFromInitialPayload: opts.ClientInfoFromInitialPayload,
	}
}

func (h *WebSocketConnectionHandler) requestError(err error) error {
	if errors.As(err, &wsutil.ClosedError{}) {
		h.logger.Debug("Client closed connection")
		return err
	}
	h.logger.Warn("Handling websocket connection", zap.Error(err))
	return h.conn.WriteText(err.Error())
}

func (h *WebSocketConnectionHandler) writeErrorMessage(operationID string, err error) error {
	var gqlErr graphqlError

	var poNotFoundErr *persistedoperation.PersistentOperationNotFoundError
	switch {
	case errors.As(err, &poNotFoundErr):
		// We follow the same pattern of not mentioning the sha256hash
		// in the normal http requests for the same case
		gqlErr = graphqlError{
			Message: "PersistedQueryNotFound",
			Extensions: &Extensions{
				Code: ExtCodeErrPersistedQueryNotFound,
			},
		}
	default:
		gqlErr = graphqlError{Message: err.Error()}
	}

	payload, err := json.Marshal([]graphqlError{gqlErr})
	if err != nil {
		return fmt.Errorf("encoding GraphQL errors: %w", err)
	}
	return h.protocol.WriteGraphQLErrors(operationID, payload, nil)
}

func (h *WebSocketConnectionHandler) parseAndPlan(registration *SubscriptionRegistration) (*ParsedOperation, *operationContext, error) {
	operationKit, err := h.operationProcessor.NewKit()
	if err != nil {
		return nil, nil, err
	}
	defer operationKit.Free()

	opContext := &operationContext{
		clientInfo: h.plannerOptions.ClientInfo,
	}

	if err := operationKit.UnmarshalOperationFromBody(registration.msg.Payload); err != nil {
		return nil, nil, err
	}

	opContext.extensions = operationKit.parsedOperation.Request.Extensions

	var (
		skipParse bool
		isApq     bool
	)

	if h.shouldComputeOperationSha256(operationKit) {
		err = operationKit.ComputeOperationSha256()
		if err != nil {
			return nil, nil, err
		}

		// Ensure if operation has both hash and query, that the hash matches the query
		if operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.HasHash() && operationKit.parsedOperation.Request.Query != "" {
			if operationKit.parsedOperation.Sha256Hash != operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash {
				return nil, nil, errors.New("persistedQuery sha256 hash does not match query body")
			}
		}

		if h.operationBlocker.safelistEnabled || h.operationBlocker.logUnknownOperationsEnabled {
			// Set the request hash to the parsed hash, to see if it matches a persisted operation
			operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery = &GraphQLRequestExtensionsPersistedQuery{
				Sha256Hash: operationKit.parsedOperation.Sha256Hash,
			}
		}
	}

	if operationKit.parsedOperation.IsPersistedOperation || h.operationBlocker.safelistEnabled || h.operationBlocker.logUnknownOperationsEnabled {
		skipParse, isApq, err = operationKit.FetchPersistedOperation(h.ctx, h.clientInfo)
		if err != nil {
			var poNotFoundErr *persistedoperation.PersistentOperationNotFoundError
			if h.operationBlocker.logUnknownOperationsEnabled && errors.As(err, &poNotFoundErr) {
				h.logger.Warn("Unknown persisted operation found", zap.String("query", operationKit.parsedOperation.Request.Query), zap.String("sha256Hash", poNotFoundErr.Sha256Hash))
				if h.operationBlocker.safelistEnabled {
					return nil, nil, err
				}
			} else {
				return nil, nil, err
			}
		}
	}

	// If the persistent operation is already in the cache, we skip the parse step
	// because the operation was already parsed. This is a performance optimization, and we
	// can do it because we know that the persisted operation is immutable (identified by the hash)
	if !skipParse {
		startParsing := time.Now()
		if err := operationKit.Parse(); err != nil {
			opContext.parsingTime = time.Since(startParsing)
			return nil, nil, err
		}
		opContext.parsingTime = time.Since(startParsing)
	}

	opContext.name = operationKit.parsedOperation.Request.OperationName
	opContext.opType = operationKit.parsedOperation.Type

	reqCtx := getRequestContext(registration.clientRequest.Context())
	if reqCtx == nil {
		return nil, nil, fmt.Errorf("request context not found")
	}

	if blocked := h.operationBlocker.OperationIsBlocked(h.logger, reqCtx.expressionContext, operationKit.parsedOperation); blocked != nil {
		return nil, nil, blocked
	}

	startNormalization := time.Now()

	if _, err := operationKit.NormalizeOperation(h.clientInfo.Name, isApq); err != nil {
		opContext.normalizationTime = time.Since(startNormalization)
		return nil, nil, err
	}
	opContext.normalizationCacheHit = operationKit.parsedOperation.NormalizationCacheHit

	// Validate the operation against the schema BEFORE variable extraction, which would
	// serialize inline literals into JSON variables and let invalid-type literals through.
	// The error is surfaced later, during validation, so normalization timing stays accurate.
	_, operationValidationErr := operationKit.ValidateOperation()

	cached, _, err := operationKit.NormalizeVariables()
	if err != nil {
		opContext.normalizationTime = time.Since(startNormalization)
		return nil, nil, err
	}
	opContext.variablesNormalizationCacheHit = cached

	logInlineArguments(h.logger, operationKit.parsedOperation)
	if h.operationProcessor.parseKitOptions.validateInlineArguments.ReturnInResponseExtensions {
		opContext.inlineArguments = inlineArgumentQualifiedNames(operationKit.parsedOperation)
	}

	cached, err = operationKit.RemapVariables(h.disableVariablesRemapping)
	if err != nil {
		opContext.normalizationTime = time.Since(startNormalization)
		return nil, nil, err
	}
	opContext.variablesRemappingCacheHit = cached

	opContext.hash = operationKit.parsedOperation.ID
	opContext.internalHash = operationKit.parsedOperation.InternalID
	opContext.remapVariables = operationKit.parsedOperation.RemapVariables

	opContext.normalizationTime = time.Since(startNormalization)
	opContext.content = operationKit.parsedOperation.NormalizedRepresentation
	opContext.variablesHash = operationKit.parsedOperation.VariablesHash
	opContext.variables, err = astjson.ParseBytes(operationKit.parsedOperation.Request.Variables)
	if err != nil {
		return nil, nil, err
	}

	startValidation := time.Now()

	// Surface schema-validation errors (computed before extraction) ahead of variable
	// validation, matching the GraphQL spec order.
	if operationValidationErr != nil {
		opContext.validationTime = time.Since(startValidation)
		return nil, nil, operationValidationErr
	}

	_, _, err = operationKit.ValidateQueryComplexity()
	if err != nil {
		opContext.validationTime = time.Since(startValidation)
		return nil, nil, err
	}

	if err := operationKit.ValidateOperationVariables(h.plannerOptions.ExecutionOptions.SkipLoader, opContext.remapVariables, &h.apolloCompatibilityFlags); err != nil {
		opContext.validationTime = time.Since(startValidation)
		return nil, nil, err
	}

	opContext.validationTime = time.Since(startValidation)

	startPlanning := time.Now()

	err = h.planner.plan(opContext, h.plannerOptions)
	if err != nil {
		opContext.planningTime = time.Since(startPlanning)
		return operationKit.parsedOperation, nil, err
	}

	opContext.planningTime = time.Since(startPlanning)

	if err := operationKit.ValidateStaticCost(opContext); err != nil {
		return operationKit.parsedOperation, nil, err
	}

	opContext.initialPayload = h.initialPayload

	return operationKit.parsedOperation, opContext, nil
}

func (h *WebSocketConnectionHandler) executeSubscription(registration *SubscriptionRegistration) {
	rw := newWebsocketResponseWriter(registration.msg.ID, h.protocol, h.graphqlHandler.subgraphErrorPropagation.Enabled, h.logger, h.stats, &h.subscriptions)

	_, operationCtx, err := h.parseAndPlan(registration)
	if err != nil {
		wErr := h.writeErrorMessage(registration.msg.ID, err)
		if wErr != nil {
			h.logger.Warn("writing error message", zap.Error(wErr))
		}
		return
	}

	if h.forwardUpgradeHeaders.enabled && h.upgradeRequestHeaders != nil {
		if operationCtx.extensions == nil {
			operationCtx.extensions = json.RawMessage("{}")
		}
		operationCtx.extensions, err = jsonparser.Set(operationCtx.extensions, h.upgradeRequestHeaders, "upgradeHeaders")
		if err != nil {
			h.logger.Warn("Setting upgrade request data", zap.Error(err))
			_ = h.writeErrorMessage(registration.msg.ID, err)
			return
		}
	}
	if h.forwardQueryParams.enabled && h.upgradeRequestQueryParams != nil {
		if operationCtx.extensions == nil {
			operationCtx.extensions = json.RawMessage("{}")
		}
		operationCtx.extensions, err = jsonparser.Set(operationCtx.extensions, h.upgradeRequestQueryParams, "upgradeQueryParams")
		if err != nil {
			h.logger.Warn("Setting upgrade request data", zap.Error(err))
			_ = h.writeErrorMessage(registration.msg.ID, err)
			return
		}

	}
	if h.forwardInitialPayload && operationCtx.initialPayload != nil {
		if operationCtx.extensions == nil {
			operationCtx.extensions = json.RawMessage("{}")
		}
		operationCtx.extensions, err = jsonparser.Set(operationCtx.extensions, operationCtx.initialPayload, "initialPayload")
		if err != nil {
			h.logger.Warn("Setting initial payload", zap.Error(err))
			_ = h.writeErrorMessage(registration.msg.ID, err)
			return
		}
	}
	reqContext := buildRequestContext(requestContextOptions{
		operationContext:    operationCtx,
		requestLogger:       h.logger,
		metricSetAttributes: nil,
		w:                   nil,
		r:                   registration.clientRequest,
	})

	reqContext.operation.protocol = OperationProtocolWS
	reqContext.operation.executionOptions = h.plannerOptions.ExecutionOptions
	reqContext.operation.traceOptions = h.plannerOptions.TraceOptions

	resolveCtx := resolve.NewContext(withRequestContext(h.ctx, reqContext))

	resolveCtx.Variables = operationCtx.Variables()
	resolveCtx.RemapVariables = operationCtx.remapVariables
	resolveCtx.VariablesHash = operationCtx.variablesHash
	resolveCtx.Request = resolve.Request{
		Header: registration.clientRequest.Header,
		ID:     operationCtx.internalHash,
	}
	resolveCtx.RenameTypeNames = h.graphqlHandler.executor.RenameTypeNames
	resolveCtx.TracingOptions = operationCtx.traceOptions
	resolveCtx.Extensions = operationCtx.extensions
	resolveCtx.InlineArguments = operationCtx.inlineArguments
	resolveCtx.ExecutionOptions = operationCtx.executionOptions

	if operationCtx.initialPayload != nil {
		resolveCtx.InitialPayload = operationCtx.initialPayload
	}

	if origCtx := getRequestContext(h.request.Context()); origCtx != nil {
		reqContext.expressionContext = *origCtx.expressionContext.Clone()
		if h.graphqlHandler.headerPropagation != nil {
			resolveCtx.SubgraphHeadersBuilder = SubgraphHeadersBuilder(
				origCtx,
				h.graphqlHandler.headerPropagation,
				operationCtx.preparedPlan.preparedPlan,
			)
		}
	}
	if h.graphqlHandler.authorizer != nil {
		resolveCtx = WithAuthorizationExtension(resolveCtx)
		resolveCtx.SetAuthorizer(h.graphqlHandler.authorizer)
		if h.graphqlHandler.authorizer.IsPreFetchFieldAuthorizationEnabled() {
			resolveCtx.SetPreFetchFieldAuthorizer(h.graphqlHandler.authorizer)
		}
	}
	resolveCtx = h.graphqlHandler.configureRateLimiting(resolveCtx)

	// Put in a closure to evaluate err after defer
	defer func() {
		// StatusCode has no meaning here. We set it to 0 but set the error.
		h.metrics.ExportSchemaUsageInfo(operationCtx, 0, err != nil, false)
	}()

	switch p := operationCtx.preparedPlan.preparedPlan.(type) {
	case *plan.SynchronousResponsePlan:
		var info *resolve.GraphQLResolveInfo
		info, err = h.graphqlHandler.executor.Resolver.ResolveGraphQLResponse(resolveCtx, p.Response, nil, rw)
		if err != nil {
			h.logger.Warn("Resolving GraphQL response", zap.Error(err))
			h.graphqlHandler.WriteError(resolveCtx, err, p.Response, rw)
		}
		if info != nil {
			reqContext.expressionContext.Request.Operation.ResolverAcquireDuration = info.ResolveAcquireWaitTime
			if h.graphqlHandler.metricStore != nil {
				h.graphqlHandler.metricStore.MeasureResolverAcquireDuration(
					resolveCtx.Context(),
					info.ResolveAcquireWaitTime,
					reqContext.telemetry.metricSliceAttrs,
					otelmetric.WithAttributes(reqContext.telemetry.metricAttrs...),
				)
			}
		}
		_ = rw.Flush()
		rw.Complete()
	case *plan.SubscriptionResponsePlan:
		err = h.graphqlHandler.executor.Resolver.AsyncResolveGraphQLSubscription(resolveCtx, p.Response, rw.SubscriptionResponseWriter(), registration.id)
		if err != nil {
			h.logger.Warn("Resolving GraphQL subscription", zap.Error(err))
			// Subscription setup failed so no updates will follow. Send a terminal
			// error frame and stop.
			h.graphqlHandler.WriteTerminalError(resolveCtx, err, p.Response.Response, rw)
			return
		}
	}
}

type SubscriptionRegistration struct {
	id            resolve.SubscriptionIdentifier
	msg           *wsproto.Message
	clientRequest *http.Request
}

// registerSubscription registers a new subscription with the given message. This method is not safe for concurrent use.
func (h *WebSocketConnectionHandler) registerSubscription(msg *wsproto.Message) (*SubscriptionRegistration, error) {
	if msg.ID == "" {
		return nil, fmt.Errorf("missing id in subscribe")
	}
	_, exists := h.subscriptions.Load(msg.ID)
	if exists {
		return nil, fmt.Errorf("subscription with id %q already exists", msg.ID)
	}

	subscriptionID := h.subscriptionIDs.Inc()
	h.subscriptions.Store(msg.ID, subscriptionID)

	registration := &SubscriptionRegistration{
		id: resolve.SubscriptionIdentifier{
			ConnectionID:   h.connectionID,
			SubscriptionID: subscriptionID,
		},
		msg: msg,
		// executeSubscription is running on a worker pool, so we have to clone the request
		// before passing it to the worker pool. The original request is not safe for concurrent use and
		// is needed later to construct the operation context and to clone the resolver context.
		clientRequest: h.request.Clone(h.request.Context()),
	}

	return registration, nil
}

func (h *WebSocketConnectionHandler) handleComplete(msg *wsproto.Message) error {
	value, exists := h.subscriptions.Load(msg.ID)
	if !exists {
		return h.requestError(fmt.Errorf("no subscription was registered for ID %q", msg.ID))
	}
	h.subscriptions.Delete(msg.ID)
	subscriptionID, ok := value.(int64)
	if !ok {
		return h.requestError(fmt.Errorf("invalid subscription state for ID %q", msg.ID))
	}
	id := resolve.SubscriptionIdentifier{
		ConnectionID:   h.connectionID,
		SubscriptionID: subscriptionID,
	}
	_ = h.protocol.Complete(msg.ID)
	return h.graphqlHandler.executor.Resolver.UnsubscribeSubscription(id)
}

func (h *WebsocketHandler) HandleMessage(handler *WebSocketConnectionHandler, msg *wsproto.Message) (err error) {
	switch msg.Type {
	case wsproto.MessageTypeTerminate:
		return errClientTerminatedConnection
	case wsproto.MessageTypePing:
		_ = handler.protocol.Pong(msg)
	case wsproto.MessageTypePong:
		// "Furthermore, the Pong message may even be sent unsolicited as a unidirectional heartbeat"
		return nil
	case wsproto.MessageTypeSubscribe:
		registration, err := handler.registerSubscription(msg)
		if err != nil {
			h.logger.Warn("Handling subscription registration", zap.Error(err))
			return &wsproto.CloseError{Kind: wsproto.CloseKind{Code: 4409, Reason: "Subscriber for " + msg.ID + " already exists"}}
		}
		handler.executeSubscription(registration)
	case wsproto.MessageTypeComplete:
		err = handler.handleComplete(msg)
		if err != nil {
			h.logger.Warn("Handling complete", zap.Error(err))
		}
	default:
		return handler.requestError(fmt.Errorf("unsupported message type %d", msg.Type))
	}
	return nil
}

func (h *WebSocketConnectionHandler) Initialize() (err error) {
	h.logger.Debug("Websocket connection", zap.String("protocol", h.protocol.Subprotocol()))
	h.initialPayload, err = h.protocol.Initialize()
	if err != nil {
		_ = h.requestError(fmt.Errorf("error initializing session: %w", err))
		return err
	}

	// Update client info from initial payload if enabled
	if h.clientInfoFromInitialPayload.Enabled && h.initialPayload != nil {
		var initialPayloadMap map[string]any
		err := json.Unmarshal(h.initialPayload, &initialPayloadMap)
		if err != nil {
			h.logger.Warn("Error parsing initial payload for client info", zap.Error(err))
			return err
		}

		// Update client name if present
		if clientName, ok := initialPayloadMap[h.clientInfoFromInitialPayload.NameField].(string); ok {
			h.clientInfo.Name = clientName
			if h.clientInfoFromInitialPayload.ForwardToRequestHeaders.Enabled {
				h.request.Header.Set(h.clientInfoFromInitialPayload.ForwardToRequestHeaders.NameTargetHeader, clientName)
			}
		}

		// Update client version if present
		if clientVersion, ok := initialPayloadMap[h.clientInfoFromInitialPayload.VersionField].(string); ok {
			h.clientInfo.Version = clientVersion
			if h.clientInfoFromInitialPayload.ForwardToRequestHeaders.Enabled {
				h.request.Header.Set(h.clientInfoFromInitialPayload.ForwardToRequestHeaders.VersionTargetHeader, clientVersion)
			}
		}

		// Update planner options with new client info
		h.plannerOptions.ClientInfo = h.clientInfo
	}

	if h.forwardQueryParams.enabled {
		query := h.request.URL.Query()
		params := make(map[string]string, len(query))
		for k := range query {
			if !h.ignoreQueryParameter(k) {
				params[k] = query.Get(k)
			}
		}
		if len(params) != 0 {
			h.upgradeRequestQueryParams, err = json.Marshal(params)
			if err != nil {
				return err
			}
		}
	}
	if h.forwardUpgradeHeaders.enabled {
		header := make(map[string]string, len(h.request.Header))
		for k := range h.request.Header {
			if h.ignoreHeader(k) {
				continue
			}
			header[k] = h.request.Header.Get(k)
		}
		if len(header) > 0 {
			h.upgradeRequestHeaders, err = json.Marshal(header)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (h *WebSocketConnectionHandler) ignoreQueryParameter(k string) bool {
	if h.forwardQueryParams.withStaticAllowList {
		if slices.Contains(h.forwardQueryParams.staticAllowList, k) {
			return false
		}
	}
	if h.forwardQueryParams.withRegexAllowList {
		for _, re := range h.forwardQueryParams.regexAllowList {
			if re.MatchString(k) {
				return false
			}
		}
	}
	return h.forwardQueryParams.withStaticAllowList || h.forwardQueryParams.withRegexAllowList
}

func (h *WebSocketConnectionHandler) ignoreHeader(k string) bool {
	if h.forwardUpgradeHeaders.withStaticAllowList {
		if slices.Contains(h.forwardUpgradeHeaders.staticAllowList, k) {
			return false
		}
	}
	if h.forwardUpgradeHeaders.withRegexAllowList {
		for _, re := range h.forwardUpgradeHeaders.regexAllowList {
			if re.MatchString(k) {
				return false
			}
		}
	}
	return h.forwardUpgradeHeaders.withStaticAllowList || h.forwardUpgradeHeaders.withRegexAllowList
}

func (h *WebSocketConnectionHandler) shouldComputeOperationSha256(operationKit *OperationKit) bool {
	hasPersistedHash := operationKit.parsedOperation.GraphQLRequestExtensions.PersistedQuery.HasHash()

	if hasPersistedHash && operationKit.parsedOperation.Request.Query != "" {
		return true
	}

	if !hasPersistedHash && (h.operationBlocker.safelistEnabled || h.operationBlocker.logUnknownOperationsEnabled) {
		return true
	}

	return false
}

func (h *WebSocketConnectionHandler) Close(unsubscribe bool, closeKind wsproto.CloseKind) {
	if unsubscribe {
		// Remove any pending IDs associated with this connection
		err := h.graphqlHandler.executor.Resolver.UnsubscribeClient(h.connectionID)
		if err != nil {
			h.logger.Debug("Unsubscribing client", zap.Error(err))
		}
	}

	if err := h.conn.WriteCloseFrame(closeKind.Code, closeKind.Reason); err != nil {
		h.logger.Debug("Writing close frame", zap.Error(err))
	}

	if err := h.conn.Close(); err != nil {
		h.logger.Debug("Closing websocket connection", zap.Error(err))
	}
}
