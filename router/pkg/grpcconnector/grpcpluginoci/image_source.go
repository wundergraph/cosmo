package grpcpluginoci

import (
	"context"
	"time"

	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/name"
	v1 "github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"github.com/google/go-containerregistry/pkg/v1/tarball"
)

type ImageSource interface {
	Images(ctx context.Context) <-chan v1.Image
}

// TarballImageSource loads a static image from a tarball
type TarballImageSource struct {
	path string
}

func NewTarballImageSource(path string) *TarballImageSource {
	return &TarballImageSource{path: path}
}

func (t *TarballImageSource) Images(ctx context.Context) <-chan v1.Image {
	ch := make(chan v1.Image, 1)
	go func() {
		img, err := tarball.ImageFromPath(t.path, nil)
		if err == nil {
			ch <- img
		}
		close(ch)
	}()
	return ch
}

// RemoteImageSource loads an image from a remote registry, with optional hot reload
type RemoteImageSource struct {
	ref            name.Reference
	reloadInterval time.Duration
	lastDigest     string
}

func NewRemoteImageSource(refStr string, reloadInterval time.Duration) (*RemoteImageSource, error) {
	ref, err := name.ParseReference(refStr)
	if err != nil {
		return nil, err
	}
	return &RemoteImageSource{ref: ref, reloadInterval: reloadInterval}, nil
}

func (r *RemoteImageSource) getImage() (v1.Image, error) {
	img, err := remote.Image(r.ref, remote.WithAuth(authn.FromConfig(authn.AuthConfig{
		Username: "hello",
		Password: "world",
	})))

	return img, err
}

func (r *RemoteImageSource) Images(ctx context.Context) <-chan v1.Image {
	ch := make(chan v1.Image)
	go func() {
		defer close(ch)
		img, err := r.getImage()
		if err == nil {
			digest, derr := img.Digest()
			if derr == nil {
				r.lastDigest = digest.String()
			}
			ch <- img
		}
		if r.reloadInterval <= 0 {
			return
		}
		ticker := time.NewTicker(r.reloadInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				img, err := r.getImage()
				if err != nil {
					continue
				}
				digest, err := img.Digest()
				if err != nil {
					continue
				}
				if r.lastDigest != digest.String() {
					ch <- img
					r.lastDigest = digest.String()
				}
			}
		}
	}()
	return ch
}
