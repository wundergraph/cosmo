import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class Subgraph(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", "0")))
        greeting = "hello world"
        data = {
            "greeting": greeting,
            "farewell": "goodbye",
            "unsupportedLanguage": greeting,
            "card": {"greeting": greeting, "caption": greeting, "welcome": greeting},
        }
        body = json.dumps({"data": data}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


HTTPServer(("0.0.0.0", 4001), Subgraph).serve_forever()
