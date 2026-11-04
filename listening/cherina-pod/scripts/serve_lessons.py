#!/usr/bin/env python3
"""用本地 HTTP 打开课程库，让练习进度真正存得住。

为什么需要它：`player.html` 把进度写进浏览器的 localStorage，而 `file://`
打开时各浏览器对 localStorage 的处理不一致（有的按单个文件隔离、有的直接拒绝），
写入失败又被 try/catch 静默吞掉，于是「昨天听了今天没记下来」。
换成一个固定的 `http://127.0.0.1:<端口>` origin 后，进度就会稳定保存。

用法：
  python3 scripts/serve_lessons.py                  # 默认端口 8770，打开四级课程库
  python3 scripts/serve_lessons.py --level cet6
  python3 scripts/serve_lessons.py --port 9000
按 Ctrl+C 停止。
"""

import argparse
import functools
import http.server
import socket
import socketserver
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent / "lessons"


def lan_ips():
    ips = {"127.0.0.1"}
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(ips, key=lambda x: x != "127.0.0.1")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--level", default="cet4", choices=["cet4", "cet6"], help="打开哪个课程库")
    args = ap.parse_args()

    if not ROOT.exists():
        print(f"找不到 {ROOT}，先跑 two_levels.py 生成课程", file=sys.stderr)
        return 2

    # 用 lessons/ 当根目录，这样 cet4 / cet6 两个库都在同一个 origin 下，
    # 进度和收藏可以互相跳转、不会因为路径不同而丢。
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))

    class Server(socketserver.ThreadingTCPServer):
        allow_reuse_address = True

    with Server(("0.0.0.0", args.port), handler) as httpd:
        urls = [f"http://{ip}:{args.port}/{args.level}/index.html" for ip in lan_ips()]
        print("\n  在浏览器打开下面这个地址（第一条是本机）：\n")
        for u in urls:
            print(f"      {u}")
        print(
            "\n  用 http 打开（而不是双击 html），练习进度、收藏、连续天数才会真正保存。"
            "\n  换设备或换浏览器时进度不会跟着走——它存在这台机器的浏览器里。"
            "\n  按 Ctrl+C 停止。\n"
        )
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
