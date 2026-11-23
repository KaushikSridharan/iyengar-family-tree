#!/usr/bin/env python3
import os
import re
import shutil
import subprocess
import sys


def parse_args(argv):
    crop = None
    positional = []
    i = 1
    while i < len(argv):
        if argv[i] == "--crop" and i + 1 < len(argv):
            crop = argv[i + 1]
            i += 2
        else:
            positional.append(argv[i])
            i += 1

    if len(positional) < 2:
        print(
            "Usage: python3 scripts/add_photo.py <source-image> <person-id> [--crop left,top,width,height]",
            file=sys.stderr,
        )
        sys.exit(1)

    source_path, person_id = positional[0], positional[1]
    if not re.match(r"^[a-z0-9-]+$", person_id):
        print(f'Invalid person ID "{person_id}". Use lowercase letters, digits, and hyphens only.', file=sys.stderr)
        sys.exit(1)

    crop_tuple = None
    if crop:
        parts = crop.split(",")
        if len(parts) != 4 or not all(p.isdigit() for p in parts):
            print("Invalid --crop format. Expected: --crop left,top,width,height", file=sys.stderr)
            sys.exit(1)
        crop_tuple = tuple(int(p) for p in parts)

    return source_path, person_id, crop_tuple


def convert_with_imagemagick(cmd, src, dst, size, crop_tuple):
    args = [cmd, src, "-auto-orient"]
    if crop_tuple:
        l, t, w, h = crop_tuple
        args.extend(["-crop", f"{w}x{h}+{l}+{t}", "+repage"])
    args.extend(["-resize", f"{size}x{size}^", "-gravity", "center", "-extent", f"{size}x{size}", "-quality", "84", dst])
    subprocess.run(args, check=True)


def convert_with_ffmpeg(src, dst, size, crop_tuple):
    filters = []
    if crop_tuple:
        l, t, w, h = crop_tuple
        filters.append(f"crop={w}:{h}:{l}:{t}")
    else:
        filters.append("crop=min(iw\\,ih):min(iw\\,ih)")
    filters.append(f"scale={size}:{size}:flags=lanczos")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vf", ",".join(filters), "-c:v", "libwebp", "-quality", "84", dst],
        check=True,
    )


def main():
    src, person_id, crop_tuple = parse_args(sys.argv)
    if not os.path.isfile(src):
        print(f"Source image not found: {src}", file=sys.stderr)
        sys.exit(1)

    os.makedirs("photos", exist_ok=True)
    detail_file = f"{person_id}.webp"
    thumb_file = f"{person_id}.thumb.webp"
    detail_out = os.path.join("photos", detail_file)
    thumb_out = os.path.join("photos", thumb_file)

    magick_cmd = shutil.which("magick") or shutil.which("convert")
    ffmpeg_cmd = shutil.which("ffmpeg")

    if magick_cmd:
        convert_with_imagemagick(magick_cmd, src, detail_out, 400, crop_tuple)
        convert_with_imagemagick(magick_cmd, detail_out, thumb_out, 96, None)
    elif ffmpeg_cmd:
        convert_with_ffmpeg(src, detail_out, 400, crop_tuple)
        convert_with_ffmpeg(detail_out, thumb_out, 96, None)
    else:
        print("Error: install ImageMagick (magick/convert) or ffmpeg to convert photos to WebP.", file=sys.stderr)
        sys.exit(1)

    print(f"Generated {detail_file} (400x400) and {thumb_file} (96x96) in photos/")
    print(f'Set "photo": "{detail_file}" for "{person_id}" in tree.json.')


if __name__ == "__main__":
    main()
