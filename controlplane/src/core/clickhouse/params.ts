export type ClickHouseParamValue = string | number | boolean | string[] | number[];

/**
 * ClickHouse parses HTTP query parameters in its "escaped" text format, so a backslash or a control character in a
 * string would be read as an escape sequence (or fail to parse). Array parameters use the quoted format.
 */
const escapeText = (value: string) =>
  value.replaceAll('\\', '\\\\').replaceAll('\t', '\\t').replaceAll('\n', '\\n').replaceAll('\r', '\\r');

export function serializeClickHouseParam(value: ClickHouseParamValue): string {
  if (Array.isArray(value)) {
    const items = (value as (string | number)[]).map((item) =>
      typeof item === 'number' ? item.toString() : `'${escapeText(item).replaceAll("'", "\\'")}'`,
    );
    return `[${items.join(',')}]`;
  }
  if (typeof value === 'string') {
    return escapeText(value);
  }
  return value.toString();
}

/** Collects typed query parameters and hands out their placeholders. */
export class ParamBag {
  readonly params: Record<string, ClickHouseParamValue> = {};
  private counters: Record<string, number> = {};

  add(prefix: string, type: string, value: ClickHouseParamValue) {
    const index = this.counters[prefix] ?? 0;
    this.counters[prefix] = index + 1;
    const name = `${prefix}${index}`;
    this.params[name] = value;
    return `{${name}:${type}}`;
  }

  /**
   * Binds string arrays that belong together (e.g. versions and their names) as one parameter each, or, when one would
   * be longer than ClickHouse accepts, as several aligned chunks named `<name>0`, `<name>1`, …. Returns the references
   * per array.
   */
  addArrays(names: string[], arrays: string[][]): string[][] {
    const chunks = chunkAligned(arrays);
    if (chunks.length === 1) {
      return names.map((name, i) => {
        this.params[name] = arrays[i];
        return [`{${name}:Array(String)}`];
      });
    }
    return names.map((name, i) =>
      chunks.map((chunk, c) => {
        this.params[`${name}${c}`] = chunk[i];
        return `{${name}${c}:Array(String)}`;
      }),
    );
  }

  /** Like add() for one string array, split into several parameters when it is too long for one. */
  addArray(prefix: string, values: string[]): string[] {
    return chunkAligned([values]).map(([chunk]) => this.add(prefix, 'Array(String)', chunk));
  }
}

/** ClickHouse refuses an HTTP parameter longer than http_max_field_value_size (128 KiB by default) once URL-encoded. */
const MAX_PARAM_BYTES = 60_000;

/** Splits aligned arrays at the same indexes so that no chunk of any of them is longer than MAX_PARAM_BYTES. */
function chunkAligned(arrays: string[][]): string[][][] {
  const length = arrays[0]?.length ?? 0;
  const chunks: string[][][] = [];
  let from = 0;
  let sizes = arrays.map(() => 0);
  for (let i = 0; i < length; i++) {
    const added = arrays.map((array) => encodeURIComponent(serializeClickHouseParam([array[i]])).length);
    if (i > from && added.some((size, a) => sizes[a] + size > MAX_PARAM_BYTES)) {
      chunks.push(arrays.map((array) => array.slice(from, i)));
      from = i;
      sizes = arrays.map(() => 0);
    }
    sizes = sizes.map((size, a) => size + added[a]);
  }
  chunks.push(arrays.map((array) => array.slice(from)));
  return chunks;
}
