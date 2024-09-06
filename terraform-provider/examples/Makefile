default: e2e-apply

FEATURE  				?= provider

e2e-apply:
	rm -f $(FEATURE)/.terraform.lock.hcl
	terraform -chdir=$(FEATURE) init
	terraform -chdir=$(FEATURE) plan
	terraform -chdir=$(FEATURE) apply

e2e-destroy:
	terraform -chdir=$(FEATURE) destroy
