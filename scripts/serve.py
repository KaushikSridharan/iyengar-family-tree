#!/usr/bin/env python3
import http.server
import io
import os
import socketserver
import sys
import zipfile

PORT = int(os.environ.get("PORT", "3000"))
SKIP_DIRS = {".git", "__pycache__", "node_modules", "workspace"}


def build_project_zip():
    buf = io.BytesIO()
    root = os.getcwd()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for filename in sorted(filenames):
                if filename.endswith(".pyc"):
                    continue
                full_path = os.path.join(dirpath, filename)
                rel_path = os.path.relpath(full_path, root)
                zf.write(full_path, os.path.join("iyengar-family-tree", rel_path))
    return buf.getvalue()


class StaticHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".webmanifest": "application/manifest+json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".webp": "image/webp",
        ".jpg": "image/jpeg",
        ".ico": "image/x-icon",
    }

    def do_HEAD(self):
        if self.path.split("?")[0] == "/download.zip":
            data = build_project_zip()
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header(
                "Content-Disposition", 'attachment; filename="iyengar-family-tree.zip"'
            )
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        super().do_HEAD()

    def do_GET(self):
        if self.path.split("?")[0] == "/download.zip":
            data = build_project_zip()
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header(
                "Content-Disposition", 'attachment; filename="iyengar-family-tree.zip"'
            )
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def end_headers(self):
        path = self.path.split("?")[0].lower()
        if path.endswith(".webp"):
            self.send_header("Cache-Control", "public, max-age=3600")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format, *args):
        sys.stdout.write("%s - %s\n" % (self.address_string(), format % args))
        sys.stdout.flush()


class ReusableTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with ReusableTCPServer(("0.0.0.0", PORT), StaticHandler) as httpd:
        print(f"Static Family Tree server listening on http://0.0.0.0:{PORT}", flush=True)
        httpd.serve_forever()
