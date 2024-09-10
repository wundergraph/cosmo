default: e2e-apply

FEATURE  				?= examples/provider
FLAGS 					?= -auto-approve
INIT_FLAGS				?= -upgrade

e2e-init:
	terraform -chdir=$(FEATURE) init $(INIT_FLAGS)

e2e-clean:
	rm -rf $(FEATURE)/.terraform
	rm -f $(FEATURE)/.terraform.lock.hcl
	rm -f $(FEATURE)/terraform.tfstate
	rm -f $(FEATURE)/terraform.tfstate.backup

e2e-apply: e2e-init
	terraform -chdir=$(FEATURE) plan
	terraform -chdir=$(FEATURE) apply $(FLAGS)

e2e-destroy:
	terraform -chdir=$(FEATURE) destroy $(FLAGS)
