package clientinfo

import (
    "net/http"
	ctrace "github.com/wundergraph/cosmo/router/pkg/trace"
    "github.com/wundergraph/cosmo/router/pkg/config"
)

type DetailedClientInfo interface {
    Name() string
    Version() string
}

type Token interface {
	// WGRequestToken contains the token to authenticate the request from the platform
	WGRequestToken() string
}

type defaultBuildDetailedClientInfo struct {
    name string
    version string
    wgRequestToken string
}

func (d *defaultBuildDetailedClientInfo) Name() string {
    return d.name
}

func (d *defaultBuildDetailedClientInfo) Version() string {
    return d.version
}

func (d *defaultBuildDetailedClientInfo) WGRequestToken() string {
    return d.wgRequestToken
}

func defaultBuildClientInfo(r *http.Request, clientHeader config.ClientHeader) (DetailedClientInfo, error) {
    clientName := ctrace.GetClientHeader(r.Header, []string{clientHeader.Name, "graphql-client-name", "apollographql-client-name"}, "unknown")
	clientVersion := ctrace.GetClientHeader(r.Header, []string{clientHeader.Version, "graphql-client-version", "apollographql-client-version"}, "missing")
    requestToken := r.Header.Get("X-WG-Token")

    return &defaultBuildDetailedClientInfo{
        name: clientName,
        version: clientVersion,
        wgRequestToken: requestToken,
    }, nil
}

type BuildDetailedClientInfo func(r *http.Request) (DetailedClientInfo, error)

func NewDetailedClientInfoFromRequest(
    r *http.Request,
    clientHeader config.ClientHeader,
    buildDetailedClientInfo *BuildDetailedClientInfo,
) (DetailedClientInfo, error) {
    var detailedClientInfo DetailedClientInfo
    var err error
    if buildDetailedClientInfo == nil {
        detailedClientInfo, err = defaultBuildClientInfo(r, clientHeader)
    } else {
        detailedClientInfo, err = (*buildDetailedClientInfo)(r)
    }

     return detailedClientInfo, err
}
