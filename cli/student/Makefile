
.PHONY: build test generate install-wgc

install-wgc:
	@which wgc > /dev/null 2>&1 || npm install -g wgc@latest

make: build

test: install-wgc
	wgc router plugin test .

generate: install-wgc
	wgc router plugin generate .

publish: generate
	wgc router plugin publish .

build: install-wgc
	wgc router plugin build . --debug
