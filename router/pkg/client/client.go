package client

import (
    "net/http"
	ctrace "github.com/wundergraph/cosmo/router/pkg/trace"
    "github.com/wundergraph/cosmo/router/pkg/config"
)

type Info interface {
    Name() string
    Version() string
}

type Token interface {
	// WGRequestToken contains the token to authenticate the request from the platform
	WGRequestToken() string
}

type defaultBuildInfo struct {
    name string
    version string
    wgRequestToken string
}

func (d *defaultBuildInfo) Name() string {
    return d.name
}

func (d *defaultBuildInfo) Version() string {
    return d.version
}

func (d *defaultBuildInfo) WGRequestToken() string {
    return d.wgRequestToken
}

func defaultBuildClientInfo(r *http.Request, clientHeader config.ClientHeader) (Info, error) {
	clientName := ctrace.GetClientHeader(r.Header, []string{clientHeader.Name, "graphql-client-name", "apollographql-client-name"}, "unknown")
	clientVersion := ctrace.GetClientHeader(r.Header, []string{clientHeader.Version, "graphql-client-version", "apollographql-client-version"}, "missing")
    requestToken := r.Header.Get("X-WG-Token")

    return &defaultBuildInfo{
        name: clientName,
        version: clientVersion,
        wgRequestToken: requestToken,
    }, nil
}

type BuildClientInfo func(r *http.Request) (Info, error)

func NewClientInfoFromRequest(
    r *http.Request,
    clientHeader config.ClientHeader,
    buildClientInfo *BuildClientInfo,
) (Info, error) {
    var info Info
    var err error
    if buildClientInfo == nil {
        info, err = defaultBuildClientInfo(r, clientHeader)
    } else {
        info, err = (*buildClientInfo)(r)
    }

     return info, err
}
