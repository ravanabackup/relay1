#!/usr/bin/env python3
"""Serve one original video directly from this device. Python 3.8+, no packages."""

import argparse
import mimetypes
import re
import secrets
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit


def local_address():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            # Selecting the default network route does not send video or a packet.
            probe.connect(("192.0.2.1", 9))
            return probe.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", help="Full path to the video you want to stream")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--bind", default="0.0.0.0", help="IPv4 interface to listen on")
    parser.add_argument("--advertise", help="LAN or trusted VPN IPv4 address shown in the URL")
    args = parser.parse_args()
    source = Path(args.video).expanduser().resolve()
    if not source.is_file():
        parser.error("Video not found. Supply the full path to an existing file.")
    if not 1 <= args.port <= 65535:
        parser.error("Port must be between 1 and 65535.")

    token = secrets.token_urlsafe(24)
    stream_path = "/stream/" + token + "/" + quote(source.name, safe="")
    decoded_path = ("/stream/" + token + "/" + source.name).encode("utf-8")
    mime = mimetypes.guess_type(source.name)[0] or "application/octet-stream"

    class VideoHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_args):
            # Do not log the private link or track viewers.
            pass

        def do_HEAD(self):
            self.serve_video(head_only=True)

        def do_GET(self):
            self.serve_video(head_only=False)

        def serve_video(self, head_only):
            requested_path = unquote(urlsplit(self.path).path).encode("utf-8")
            if not secrets.compare_digest(requested_path, decoded_path):
                self.send_error(404, "Stream not found")
                return
            try:
                media = source.open("rb")
            except OSError:
                self.send_error(404, "Source video is no longer available")
                return

            with media:
                media.seek(0, 2)
                size = media.tell()
                start, end = 0, size - 1
                partial = False
                requested = None if head_only else self.headers.get("Range")

                if requested:
                    match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested.strip())
                    valid = match is not None and bool(match.group(1) or match.group(2))
                    if valid:
                        first, last = match.groups()
                        if first:
                            start = int(first)
                            end = min(int(last), size - 1) if last else size - 1
                        else:
                            suffix = int(last)
                            start = max(0, size - suffix)
                            end = size - 1
                        valid = size > 0 and 0 <= start <= end < size
                    if not valid:
                        self.send_response(416)
                        self.send_header("Content-Range", "bytes */" + str(size))
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return
                    partial = True

                length = max(0, end - start + 1)
                self.send_response(206 if partial else 200)
                self.send_header("Content-Type", mime)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(length))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                if partial:
                    self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
                self.end_headers()
                if head_only:
                    return

                # Range requests enable seeking; bounded reads avoid copying the file.
                media.seek(start)
                remaining = length
                try:
                    while remaining:
                        chunk = media.read(min(256 * 1024, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
                except (BrokenPipeError, ConnectionResetError, TimeoutError):
                    pass

    address = args.advertise or (local_address() if args.bind == "0.0.0.0" else args.bind)
    try:
        server = ThreadingHTTPServer((args.bind, args.port), VideoHandler)
    except OSError as error:
        parser.error("Cannot start server: %s. Try --port 8766." % error)
    server.daemon_threads = True
    print("\nRELAY - direct video streaming")
    print("Original file: " + str(source))
    print("\nPaste this URL into VLC or the Relay VLC tab:\n")
    print("http://%s:%d%s" % (address, args.port, stream_path))
    print("\nSame-device URL: http://127.0.0.1:%d%s" % (args.port, stream_path))
    print("\nKeep this terminal and your device awake. Ctrl+C stops sharing.")
    print("Use a trusted LAN or VPN. HTTP is not encrypted; anyone with the link can watch.")
    print("If the address is incorrect, rerun with --advertise YOUR_LAN_IP.\n", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStream stopped. The old link is no longer active.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()