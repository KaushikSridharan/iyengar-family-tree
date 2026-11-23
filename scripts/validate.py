#!/usr/bin/env python3
import datetime
import json
import os
import re
import sys

ID_RE = re.compile(r"^[a-z0-9-]+$")
DATE_RE = re.compile(r"^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$")


def parse_tree_date(value):
    if not isinstance(value, str):
        return None
    m = DATE_RE.match(value.strip())
    if not m:
        return None
    year = int(m.group(1))
    month = int(m.group(2)) if m.group(2) else None
    day = int(m.group(3)) if m.group(3) else None
    if month is not None and not (1 <= month <= 12):
        return None
    if day is not None:
        if month is None:
            return None
        try:
            datetime.date(year, month, day)
        except ValueError:
            return None
    return (year, month, day)


def validate_tree(tree, photos_dir="photos", check_photos=True):
    errors = []
    warnings = []

    if not isinstance(tree, dict):
        return ["tree.json must be a JSON object."], warnings

    people = tree.get("people")
    unions = tree.get("unions")
    if not isinstance(people, dict):
        errors.append('Top-level "people" must be an object keyed by person id.')
    if not isinstance(unions, list):
        errors.append('Top-level "unions" must be an array.')
    if errors:
        return errors, warnings

    def label(pid):
        p = people.get(pid)
        if isinstance(p, dict) and p.get("name"):
            return f"{pid} ({p['name']})"
        return str(pid)

    default_start = tree.get("defaultStartId")
    if default_start is not None:
        if not isinstance(default_start, str) or default_start not in people:
            errors.append(f'defaultStartId "{default_start}" does not exist in people.')

    for pid, person in people.items():
        if not ID_RE.match(pid):
            errors.append(f'Invalid person id "{pid}": must contain only lowercase letters, digits, and hyphens.')
        if not isinstance(person, dict):
            errors.append(f"Person {pid} must be an object.")
            continue

        name = person.get("name")
        if not isinstance(name, str) or not name.strip():
            errors.append(f'Person {pid} is missing required non-empty "name".')

        if "fullName" in person and not isinstance(person["fullName"], str):
            errors.append(f'Person {label(pid)} has non-string "fullName".')

        born = person.get("born")
        died = person.get("died")
        if born is not None and parse_tree_date(born) is None:
            errors.append(f'Person {label(pid)} has invalid "born" date "{born}".')
        if died is not None and parse_tree_date(died) is None:
            errors.append(f'Person {label(pid)} has invalid "died" date "{died}".')
        if born and died and parse_tree_date(born) and parse_tree_date(died) and died < born:
            errors.append(f'Person {label(pid)} has "died" ({died}) before "born" ({born}).')

        parents = person.get("parents")
        if parents is not None:
            if not isinstance(parents, list):
                errors.append(f'Person {label(pid)} has non-array "parents".')
            else:
                if len(parents) > 2:
                    errors.append(f"Person {label(pid)} lists {len(parents)} parents (maximum is 2).")
                seen = set()
                for parent_id in parents:
                    if not isinstance(parent_id, str) or parent_id not in people:
                        errors.append(f'Person {label(pid)} references missing parent id "{parent_id}".')
                        continue
                    if parent_id == pid:
                        errors.append(f"Person {label(pid)} lists themselves as a parent.")
                    if parent_id in seen:
                        errors.append(f"Person {label(pid)} lists parent {label(parent_id)} twice.")
                    seen.add(parent_id)

                    parent_rec = people[parent_id]
                    if isinstance(parent_rec, dict) and born and parent_rec.get("born"):
                        c_parsed = parse_tree_date(born)
                        p_parsed = parse_tree_date(parent_rec["born"])
                        if c_parsed and p_parsed:
                            if c_parsed[0] < p_parsed[0]:
                                warnings.append(
                                    f"Person {label(pid)} (born {born}) is born before parent {label(parent_id)} (born {parent_rec['born']})."
                                )
                            elif c_parsed[0] - p_parsed[0] < 12:
                                warnings.append(
                                    f"Person {label(pid)} (born {born}) is born less than 12 years after parent {label(parent_id)} (born {parent_rec['born']})."
                                )

        photo = person.get("photo")
        if photo is not None:
            if not isinstance(photo, str) or not photo.strip():
                errors.append(f'Person {label(pid)} has invalid "photo" value.')
            elif check_photos and not re.match(r"^https?://", photo, re.I):
                detail_path = os.path.join(photos_dir, photo)
                thumb_name = re.sub(r"\.webp$", ".thumb.webp", photo, flags=re.I)
                thumb_path = os.path.join(photos_dir, thumb_name)
                if not os.path.isfile(detail_path):
                    errors.append(f'Person {label(pid)} references missing photo "photos/{photo}".')
                if thumb_name != photo and not os.path.isfile(thumb_path):
                    warnings.append(f'Person {label(pid)} is missing 96px thumbnail "photos/{thumb_name}".')

    # Cycle detection
    visit_state = {}
    stack = []

    def dfs(curr_id):
        visit_state[curr_id] = "visiting"
        stack.append(curr_id)
        for parent_id in people.get(curr_id, {}).get("parents") or []:
            if parent_id not in people:
                continue
            st = visit_state.get(parent_id)
            if st == "visiting":
                idx = stack.index(parent_id)
                cycle = " -> ".join(label(x) for x in stack[idx:] + [parent_id])
                errors.append(f"Ancestry cycle detected: {cycle}")
            elif st is None:
                dfs(parent_id)
        stack.pop()
        visit_state[curr_id] = "visited"

    for pid in people:
        if pid not in visit_state:
            dfs(pid)

    for idx, union in enumerate(unions, start=1):
        if not isinstance(union, dict) or not isinstance(union.get("partners"), list):
            errors.append(f'Union #{idx} must have a "partners" array.')
            continue
        partners = union["partners"]
        if len(partners) != 2:
            errors.append(f"Union #{idx} must have exactly 2 partners.")
            continue
        a, b = partners
        if a not in people:
            errors.append(f'Union #{idx} references missing partner id "{a}".')
        if b not in people:
            errors.append(f'Union #{idx} references missing partner id "{b}".')
        if a == b:
            errors.append(f"Union #{idx} pairs {label(a)} with themselves.")
        married = union.get("married")
        ended = union.get("ended")
        if married is not None and parse_tree_date(married) is None:
            errors.append(f'Union #{idx} ({label(a)} & {label(b)}) has invalid "married" date "{married}".')
        if ended is not None and parse_tree_date(ended) is None:
            errors.append(f'Union #{idx} ({label(a)} & {label(b)}) has invalid "ended" date "{ended}".')
        if married and ended and parse_tree_date(married) and parse_tree_date(ended) and ended < married:
            warnings.append(f'Union #{idx} ({label(a)} & {label(b)}) has "ended" ({ended}) before "married" ({married}).')

    return errors, warnings


def main():
    tree_path = os.path.abspath("tree.json")
    show_report = "--report" in sys.argv

    if not os.path.isfile(tree_path):
        print(f"tree.json not found at {tree_path}", file=sys.stderr)
        sys.exit(1)

    try:
        with open(tree_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:
        print(f"Failed to parse tree.json: {exc}", file=sys.stderr)
        sys.exit(1)

    errors, warnings = validate_tree(data)
    if warnings:
        print(f"Warnings ({len(warnings)}):", file=sys.stderr)
        for w in warnings:
            print(f"  [WARN] {w}", file=sys.stderr)
    if errors:
        print(f"Validation failed with {len(errors)} error(s):", file=sys.stderr)
        for e in errors:
            print(f"  [ERR]  {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Validation passed: {len(data['people'])} people, {len(data['unions'])} unions.")

    if show_report:
        missing_parents = []
        missing_birth = []
        missing_photo = []
        for pid, p in data["people"].items():
            lbl = f"{pid} ({p['name']})"
            if not p.get("parents"):
                missing_parents.append(lbl)
            if not p.get("born"):
                missing_birth.append(lbl)
            if not p.get("photo"):
                missing_photo.append(lbl)
        print("\nNeeds Attention Report:")
        print(f"  Missing parents ({len(missing_parents)}): {', '.join(missing_parents) or 'None'}")
        print(f"  Missing birth year ({len(missing_birth)}): {', '.join(missing_birth) or 'None'}")
        print(f"  Missing photo ({len(missing_photo)}): {', '.join(missing_photo) or 'None'}")


if __name__ == "__main__":
    main()
