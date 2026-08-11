export const isValidHeaderName = (name: string) => /^[\^`\-\w!#$%&'*+.|~]+$/.test(name);

export const validateHeaders = (headers: Record<string, string>) => {
  for (const headersKey in headers) {
    if (!isValidHeaderName(headersKey)) {
      throw new TypeError(`Header name must be a valid HTTP token [${headersKey}]`);
    }
  }
};

export const substituteHeadersFromEnv = (headers: Record<string, string>, graphId: string) => {
  const env = JSON.parse(localStorage.getItem('playground:env') || '{}');
  const graphEnv: Record<string, any> | undefined = env[graphId];

  if (!graphEnv) {
    return headers;
  }

  const storedHeaders: Record<string, any> = {};

  Object.entries(graphEnv).forEach(([key, value]) => {
    if (value === 'true' || value === 'false') {
      storedHeaders[key] = value === 'true';
    } else if (!isNaN(value as any) && value !== '') {
      storedHeaders[key] = Number(value);
    } else {
      storedHeaders[key] = value;
    }
  });

  for (const key in headers) {
    let value = headers[key];
    const placeholderRegex = /{\s*{\s*(\w+)\s*}\s*}/g;

    if (typeof value !== 'string') {
      continue;
    }

    value = value.replace(placeholderRegex, (match, p1) => {
      if (storedHeaders[p1] !== undefined) {
        return storedHeaders[p1];
      } else {
        console.warn(`No value found for placeholder: ${p1}`);
        return match;
      }
    });

    headers[key] = value;
  }

  return headers;
};
