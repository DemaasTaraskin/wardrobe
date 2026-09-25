"""Download Miro board originals from the compact list printed by signed_urls.js.

Usage:
    python download.py LIST_FILE DEST_DIR [--limit N] [--workers 8] [--force]

Each non-comment line: save_name|original_name|cdn_path|expires|signature|key_pair_id
The signed CDN URL is rebuilt here (its content-disposition part is derived from the original
name), which keeps the lines short enough to pass through the browser tool output.
Existing non-empty files are skipped, so re-running after a failure only fetches what is missing.
"""
import argparse
import concurrent.futures as cf
import pathlib
import time
import urllib.request
from urllib.parse import quote


def build_url(original, path, expires, sig, key_pair):
    cd = quote(f"attachment; filename=\"{original}\"; filename*=UTF-8''{quote(original, safe='')}", safe="")
    return (f"https://r.miro.com{path}?response-content-disposition={cd}"
            f"&Expires={expires}&Signature={sig}&Key-Pair-Id={key_pair}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("list_file")
    ap.add_argument("dest")
    ap.add_argument("--limit", type=int, default=0, help="download only the first N entries (test run)")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--force", action="store_true", help="re-download files that already exist")
    args = ap.parse_args()

    dest = pathlib.Path(args.dest)
    dest.mkdir(parents=True, exist_ok=True)
    rows = [l.rstrip("\n").split("|") for l in open(args.list_file, encoding="utf-8")
            if l.strip() and not l.startswith("#")]
    rows = [r for r in rows if len(r) == 6]
    if args.limit:
        rows = rows[:args.limit]

    def fetch(row):
        save, original, path, expires, sig, key_pair = row
        target = dest / save
        if target.exists() and target.stat().st_size > 0 and not args.force:
            return ("skip", save)
        if int(expires) < time.time():
            return ("fail", f"{save}: signed link expired - regenerate this chunk with signed_urls.js")
        try:
            with urllib.request.urlopen(build_url(original, path, expires, sig, key_pair), timeout=180) as r:
                target.write_bytes(r.read())
            return ("ok", save)
        except Exception as e:
            return ("fail", f"{save}: {e}")

    with cf.ThreadPoolExecutor(args.workers) as ex:
        results = list(ex.map(fetch, rows))

    bad_images = []
    try:
        from PIL import Image
        for status, save in results:
            if status == "ok":
                try:
                    Image.open(dest / save).verify()
                except Exception as e:
                    bad_images.append(f"{save}: {e}")
    except ImportError:
        pass

    counts = {s: sum(1 for r in results if r[0] == s) for s in ("ok", "skip", "fail")}
    total_mb = sum(p.stat().st_size for p in dest.iterdir() if p.is_file()) / 1048576
    print(f"requested={len(rows)} ok={counts['ok']} skipped={counts['skip']} failed={counts['fail']} "
          f"| files_in_dest={sum(1 for p in dest.iterdir() if p.is_file())} size={total_mb:.0f} MB")
    for status, msg in results:
        if status == "fail":
            print("FAIL", msg)
    for msg in bad_images:
        print("CORRUPT", msg)


if __name__ == "__main__":
    main()
