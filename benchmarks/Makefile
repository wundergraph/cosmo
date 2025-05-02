.PHONY: setup
setup:
	cd ./benchmark-services && make compose
	cd ./benchmark-scenarios && docker compose up -d

.PHONY: setup-cluster
setup-cluster:
	cd ./benchmark-services && make compose-cluster

.PHONY: teardown
teardown:
	cd ./benchmark-scenarios && docker compose down
	rm -rf ./benchmark-services/config.json


.PHONY: run-scenarios
run-scenarios:
	cd ./benchmark-scenarios && pnpm run run:all

.PHONY: deploy-benchmarker
deploy-benchmarker: setup-cluster
	cd ./helm && make KAPP_ARGS="-y" deploy
	
