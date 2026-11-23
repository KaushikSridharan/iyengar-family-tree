#!/usr/bin/env python3
import json
import os
import re
import sys
import unicodedata


def main():
    with open(os.path.abspath("tree.json"), "r", encoding="utf-8") as f:
        data = json.load(f)

    existing = set(data.get("people", {}).keys())
    max_num = 0
    for pid in existing:
        m = re.match(r"^p(\d+)", pid)
        if m:
            max_num = max(max_num, int(m.group(1)))

    name_arg = " ".join(sys.argv[1:]).strip()
    slug = ""
    if name_arg:
        norm = unicodedata.normalize("NFD", name_arg)
        ascii_only = "".join(ch for ch in norm if unicodedata.category(ch) != "Mn").lower()
        cleaned = re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-")
        slug = cleaned.split("-")[0] if cleaned else ""

    next_num = max_num + 1
    candidate = f"p{next_num}-{slug}" if slug else f"p{next_num}"
    while candidate in existing:
        next_num += 1
        candidate = f"p{next_num}-{slug}" if slug else f"p{next_num}"

    print(candidate)


if __name__ == "__main__":
    main()
