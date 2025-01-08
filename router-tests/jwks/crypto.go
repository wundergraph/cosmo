package jwks

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"fmt"

	"github.com/MicahParks/jwkset"
	"github.com/golang-jwt/jwt/v5"
)

type Crypto interface {
	SigningMethod() jwt.SigningMethod
	PrivateKey() privateKey
	MarshalJWK() (jwkset.JWK, error)
	KID() string
}

type privateKey any

type baseCrypto struct {
	pk  privateKey
	alg jwkset.ALG
	kID string
}

func (b *baseCrypto) PrivateKey() privateKey {
	return b.pk
}

func (b *baseCrypto) SigningMethod() jwt.SigningMethod {
	return jwt.GetSigningMethod(b.alg.String())
}

func (b *baseCrypto) MarshalJWK() (jwkset.JWK, error) {
	marshalOptions := jwkset.JWKMarshalOptions{
		Private: false,
	}

	meta := jwkset.JWKMetadataOptions{
		ALG: b.alg,
		KID: b.kID,
		USE: jwkset.UseSig,
	}

	options := jwkset.JWKOptions{
		Marshal:  marshalOptions,
		Metadata: meta,
	}

	return jwkset.NewJWKFromKey(b.pk, options)
}

func (b *baseCrypto) KID() string {
	return b.kID
}

type rsaCrypto struct {
	baseCrypto
}

func NewRSACrypto(kID string, alg jwkset.ALG, size int) (Crypto, error) {
	pk, err := rsa.GenerateKey(rand.Reader, size)
	if err != nil {
		return nil, err
	}

	if kID == "" {
		kID = randomKID()
	}

	return &rsaCrypto{
		baseCrypto: baseCrypto{
			pk:  pk,
			alg: alg,
			kID: kID,
		},
	}, nil
}

type hmacCrypto struct {
	baseCrypto
}

func NewHMACCrypto(kID string, alg jwkset.ALG) (Crypto, error) {
	secret := make([]byte, 64)
	_, err := rand.Read(secret)
	if err != nil {
		return nil, fmt.Errorf("failed to generate random secret")
	}

	h := hmac.New(crypto.SHA256.New, secret)

	s := h.Sum(nil)

	if kID == "" {
		kID = randomKID()
	}

	return &hmacCrypto{
		baseCrypto: baseCrypto{
			pk:  s,
			alg: alg,
			kID: kID,
		},
	}, nil
}

func (b *hmacCrypto) MarshalJWK() (jwkset.JWK, error) {
	marshalOptions := jwkset.JWKMarshalOptions{
		Private: true,
	}

	meta := jwkset.JWKMetadataOptions{
		ALG: b.alg,
		KID: b.kID,
		USE: jwkset.UseSig,
	}

	options := jwkset.JWKOptions{
		Marshal:  marshalOptions,
		Metadata: meta,
	}

	return jwkset.NewJWKFromKey(b.pk, options)
}

type ed25519Crypto struct {
	baseCrypto
}

func NewED25519Crypto(kID string) (Crypto, error) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}

	if kID == "" {
		kID = randomKID()
	}

	return &ed25519Crypto{
		baseCrypto: baseCrypto{
			pk:  priv,
			alg: jwkset.AlgEdDSA,
			kID: kID,
		},
	}, nil

}

type ecdsaCrypto struct {
	baseCrypto
}

func newESCryptoWithEllipticCurve(kID string, curve elliptic.Curve, alg jwkset.ALG) (Crypto, error) {
	priv, err := ecdsa.GenerateKey(curve, rand.Reader)
	if err != nil {
		return nil, err
	}

	if kID == "" {
		kID = randomKID()
	}
	return &ecdsaCrypto{
		baseCrypto: baseCrypto{
			pk:  priv,
			alg: alg,
			kID: kID,
		},
	}, nil
}

func NewES256Crypto(kID string) (Crypto, error) {
	return newESCryptoWithEllipticCurve(kID, elliptic.P256(), jwkset.AlgES256)
}

func NewES384Crypto(kID string) (Crypto, error) {
	return newESCryptoWithEllipticCurve(kID, elliptic.P384(), jwkset.AlgES384)
}

func NewES512Crypto(kID string) (Crypto, error) {
	return newESCryptoWithEllipticCurve(kID, elliptic.P521(), jwkset.AlgES512)
}

func randomKID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)

	for i := 0; i < len(b); i++ {
		b[i] = 'a' + (b[i] % 26)
	}

	return string(b)
}
