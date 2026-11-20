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
