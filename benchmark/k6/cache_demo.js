import http from "k6/http";
import { check, fail } from "k6";
import { Counter, Rate } from "k6/metrics";

const payload = JSON.parse(__ENV.BENCHMARK_PAYLOAD || "{}");

if (!payload.url || !payload.query) {
  fail("BENCHMARK_PAYLOAD must include url and query");
}

const mismatchRate = new Rate("response_mismatch_rate");
const graphqlErrorRate = new Rate("graphql_error_rate");
const mismatchCount = new Counter("response_mismatch_count");

function normalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJson(item));
  }

  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeJson(value[key]);
    }
    return out;
  }

  return value;
}

function normalizeResponseForComparison(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return normalizeJson(value);
  }

  const response = JSON.parse(JSON.stringify(value));
  const extensions = response.extensions;

  if (extensions && typeof extensions === "object" && !Array.isArray(extensions)) {
    delete extensions.trace;

    if (Object.keys(extensions).length === 0) {
      delete response.extensions;
    }
  }

  return normalizeJson(response);
}

const expectedBody = JSON.stringify(
  normalizeResponseForComparison(payload.expectedBody),
);

export const options = payload.options || {
  stages: [
    { duration: "30s", target: 20 },
    { duration: "2m", target: 20 },
    { duration: "10s", target: 0 },
  ],
};

export default function () {
  const mergedHeaders = Object.assign(
    { "content-type": "application/json" },
    payload.headers || {},
  );

  const response = http.post(
    payload.url,
    JSON.stringify({
      operationName: payload.operationName,
      query: payload.query,
      variables: payload.variables || {},
    }),
    {
      headers: mergedHeaders,
    },
  );

  const ok = check(response, {
    "http status is 200": (res) => res.status === 200,
  });

  if (!ok) {
    mismatchRate.add(true);
    mismatchCount.add(1);
    graphqlErrorRate.add(false);
    return;
  }

  let body;
  try {
    body = response.json();
  } catch (_err) {
    // Parse failure is both a response mismatch and a graphql-error-equivalent
    // (the server returned a non-JSON body or truncated JSON under load).
    mismatchRate.add(true);
    mismatchCount.add(1);
    graphqlErrorRate.add(true);
    return;
  }

  const hasGraphqlErrors = Array.isArray(body?.errors) && body.errors.length > 0;
  graphqlErrorRate.add(hasGraphqlErrors);

  const sameBody =
    JSON.stringify(normalizeResponseForComparison(body)) === expectedBody;

  const assertionOk = check(
    { body, sameBody, hasGraphqlErrors },
    {
      "graphql errors absent": (data) => !data.hasGraphqlErrors,
      "response matches expected fixture": (data) => data.sameBody,
    },
  );

  if (!assertionOk || !sameBody) {
    mismatchRate.add(true);
    mismatchCount.add(1);
  } else {
    mismatchRate.add(false);
  }
}
