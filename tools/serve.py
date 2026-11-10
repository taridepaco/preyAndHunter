#!/usr/bin/env python3
"""Development server for web/.

Like `python3 -m http.server`, but with caching disabled so edited modules and shaders are always
fetched again, and with a MIME type for .wgsl files. Usage: python3 tools/serve.py [port]
"""
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "web"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".wgsl": "text/plain",
        ".json": "application/json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8091
    handler = functools.partial(Handler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"Prey en http://localhost:{port}/", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
