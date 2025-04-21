.PHONY: test
test: build
	helm lint -f ./.generated/values.yaml .
	kubeconform -output pretty -strict -skip BackendConfig,FrontendConfig,Config -summary .generated/benchmarks-cloud.yaml

.PHONY: deploy
KAPP_ARGS := --diff-changes
deploy: build
	kapp deploy $(KAPP_ARGS) -a benchmarks -n ${NAMESPACE} -f .generated/benchmarks-cloud.resolved.yaml

.PHONY: build
build: load-secrets
	helm template --debug benchmarks -n ${NAMESPACE} --create-namespace -f ./.generated/values.yaml --set-file router.configuration.executionConfig=./router.config.json ./benchmarks-chart > .generated/benchmarks-cloud.yaml
	kbld -f .generated/benchmarks-cloud.yaml > .generated/benchmarks-cloud.resolved.yaml

.PHONY: delete
delete:
	kapp delete -n ${NAMESPACE} -a benchmarks

.PHONY: load-secrets
load-secrets: load-deployment-secrets inject-versions inject-image-repository

.PHONY: load-deployment-secrets
load-deployment-secrets:
	mkdir -p ./.generated
	op inject -f -i ./benchmarks-chart/values.yaml -o ./.generated/values.yaml

.PHONY: delete-secrets
delete-secrets:
	rm -rf generated

.PHONY: update-deployment-secrets
update-deployment-secrets:
	helm dependencies update

.PHONY: check-namespace
check-namespace:
	kubectl get namespace ${NAMESPACE} >/dev/null 2>&1 && echo true || echo false

.PHONY: inject-versions
inject-versions:
	yq -i '.router.image.version = "${IMAGE_VERSION}"' ./.generated/values.yaml
	yq -i '.accounts.image.version = "${IMAGE_VERSION}"' ./.generated/values.yaml
	yq -i '.chat.image.version = "${IMAGE_VERSION}"' ./.generated/values.yaml
	yq -i '.products.image.version = "${IMAGE_VERSION}"' ./.generated/values.yaml

.PHONY: inject-image-repository
inject-image-repository:
	yq -i '.router.image.repository = "${IMAGE_REPOSITORY}"' ./.generated/values.yaml
	yq -i '.accounts.image.repository = "${IMAGE_REPOSITORY}"' ./.generated/values.yaml
	yq -i '.chat.image.repository = "${IMAGE_REPOSITORY}"' ./.generated/values.yaml
	yq -i '.products.image.repository = "${IMAGE_REPOSITORY}"' ./.generated/values.yaml
