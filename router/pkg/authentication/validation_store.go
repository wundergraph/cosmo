package authentication

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/MicahParks/jwkset"
	"go.uber.org/zap"
)

var _ jwkset.Storage = (*validationStore)(nil)

type validationStore struct {
	logger *zap.Logger
	algs   map[string]struct{}
	inner  jwkset.Storage
}

var supportedAlgorithms = map[string]struct{}{
	"HS256": {},
	"HS384": {},
	"HS512": {},
	"RS256": {},
	"RS384": {},
	"RS512": {},
	"PS256": {},
	"PS384": {},
	"PS512": {},
	"ES256": {},
	"ES384": {},
	"ES512": {},
	"EdDSA": {},
}

func NewValidationStore(logger *zap.Logger, inner jwkset.Storage, algs []string) jwkset.Storage {
	if inner == nil {
		inner = jwkset.NewMemoryStorage()
	}

	if logger == nil {
		logger = zap.NewNop()
	}

	algSet := make(map[string]struct{}, len(algs))

	store := &validationStore{
		logger: logger,
		inner:  inner,
		algs:   supportedAlgorithms,
	}

	if len(algs) == 0 {
		return store
	}

	for _, alg := range algs {
		if _, ok := supportedAlgorithms[alg]; !ok {
			logger.Warn("Unsupported algorithm", zap.String("algorithm", alg))
			continue
		}
		algSet[alg] = struct{}{}
	}

	store.algs = algSet
	return store
}

func (v *validationStore) KeyDelete(ctx context.Context, keyID string) (ok bool, err error) {
	return v.inner.KeyDelete(ctx, keyID)
}

func (v *validationStore) KeyRead(ctx context.Context, keyID string) (jwkset.JWK, error) {
	key, err := v.inner.KeyRead(ctx, keyID)
	if err != nil {
		return key, err
	}

	m := key.Marshal()
	if _, ok := v.algs[m.ALG.String()]; ok {
		return key, nil
	}

	return jwkset.JWK{}, fmt.Errorf("key with ID %q has an unsupported algorithm %s", keyID, m.ALG.String())
}

func (v *validationStore) KeyReadAll(ctx context.Context) ([]jwkset.JWK, error) {
	keys, err := v.inner.KeyReadAll(ctx)
	if err != nil {
		return nil, err
	}

	filter := make([]jwkset.JWK, 0, len(keys))

	for _, k := range keys {
		m := k.Marshal()
		if _, ok := v.algs[m.ALG.String()]; ok {
			filter = append(filter, k)
		}
	}

	return filter, nil
}

func (v *validationStore) KeyReplaceAll(ctx context.Context, given []jwkset.JWK) error {
	filtered := make([]jwkset.JWK, 0)
	for _, k := range given {
		m := k.Marshal()
		if _, ok := v.algs[m.ALG.String()]; ok {
			filtered = append(filtered, k)
		}
	}
	return v.inner.KeyReplaceAll(ctx, filtered)
}

func (v *validationStore) KeyWrite(ctx context.Context, jwk jwkset.JWK) error {
	jwkMarshal := jwk.Marshal()
	if _, ok := v.algs[jwkMarshal.ALG.String()]; !ok {
		// We should not return an error here. If JWKS are configured for multiple applications, we should only add the
		// supported keys to the token decoder store and not prevent the refresh entirely.
		// In case we are receiving a key with an unsupported algorithm we log a warning instead.
		v.logger.Warn("Skipping key with unsupported algorithm", zap.String("keyID", jwkMarshal.KID), zap.String("algorithm", jwkMarshal.ALG.String()))
		return nil
	}

	return v.inner.KeyWrite(ctx, jwk)
}

func (v *validationStore) JSON(ctx context.Context) (json.RawMessage, error) {
	return v.inner.JSON(ctx)
}

func (v *validationStore) JSONPublic(ctx context.Context) (json.RawMessage, error) {
	return v.inner.JSONPublic(ctx)
}

func (v *validationStore) JSONPrivate(ctx context.Context) (json.RawMessage, error) {
	return v.inner.JSONPrivate(ctx)
}

func (v *validationStore) JSONWithOptions(ctx context.Context, marshalOptions jwkset.JWKMarshalOptions, validationOptions jwkset.JWKValidateOptions) (json.RawMessage, error) {
	return v.inner.JSONWithOptions(ctx, marshalOptions, validationOptions)
}

func (v *validationStore) Marshal(ctx context.Context) (jwkset.JWKSMarshal, error) {
	return v.inner.Marshal(ctx)
}

func (v *validationStore) MarshalWithOptions(ctx context.Context, marshalOptions jwkset.JWKMarshalOptions, validationOptions jwkset.JWKValidateOptions) (jwkset.JWKSMarshal, error) {
	return v.inner.MarshalWithOptions(ctx, marshalOptions, validationOptions)
}
