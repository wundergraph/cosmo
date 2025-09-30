package composition

import (
	"crypto/sha1"
	"encoding/hex"
	"io"
	"net/url"
)

// stringHash produces a sha1 hash of the given string, it is
// used as a shim for replacing the bits we use from node:crypto
func stringHash(str string) (string, error) {
	s := sha1.New()
	if _, err := io.WriteString(s, str); err != nil {
		return "", err
	}
	return hex.EncodeToString(s.Sum(nil)), nil
}

type urlShim struct {
	Hash     string `goja:"hash"`
	Host     string `goja:"host"`
	Hostname string `goja:"hostname"`
	Href     string `goja:"href"`
	Origin   string `goja:"origin"`
	Password string `goja:"password"`
	Pathname string `goja:"pathname"`
	Port     string `goja:"port"`
	Protocol string `goja:"protocol"`
	Search   string `goja:"search"`
	// XXX:SearchParams is not supported!
	Username string `goja:"username"`
}

func urlParse(rawURL string, base string) (*urlShim, error) {
	var u *url.URL
	var err error
	if base != "" {
		var b *url.URL
		b, err = url.Parse(base)
		if err != nil {
			return nil, err
		}
		u, err = b.Parse(rawURL)
	} else {
		u, err = url.Parse(rawURL)
	}
	if err != nil {
		return nil, err
	}
	return &urlShim{
		Hash:     u.Fragment,
		Host:     u.Host,
		Hostname: u.Hostname(),
		Href:     u.String(),
		Origin:   u.Scheme + "://" + u.Host,
		Password: u.User.Username(),
		Pathname: u.Path,
		Port:     u.Port(),
		Protocol: u.Scheme + ":",
		Search:   "?" + u.RawQuery,
		Username: u.User.Username(),
	}, nil
}
