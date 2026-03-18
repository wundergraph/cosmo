cli = pnpm dlx tsx --env-file ../cli/.env ../cli/src/index.ts router

.PHONY: config-router

config-router:
	$(cli) compose -i scenarios/graphql/configs/cosmo/graph.yaml -o scenarios/graphql/configs/cosmo/config.json
