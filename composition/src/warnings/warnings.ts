import { QUOTATION_JOIN } from '../utils/string-constants';

export function invalidOverrideTargetSubgraphNameWarning(
  subgraphName: string,
  parentTypeName: string,
  fieldNames: string[],
): string {
  return (
    `The object type "${parentTypeName}" defines the directive "@override(from: "${subgraphName})" on the following field` +
    (fieldNames.length > 1 ? 's' : '') +
    `: "` +
    fieldNames.join(QUOTATION_JOIN) +
    `".\n` +
    `The required "from" argument of type "String!" should be provided with an existing subgraph name.\n` +
    `However, a subgraph by the name of "${subgraphName}" does not exist.\n` +
    `If this subgraph has been recently deleted, remember to clean up unused @override directives that reference this subgraph.`
  );
}
