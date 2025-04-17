.PHONY:
setup:
	cd ./benchmark-services && make compose
	cd ./benchmark-scenarios && docker compose up -d

.PHONY: teardown
teardown:
	cd ./benchmark-scenarios && docker compose down
	rm -rf ./benchmark-services/config.json


.PHONY: run-scenarios
run-scenarios:
	cd ./benchmark-scenarios && pnpm run run:all

