test: build-dev build-prod
	helm lint -f ./cosmo/values.full.yaml ./cosmo
	kubeconform -strict -summary generated/cosmo.full.yaml

	helm lint -f ./cosmo/values.yaml ./cosmo
	kubeconform -strict -summary generated/cosmo.yaml

KAPP_ARGS := deploy
dev: build-dev
	kapp $(KAPP_ARGS) -a cosmo -f generated/cosmo.full.yaml

prod: build-prod
	kapp deploy -a cosmo -f ./cosmo.yaml

delete:
	kapp delete -a cosmo

docs:
	helm-docs ./cosmo -o CHART.md

build-dev:
	mkdir -p generated
	helm template cosmo -f ./cosmo/values.full.yaml ./cosmo > generated/cosmo.full.yaml

build-prod:
	helm template cosmo -f ./cosmo/values.yaml ./cosmo > generated/cosmo.yaml

delete:
	kapp delete -a cosmo

docker-build-minikube:
	cd .. && make docker-build-minikube

update-kc-realm:
	kubectl create configmap realm --from-file=realm.json=../docker/keycloak/realm.json --dry-run=client -o yaml > realm-config-map.yaml