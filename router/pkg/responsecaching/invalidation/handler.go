package invalidation

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/wundergraph/cosmo/router/internal/unique"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/responsecaching"
	"go.uber.org/zap"
)

// maxBodyBytes bounds one invalidation request. The array is held in memory to
// be validated before any of it is applied, so its size is this handler's to
// cap rather than the caller's to choose.
const maxBodyBytes = 10 << 20

// Handler serves invalidation requests against one response cache.
type Handler struct {
	logger      *zap.Logger
	invalidator responsecaching.Invalidator
	cfg         config.ResponseCacheInvalidationConfig
}

// NewHandler returns a handler removing entries from invalidator, refusing the
// kinds whose indexes cfg does not maintain.
func NewHandler(logger *zap.Logger, invalidator responsecaching.Invalidator, cfg config.ResponseCacheInvalidationConfig) *Handler {
	return &Handler{
		logger:      logger.With(zap.String("component", "response_cache_invalidation")),
		invalidator: invalidator,
		cfg:         cfg,
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		h.writeError(w, http.StatusMethodNotAllowed, "invalidation accepts %s, got %s", http.MethodPost, r.Method)
		return
	}

	if !h.authorized(r) {
		h.writeError(w, http.StatusUnauthorized, "the Authorization header does not carry the invalidation shared key")
		return
	}

	requests, err := h.decode(r)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "%s", err)
		return
	}

	// Everything is checked before anything is removed. Applying as far as the
	// first bad element would leave a caller half invalidated by a typo, with
	// no way to retry the whole array safely.
	tags, errs := h.plan(requests)
	if len(errs) > 0 {
		h.writeErrors(w, http.StatusBadRequest, errs)
		return
	}

	removed, err := h.invalidator.InvalidateByTags(r.Context(), tags)
	if err != nil {
		h.logger.Error("Response cache invalidation error",
			zap.Error(err), zap.Int("removed", removed), zap.Int("tags", len(tags)))
		h.writeError(w, http.StatusInternalServerError, "invalidation failed")
		return
	}

	h.logger.Debug("Response cache invalidated",
		zap.Int("count", removed), zap.Int("tags", len(tags)), zap.Int("requests", len(requests)))

	h.write(w, http.StatusAccepted, countResponse{Count: removed})
}

// authorized compares the whole Authorization header against the shared key,
// with no Bearer prefix expected
func (h *Handler) authorized(r *http.Request) bool {
	given := r.Header.Get("Authorization")
	return subtle.ConstantTimeCompare([]byte(given), []byte(h.cfg.Endpoint.SharedKey)) == 1
}

// decode reads the array of requests off the body.
func (h *Handler) decode(r *http.Request) ([]Request, error) {
	decoder := json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxBodyBytes))
	decoder.DisallowUnknownFields()

	var requests []Request
	if err := decoder.Decode(&requests); err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			return nil, fmt.Errorf("invalidation request is larger than %d bytes", maxBodyBytes)
		}
		return nil, fmt.Errorf("invalidation expects an array of requests: %w", err)
	}

	if len(requests) == 0 {
		return nil, errors.New("invalidation expects at least one request")
	}

	return requests, nil
}

// plan turns every request into the tags it names, or the reasons it was
// refused. Nothing is invalidated unless every element was accepted.
func (h *Handler) plan(requests []Request) ([]string, []Error) {
	var (
		errs []Error
		tags []string
	)

	for i, request := range requests {
		requestTags, err := request.tags(h.cfg)
		if err != nil {
			errs = append(errs, Error{Index: i, Kind: request.Kind, Message: err.Error()})
			continue
		}
		tags = append(tags, requestTags...)
	}

	// A tag named twice is one lookup, not two, so a caller repeating a
	// subgraph across elements is not charged a round trip for it.
	return unique.SliceElements(tags), errs
}

func (h *Handler) writeError(w http.ResponseWriter, status int, format string, a ...any) {
	h.writeErrors(w, status, []Error{{Message: fmt.Sprintf(format, a...)}})
}

func (h *Handler) writeErrors(w http.ResponseWriter, status int, errs []Error) {
	h.write(w, status, errorResponse{Errors: errs})
}

func (h *Handler) write(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		// The status line is already out, so this can only be logged.
		h.logger.Debug("Failed to write invalidation response", zap.Error(err))
	}
}
