#!/usr/bin/env python3
import http.server
import pathlib
import sys


fixture_directory = pathlib.Path(sys.argv[1]).resolve()
port_file = pathlib.Path(sys.argv[2]).resolve()
handler = lambda *args, **kwargs: http.server.SimpleHTTPRequestHandler(
    *args, directory=str(fixture_directory), **kwargs
)
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
port_file.write_text(str(server.server_port), encoding="utf-8")
server.serve_forever()
