.PHONY: compose
compose:
	cd "../../cli" && pnpm wgc router compose -i ../benchmarks/benchmark-services/graph.yaml -o ../benchmarks/benchmark-services/config.json

.PHONY: compose-cluster
compose-cluster:
	cd "../../cli" && pnpm wgc router compose -i ../benchmarks/benchmark-services/graph.cluster.yaml -o ../benchmarks/benchmark-services/config.json
