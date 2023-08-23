export interface Service {
  name: string | ServiceKeys;
  color: string;
}

export const getSpanName = (
  spanName: string,
  httpTarget: string,
  httpURL: string,
  httpMethod: string
) => {
  // Span kind: server
  if (httpTarget != "") {
    try {
      return `${httpMethod} ${
        new URL(httpTarget, "http://127.0.0.1").pathname
      }`;
    } catch (e) {}
  } else {
    // span kind: client
    try {
      return `${httpMethod} ${new URL(httpURL).pathname}`;
    } catch (e) {}
  }

  // fallback
  return spanName;
};

export const enum ServiceKeys {
  Router = "wundergraph-cosmo-router",
}

const ServiceMap = {
  [ServiceKeys.Router]: "router",
};

// mapServiceName maps the service name to a more readable name
// or returns the original name if no mapping is found
export const mapServiceName = (serviceName: string) => {
  return ServiceMap[serviceName as ServiceKeys] || serviceName;
};

export const mapSpanKind: Record<string, string> = {
  SPAN_KIND_CLIENT: "client",
  SPAN_KIND_SERVER: "server",
};

export const mapStatusCode: Record<string, string> = {
  STATUS_CODE_UNSET: "unset",
  STATUS_CODE_OK: "ok",
  STATUS_CODE_ERROR: "error",
};

export function selectColor(number: number) {
  const hue = number * 277;
  return `hsl(${hue},60%,48%)`;
}
