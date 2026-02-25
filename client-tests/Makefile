test-all: test-apollo-js test-apollo-swift test-apollo-kotlin test-mcp-ts

test-apollo-kotlin:
	cd apollo-kotlin && ./gradlew test

test-apollo-js:
	cd apollo-js && pnpm test

test-apollo-swift:
	cd apollo-swift && swift test

test-mcp-ts:
	cd mcp-ts && pnpm test