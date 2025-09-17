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
	logger              *zap.Logger
	algs                map[string]struct{}
	inner               jwkset.Storage
	allowEmptyAlgorithm bool
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

func NewValidationStore(logger *zap.Logger, inner jwkset.Storage, algs []string, allowEmptyAlgorithm bool) (jwkset.Storage, []string) {
	if inner == nil {
		inner = jwkset.NewMemoryStorage()
	}

	if logger == nil {
		logger = zap.NewNop()
	}

	algSet := make(map[string]struct{}, len(algs))

	store := &validationStore{
		logger:              logger,
		inner:               inner,
		algs:                supportedAlgorithms,
		allowEmptyAlgorithm: allowEmptyAlgorithm,
	}

	if len(algs) == 0 {
		return store, nil
	}

	for _, alg := range algs {
		if _, ok := supportedAlgorithms[alg]; !ok {
			logger.Warn("Unsupported algorithm", zap.String("algorithm", alg))
			continue
		}
		algSet[alg] = struct{}{}
	}

	store.algs = algSet
	return store, store.getSupportedAlgorithms()
}

func (v *validationStore) getSupportedAlgorithms() []string {
	algs := make([]string, 0, len(v.algs))
	for alg := range v.algs {
		algs = append(algs, alg)
	}
	return algs
}

func (v *validationStore) KeyDelete(ctx context.Context, keyID string) (ok bool, err error) {
	return v.inner.KeyDelete(ctx, keyID)
}

func (v *validationStore) KeyRead(ctx context.Context, keyID string) (jwkset.JWK, error) {
	key, err := v.inner.KeyRead(ctx, keyID)
	if err != nil {
		return key, err
	}

	if fKey, ok := v.getFilteredKey(key); ok {
		return fKey, nil
	}

	return jwkset.JWK{}, fmt.Errorf("key with ID %q has an unsupported algorithm %s", keyID, key.Marshal().ALG.String())
}

func (v *validationStore) KeyReadAll(ctx context.Context) ([]jwkset.JWK, error) {
	keys, err := v.inner.KeyReadAll(ctx)
	if err != nil {
		return nil, err
	}

	filter := make([]jwkset.JWK, 0, len(keys))

	for _, k := range keys {
		if fKey, ok := v.getFilteredKey(k); ok {
			filter = append(filter, fKey)
		}
	}

	return filter, nil
}

func (v *validationStore) KeyReplaceAll(ctx context.Context, given []jwkset.JWK) error {
	filtered := make([]jwkset.JWK, 0)
	for _, k := range given {
		if fKey, ok := v.getFilteredKey(k); ok {
			filtered = append(filtered, fKey)
		}
	}
	return v.inner.KeyReplaceAll(ctx, filtered)
}

func (v *validationStore) KeyWrite(ctx context.Context, jwk jwkset.JWK) error {
	if _, ok := v.getFilteredKey(jwk); !ok {
		// We should not return an error here. If JWKS are configured for multiple applications, we should only add the
		// supported keys to the token decoder store and not prevent the refresh entirely.
		// In case we are receiving a key with an unsupported algorithm we log a warning instead.
		jwkMarshal := jwk.Marshal()
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

func (v *validationStore) getFilteredKey(k jwkset.JWK) (jwkset.JWK, bool) {
	algString := k.Marshal().ALG.String()

	// If we allow empty algorithm, we accept JWK without an algorithm
	// This is algorithm is actually optional according to the RFC
	if algString == "" && v.allowEmptyAlgorithm {
		return k, true
	}
	if _, ok := v.algs[algString]; ok {
		return k, true
	}

	return jwkset.JWK{}, false
}
