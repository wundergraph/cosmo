export function delay(t: number) {
  return new Promise((resolve) => setTimeout(resolve, t));
}

const labelSeparator = '=';

export function splitLabel(label: string) {
  const [key, value] = label.split(labelSeparator);
  return {
    key,
    value,
  };
}

export function joinLabel({ key, value }: { key: string; value: string }) {
  return key + labelSeparator + value;
}

export function normalizeURL(url: string): string {
  // return empty
  if (!url) {
    return url;
  }

  const parsedUrl = new URL(url);
  let path = parsedUrl.pathname;

  // Remove the trailing slash if present
  if (path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  const port = parsedUrl.port ? `:${parsedUrl.port}` : '';
  return `${parsedUrl.protocol}//${parsedUrl.hostname}${port}${path}`;
}

export function isValidUrl(url: string) {
  try {
    // eslint-disable-next-line no-new
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
