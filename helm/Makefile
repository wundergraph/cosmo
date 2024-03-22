test: build
	helm lint --strict -f ./cosmo/values.yaml ./cosmo
	kubeconform -strict -summary generated/cosmo.yaml

KAPP_ARGS:="--logs-all"
deploy: build
	kapp deploy $(KAPP_ARGS) -a cosmo -f generated/cosmo.yaml

delete:
	kapp delete -a cosmo

VERSION := $(shell yq '.version' ./cosmo/Chart.yaml)
publish-cosmo-chart:
	helm package cosmo --version $(VERSION)
	helm push cosmo-$(VERSION).tgz oci://ghcr.io/wundergraph/cosmo/helm-charts

VERSION := $(shell yq '.version' ./cosmo/charts/router/Chart.yaml)
publish-router-chart:
	cd cosmo/charts/ && helm package router --version $(VERSION)
	cd cosmo/charts/ && helm push router-$(VERSION).tgz oci://ghcr.io/wundergraph/cosmo/helm-charts

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