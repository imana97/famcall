from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Pages(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/privacy", "/terms", "/delete-account"):
            self.path = path + ".html"
        return super().do_GET()


root = Path(__file__).resolve().parents[1] / "website"
ThreadingHTTPServer(("127.0.0.1", 4174), partial(Pages, directory=str(root))).serve_forever()
