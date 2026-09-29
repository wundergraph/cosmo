test: test-render build
	helm lint --strict -f ./cosmo/values.yaml ./cosmo
	kubeconform -strict -summary generated/cosmo.yaml

.PHONY: test-render test-cluster test-kind
test-render:
	uv run --locked python -m unittest discover -s tests -v

test-cluster:
	@test -n "$(HELM_TEST_KUBECONFIG)" || (echo "Set HELM_TEST_KUBECONFIG to a local cluster's kubeconfig (see README.md)."; exit 1)
	HELM_TEST_KUBECONFIG="$(HELM_TEST_KUBECONFIG)" uv run --locked python -m unittest discover -s tests -v

test-kind:
	@set -eu; \
	test_dir=$$(mktemp -d); \
	cluster_name="cosmo-helm-tests-$$(basename "$$test_dir" | tr '[:upper:].' '[:lower:]-')"; \
	trap 'kind delete cluster --name "$$cluster_name" --kubeconfig "$$test_dir/kubeconfig"; rm -rf "$$test_dir"' EXIT; \
	trap 'exit 130' INT; \
	trap 'exit 143' TERM; \
	kind create cluster --name "$$cluster_name" --kubeconfig "$$test_dir/kubeconfig" --image kindest/node:v1.36.1 --wait 60s; \
	$(MAKE) test-cluster HELM_TEST_KUBECONFIG="$$test_dir/kubeconfig"

KAPP_ARGS:="--logs-all"
deploy: build
	kapp deploy $(KAPP_ARGS) -a cosmo -f generated/cosmo.yaml

delete:
	kapp delete -a cosmo

publish-cosmo-chart:
	helm package cosmo --version $(shell yq '.version' ./cosmo/Chart.yaml)
	helm push cosmo-$(shell yq '.version' ./cosmo/Chart.yaml).tgz oci://ghcr.io/wundergraph/cosmo/helm-charts

publish-router-chart:
	cd cosmo/charts/ && helm package router --version $(shell yq '.version' ./cosmo/charts/router/Chart.yaml)
	cd cosmo/charts/ && helm push router-$(shell yq '.version' ./cosmo/charts/router/Chart.yaml).tgz oci://ghcr.io/wundergraph/cosmo/helm-charts

# Required to verify charts on artifacthub.io
upload-artifacthub-manifest:
	# Cosmo
	cd cosmo && oras push \
	  ghcr.io/wundergraph/cosmo/helm-charts/cosmo:artifacthub.io \
	  --config /dev/null:application/vnd.cncf.artifacthub.config.v1+yaml \
	  artifacthub-repo.yml:application/vnd.cncf.artifacthub.repository-metadata.layer.v1.yaml
	# Router
	cd cosmo/charts/router && oras push \
	  ghcr.io/wundergraph/cosmo/helm-charts/router:artifacthub.io \
	  --config /dev/null:application/vnd.cncf.artifacthub.config.v1+yaml \
	  artifacthub-repo.yml:application/vnd.cncf.artifacthub.repository-metadata.layer.v1.yaml

docs:
	helm-docs ./cosmo -o README.md

build:
	mkdir -p generated
	helm template cosmo -f ./cosmo/values.yaml ./cosmo > generated/cosmo.yaml

delete:
	kapp delete -a cosmo

docker-build-minikube:
	cd .. && make docker-build-minikube

update-kc-realm:
	kubectl create configmap realm --from-file=realm.json=../docker/keycloak/realm.json --dry-run=client -o yaml > realm-config-map.yaml
