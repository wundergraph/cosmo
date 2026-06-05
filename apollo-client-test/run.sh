curl 'http://localhost:3026/graphql' \
  -H 'Accept-Language: en-UA,en;q=0.9,uk-UA;q=0.8,uk;q=0.7,en-GB;q=0.6,en-US;q=0.5' \
  -H 'Cache-Control: no-cache' \
  -H 'Connection: keep-alive' \
  -H 'DNT: 1' \
  -H 'Origin: http://localhost:4000' \
  -H 'Pragma: no-cache' \
  -H 'Sec-Fetch-Dest: empty' \
  -H 'Sec-Fetch-Mode: cors' \
  -H 'Sec-Fetch-Site: same-origin' \
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36' \
  -H 'accept: application/graphql-response+json, application/json, multipart/mixed' \
  -H 'content-type: application/json' \
  -H 'sec-ch-ua: "Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "macOS"' \
  --data-raw '{"query":"query a { me { ... @defer { name } id } }","operationName":"a","extensions":{}}'
#  --data-raw '{"query":"query ComplexDeferredQuery{me{name posts{title}...on User@defer(label:\"userPosts\"){posts{...on Post@defer(label:\"postComments\"){comments{text ...@defer{author}}}}}id}}","operationName":"ComplexDeferredQuery","extensions":{}}'
