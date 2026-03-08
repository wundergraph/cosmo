---
path: "connect/**"
---

# Connect Standards

- Filter out `@requires` fields from entity messages in protobuf generation since they're resolved by different RPCs (#2439)
- Skip special GraphQL federation fields like `_entities` and `_service` when generating protobuf messages (#2439)
- For abstract types (interfaces/unions), normalize selection sets by pushing interface-level fields into inline fragments before gRPC mapping (#2439)
- Use gqlgen YAML config with `skip_runtime: true` instead of code annotations for directive handling (#2290)
- Deduplicate scalar type mappings like `SCALAR_TYPE_MAP` across protographic files - establish single source of truth (#2439)
- Use `Object.entries()` iteration over manual key extraction when working with GraphQL type maps (#2290)
- Remove unused imports immediately rather than leaving them in the codebase (#2290)
- Use nullable argument checks like `(ctx.node.arguments?.length ?? 0) === 0` for safer SDL validation (#2290)
- Document why abstract selection normalization is necessary for gRPC compatibility in visitor classes (#2439)
- Handle empty string assignments explicitly in SDL-to-mapping contexts with proper guards (#2439)
- Include test cases for multiple federation keys and complex union/interface nesting scenarios (#2439)
- Use descriptive type names like `CreateRequiredFieldsVisitorOptions` instead of generic names (#2439)
- Align ESLint rules with other TypeScript projects in Cosmo rather than copying from unrelated components (#2439)
- Consider union member self-references when implementing deduplication logic for protobuf messages (#2439)
- Validate against multiple `@requires` directives per field during SDL processing (#2439)
