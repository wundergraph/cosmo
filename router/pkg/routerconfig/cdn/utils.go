package cdn

import (
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"hash"

	"go.uber.org/zap"
)

// validateHMACSignature verifies the HMAC-SHA256 signature of body against encodedSig
// (the base64-encoded value of the X-Signature-SHA256 response header).
// h is reset after use so it can be reused for the next request.
func validateHMACSignature(h hash.Hash, body []byte, encodedSig string, logger *zap.Logger, federatedGraphID string) error {
	if encodedSig == "" {
		logger.Error(
			"Signature header not found in CDN response. Ensure that your Admission Controller was able to sign the config. Open the compositions page in the Studio to check the status of the last deployment",
			zap.Error(ErrMissingSignatureHeader),
		)
		return ErrMissingSignatureHeader
	}

	if _, err := h.Write(body); err != nil {
		return fmt.Errorf("could not write config body to hmac: %w", err)
	}
	dataHmac := h.Sum(nil)
	h.Reset()

	rawSignature, err := base64.StdEncoding.DecodeString(encodedSig)
	if err != nil {
		return fmt.Errorf("could not decode signature: %w", err)
	}

	if subtle.ConstantTimeCompare(rawSignature, dataHmac) != 1 {
		logger.Error(
			"Invalid config signature, potential tampering detected. Ensure that your Admission Controller has signed the config correctly. Open the compositions page in the Studio to check the status of the last deployment",
			zap.Error(ErrInvalidSignature),
		)
		return ErrInvalidSignature
	}

	logger.Info("Config signature validation successful",
		zap.String("federatedGraphID", federatedGraphID),
		zap.String("signature", encodedSig),
	)
	return nil
}
