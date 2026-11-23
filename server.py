"""Local server for Badge Press. Keeps pages from sticking in the browser cache."""

import os
import sys
import threading
import time
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 8734
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


def badge_press_is_up(url):
    try:
        with urllib.request.urlopen(url, timeout=1) as response:
            return b"Badge Press" in response.read(4096)
    except Exception:
        return False


def main():
    os.chdir(ROOT)
    url = "http://127.0.0.1:%s/" % PORT
    # A second copy must not bind this port. On Windows that steals connections
    # and the browser reports "Empty response".
    if badge_press_is_up(url):
        print("Badge Press is already running at %s" % url)
        if "--open" in sys.argv:
            webbrowser.open(url)
        return 0
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        print(
            "Port %s is already in use. Close the other Badge Press window and try again."
            % PORT,
            file=sys.stderr,
        )
        return 1
    print("Badge Press is running at %s" % url)
    print("Close this window to stop it.")
    if "--open" in sys.argv:
        threading.Thread(
            target=lambda: (time.sleep(0.4), webbrowser.open(url)),
            daemon=True,
        ).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
