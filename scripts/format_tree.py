#!/usr/bin/env python3
import json
import os

PERSON_KEY_ORDER = [
    "name",
    "fullName",
    "altName",
    "gender",
    "born",
    "died",
    "birthplace",
    "location",
    "parents",
    "photo",
    "notes",
]

UNION_KEY_ORDER = ["partners", "married", "ended", "status", "order"]


def sort_dict(obj, preferred_order):
    out = {}
    keys = list(obj.keys())
    ordered = [k for k in preferred_order if k in keys] + sorted(
        k for k in keys if k not in preferred_order
    )
    for k in ordered:
        val = obj[k]
        if val is not None and val != "":
            out[k] = val
    return out


def main():
    tree_path = os.path.abspath("tree.json")
    with open(tree_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    formatted = {}
    for top_key in ("title", "defaultStartId", "lastUpdated"):
        if top_key in data and data[top_key]:
            formatted[top_key] = data[top_key]

    for k in sorted(data.keys()):
        if k not in ("title", "defaultStartId", "lastUpdated", "people", "unions"):
            formatted[k] = data[k]

    formatted["people"] = {
        pid: sort_dict(data["people"][pid], PERSON_KEY_ORDER)
        for pid in sorted(data["people"].keys())
    }
    formatted["unions"] = [sort_dict(u, UNION_KEY_ORDER) for u in data.get("unions", [])]

    with open(tree_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(formatted, indent=2, ensure_ascii=False) + "\n")

    print("Formatted tree.json with stable sorted keys.")


if __name__ == "__main__":
    main()
