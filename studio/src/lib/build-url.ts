const pathTemplateRegex = /:[_A-Za-z]+[_A-Za-z0-9]*/;

// https://github.com/sindresorhus/type-fest/blob/48ddc4ba71cb215c3e3d98b0257360edc229fa75/source/primitive.d.ts
type Primitive = null | undefined | string | number | boolean;

// https://github.com/sindresorhus/type-fest/blob/48ddc4ba71cb215c3e3d98b0257360edc229fa75/source/simplify.d.ts
type Simplify<T> = { [KeyType in keyof T]: T[KeyType] } & {};

type QueryParams<Query extends string> = Query extends `${infer Param}=${string}&${infer Rest}`
  ? { [K in Param | keyof QueryParams<Rest>]?: Primitive }
  : Query extends `${infer Param}=${string}`
    ? { [K in Param]?: Primitive }
    : {};

type PathParams<Path extends string> = Path extends `/:${infer Param}/${infer Rest}`
  ? { [K in Param | keyof PathParams<`/${Rest}`>]: Primitive }
  : Path extends `/:${infer Param}`
    ? { [K in Param]: Primitive }
    : Path extends `:${infer Param}`
      ? { [K in Param]: Primitive }
      : {};

type BuildUrlParams<Template extends string> = Template extends `${infer Path}?${infer Query}`
  ? Simplify<PathParams<Path> & Omit<QueryParams<Query>, keyof PathParams<Path>>>
  : PathParams<Template>;

const ALLOWED_TYPES = new Set(['string', 'number', 'boolean']);

/**
 * Receives a template string and builds an URL based on the provided parameters, ignoring any
 * empty values and adding any remaining to the search parameters of the URL.
 *
 * @param template The template string to render
 * @param params The parameters to substitute when rendering the template, unused params become query params
 * @example
 * // returns 'http.../test/default/graph/graph'
 * buildUrl('/:orgSlug/:namespace/graph/:slug', { orgSlug: 'test', namespace: 'default', slug: 'graph', })
 * @example
 * // returns 'http.../test?filter=no&range=1..2'
 * buildUrl('/:orgSlug/:namespace/graph/:slug?filter=yes', {
 *   orgSlug: 'test',
 *   namespace: 'default',
 *   slug: 'graph',
 *   filter: 'no',
 *   range: '1..2',
 * })
 * @example
 * // returns 'http.../test?filter=yes&range=1..2'
 * buildUrl('/:orgSlug?filter=yes', { orgSlug: 'test', range: '1..2' }
 */
export function buildUrl<
  Template extends string = string,
  ExtraParams extends Record<string, Primitive> = Record<string, Primitive>,
>(template: Template, params?: Simplify<BuildUrlParams<Template> & ExtraParams>): string {
  const finalPathSegments: string[] = [];
  const parametersMap = new Map<string, Primitive>(Object.entries(params ?? {}));

  let url = new URL(
    template,
    typeof window === 'undefined' ? process.env.NEXT_PUBLIC_COSMO_STUDIO_URL : window.location.origin,
  );

  const hasTrailingSlash = url.pathname.endsWith('/');
  const templateSegments = url.pathname.split('/');
  for (const segment of templateSegments) {
    if (segment.length === 0) {
      // Ignore empty segments
      continue;
    }

    if (pathTemplateRegex.test(segment)) {
      const key = segment.slice(1);
      if (!parametersMap.has(key)) {
        // The parameter was not provided in the parameter object, skip the segment
        continue;
      }

      /**
       * Make sure that the value is not empty and of a valid type, we are avoiding `!value` as `0` could
       * still be provided
       */
      const value = parametersMap.get(key);
      parametersMap.delete(key);
      if (!isValueAllowed(value)) {
        continue;
      }

      finalPathSegments.push(encodeURIComponent(value));
    } else {
      // The segment doesn't represent a parameter, push it as is
      finalPathSegments.push(segment);
    }
  }

  // Update the `pathname` for the URL by joining the segments
  url.pathname = finalPathSegments.length === 0 ? '/' : finalPathSegments.join('/');
  if (hasTrailingSlash) {
    url.pathname += '/';
  }

  // If we got additional parameters, add/overwrite them to the query parameters preserving already existing ones
  for (const [key, value] of parametersMap.entries().toArray()) {
    if (!isValueAllowed(value)) {
      continue;
    }

    url.searchParams.set(key, value.toString());
  }

  return url.toString();
}

function isValueAllowed(value: unknown): value is string | number | boolean {
  return value !== undefined && value !== null && value !== '' && ALLOWED_TYPES.has(typeof value);
}
