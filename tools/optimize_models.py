#!/usr/bin/env python3
"""
optimize_models.py

GLB texture downscaler for Valence Garage v2.

Pure Python 3.12 plus Pillow. No node, no glTF tooling, no build step.

What it does:
  - Parses the binary GLB container by hand (12 byte header, then chunks:
    a JSON chunk followed by a BIN chunk).
  - Finds embedded images in the JSON (bufferView referenced, mime image/png
    or image/jpeg), decodes each with Pillow.
  - Downscales any texture whose longest side exceeds a target (default 1024,
    or 512 for the heavy models) so the folder fits the weight budget.
  - Re-encodes each image: JPEG quality 82 when the texture role does not use
    an alpha channel, otherwise PNG (to preserve transparency).
  - Rebuilds the BIN chunk and rewrites every bufferView byteOffset and
    byteLength, keeps 4 byte alignment, fixes the total length in the header.
  - Does NOT touch mesh geometry, accessors, or animations. Only image
    bufferViews are replaced. Every other bufferView is copied byte for byte.
  - Re-parses the output to verify integrity.

Budget (SPEC-V2): every output at or under about 25 MB, total folder well
under 100 MB. If 1024 is not enough for a heavy model, it drops to 512.
Geometry dominated models with no oversized textures are copied as is.

Usage:
  python optimize_models.py
  python optimize_models.py --src ..\\..\\models --dst ..\\models
"""

import argparse
import io
import json
import os
import struct
import sys

from PIL import Image

# GLB constants
GLB_MAGIC = 0x46546C67  # 'glTF' little endian
GLB_VERSION = 2
CHUNK_JSON = 0x4E4F534A  # 'JSON'
CHUNK_BIN = 0x004E4942   # 'BIN\0'

BUDGET_BYTES = 25 * 1024 * 1024
JPEG_QUALITY = 82

# Per file target longest side. Heavy models go straight to 512.
# Anything not listed uses DEFAULT_MAX. A second pass drops to 512 if a file
# is still over budget after the first pass.
DEFAULT_MAX = 1024
PER_FILE_MAX = {
    "aston-valkyrie.glb": 512,
    "koenigsegg-one1.glb": 512,
}

DEFAULT_SRC = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "models")
)
DEFAULT_DST = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "models")
)


def read_glb(path):
    """Return (json_dict, bin_bytes). Raises on malformed input."""
    with open(path, "rb") as f:
        data = f.read()
    if len(data) < 12:
        raise ValueError("file too small to be a GLB")
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC:
        raise ValueError("bad GLB magic")
    if version != GLB_VERSION:
        raise ValueError("unsupported GLB version %d" % version)
    if length != len(data):
        # Not fatal for reading, but worth knowing.
        pass
    offset = 12
    json_chunk = None
    bin_chunk = b""
    while offset + 8 <= len(data):
        clen, ctype = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset:offset + clen]
        offset += clen
        if ctype == CHUNK_JSON:
            json_chunk = chunk
        elif ctype == CHUNK_BIN:
            bin_chunk = chunk
        # Unknown chunk types are ignored per the spec.
    if json_chunk is None:
        raise ValueError("no JSON chunk found")
    # JSON chunk is padded with spaces (0x20); strip trailing padding.
    text = json_chunk.rstrip(b"\x20").decode("utf-8")
    return json.loads(text), bin_chunk


def pad4(n):
    """Bytes needed to reach the next 4 byte boundary."""
    return (4 - (n % 4)) % 4


def write_glb(path, gltf, bin_bytes):
    """Assemble and write a GLB. Handles chunk padding and header length."""
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_bytes += b"\x20" * pad4(len(json_bytes))  # pad JSON with spaces
    bin_pad = pad4(len(bin_bytes))
    bin_bytes = bin_bytes + b"\x00" * bin_pad       # pad BIN with zeros

    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    out = io.BytesIO()
    out.write(struct.pack("<III", GLB_MAGIC, GLB_VERSION, total))
    out.write(struct.pack("<II", len(json_bytes), CHUNK_JSON))
    out.write(json_bytes)
    out.write(struct.pack("<II", len(bin_bytes), CHUNK_BIN))
    out.write(bin_bytes)
    with open(path, "wb") as f:
        f.write(out.getvalue())


def image_role_needs_alpha(gltf, image_index):
    """
    Decide whether an image, given how the materials reference it, needs an
    alpha channel preserved. Only baseColor textures on non opaque materials
    are treated as alpha bearing by role. Normal, metalRough, occlusion,
    emissive and opaque baseColor never need alpha.
    """
    textures = gltf.get("textures", [])
    materials = gltf.get("materials", [])

    # Which texture indices point at this image.
    tex_for_image = set()
    for ti, t in enumerate(textures):
        if t.get("source") == image_index:
            tex_for_image.add(ti)
    if not tex_for_image:
        return False

    for m in materials:
        pbr = m.get("pbrMetallicRoughness", {})
        bc = pbr.get("baseColorTexture")
        if bc and bc.get("index") in tex_for_image:
            if m.get("alphaMode", "OPAQUE") != "OPAQUE":
                return True
        # transmission base color also carries alpha meaning in some exports;
        # be conservative and keep alpha if the material is a transmission one.
        ext = m.get("extensions", {})
        if "KHR_materials_transmission" in ext:
            # transmission textures are grayscale, no alpha needed, but if this
            # image is the base color of a transmissive material keep alpha.
            if bc and bc.get("index") in tex_for_image:
                return True
    return False


def downscale(img, max_side):
    w, h = img.size
    longest = max(w, h)
    if longest <= max_side:
        return img, False
    scale = max_side / float(longest)
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    return img.resize((nw, nh), Image.LANCZOS), True


def encode_image(img, needs_alpha):
    """Return (bytes, mime). JPEG when alpha not needed, else PNG."""
    has_real_alpha = False
    if img.mode in ("RGBA", "LA", "PA") or (
        img.mode == "P" and "transparency" in img.info
    ):
        rgba = img.convert("RGBA")
        alpha = rgba.getchannel("A")
        lo, hi = alpha.getextrema()
        has_real_alpha = lo < 255
        img = rgba

    keep_alpha = needs_alpha or has_real_alpha
    buf = io.BytesIO()
    if keep_alpha:
        img.convert("RGBA").save(buf, format="PNG", optimize=True)
        return buf.getvalue(), "image/png"
    img.convert("RGB").save(
        buf, format="JPEG", quality=JPEG_QUALITY, optimize=True
    )
    return buf.getvalue(), "image/jpeg"


def optimize(gltf, bin_bytes, max_side):
    """
    Rebuild the BIN chunk, re-encoding image bufferViews and copying every
    other bufferView unchanged. Returns (new_gltf, new_bin, stats).
    gltf is mutated in place for bufferView and image entries.
    """
    buffer_views = gltf.get("bufferViews", [])
    images = gltf.get("images", [])

    # Map bufferView index -> new bytes for image views.
    replaced = {}
    n_scaled = 0
    n_recoded = 0
    for idx, im in enumerate(images):
        bv_index = im.get("bufferView")
        if bv_index is None:
            continue  # external or data uri image, leave alone
        bv = buffer_views[bv_index]
        start = bv.get("byteOffset", 0)
        length = bv["byteLength"]
        raw = bin_bytes[start:start + length]
        try:
            src = Image.open(io.BytesIO(raw))
            src.load()
        except Exception as exc:  # noqa: BLE001
            print("    warn: could not decode image %d (%s), copied as is"
                  % (idx, exc))
            replaced[bv_index] = raw
            continue
        scaled_img, did_scale = downscale(src, max_side)
        if did_scale:
            n_scaled += 1
        needs_alpha = image_role_needs_alpha(gltf, idx)
        new_bytes, mime = encode_image(scaled_img, needs_alpha)
        # Only keep the new encoding if it is actually smaller; otherwise keep
        # the original bytes to avoid inflating a file.
        if len(new_bytes) < len(raw):
            replaced[bv_index] = new_bytes
            im["mimeType"] = mime
            n_recoded += 1
        else:
            replaced[bv_index] = raw
        # image bufferViews do not carry byteStride, safe to resize.

    # Rebuild BIN preserving order of bufferViews by their original offset so
    # that any interleaved accessor data stays contiguous and valid. We copy
    # non image views verbatim and drop image views in with new lengths.
    order = sorted(
        range(len(buffer_views)),
        key=lambda i: buffer_views[i].get("byteOffset", 0),
    )
    new_bin = io.BytesIO()
    for i in order:
        bv = buffer_views[i]
        old_start = bv.get("byteOffset", 0)
        old_len = bv["byteLength"]
        if i in replaced:
            chunk = replaced[i]
        else:
            chunk = bin_bytes[old_start:old_start + old_len]
        new_offset = new_bin.tell()
        new_bin.write(chunk)
        bv["byteOffset"] = new_offset
        bv["byteLength"] = len(chunk)
        # 4 byte align the next view.
        pad = pad4(new_bin.tell())
        if pad:
            new_bin.write(b"\x00" * pad)

    new_bin_bytes = new_bin.getvalue()

    # Single buffer, update its byteLength.
    if gltf.get("buffers"):
        gltf["buffers"][0]["byteLength"] = len(new_bin_bytes)

    stats = {"scaled": n_scaled, "recoded": n_recoded}
    return gltf, new_bin_bytes, stats


def verify(path):
    """Re-parse the output GLB and sanity check bufferView bounds."""
    gltf, bin_bytes = read_glb(path)
    bl = len(bin_bytes)
    for i, bv in enumerate(gltf.get("bufferViews", [])):
        end = bv.get("byteOffset", 0) + bv["byteLength"]
        if end > bl:
            raise ValueError(
                "bufferView %d overruns BIN (%d > %d)" % (i, end, bl)
            )
    # Try to decode every image again.
    for idx, im in enumerate(gltf.get("images", [])):
        bv_index = im.get("bufferView")
        if bv_index is None:
            continue
        bv = gltf["bufferViews"][bv_index]
        raw = bin_bytes[bv.get("byteOffset", 0):
                        bv.get("byteOffset", 0) + bv["byteLength"]]
        Image.open(io.BytesIO(raw)).verify()
    return len(gltf.get("bufferViews", [])), len(gltf.get("images", []))


def texture_bytes(gltf, bin_len):
    """Sum of embedded image bufferView bytes."""
    total = 0
    bvs = gltf.get("bufferViews", [])
    for im in gltf.get("images", []):
        if "bufferView" in im:
            total += bvs[im["bufferView"]]["byteLength"]
    return total


def process_file(src_path, dst_path, name):
    in_size = os.path.getsize(src_path)
    gltf, bin_bytes = read_glb(src_path)
    tex_bytes = texture_bytes(gltf, len(bin_bytes))
    geom_bytes = len(bin_bytes) - tex_bytes
    n_images = len(gltf.get("images", []))

    note = ""

    # Geometry dominated and already under budget: copy as is.
    if in_size <= BUDGET_BYTES and (n_images == 0 or tex_bytes < 2 * 1024 * 1024):
        with open(src_path, "rb") as fsrc, open(dst_path, "wb") as fdst:
            fdst.write(fsrc.read())
        note = "geometry dominated, copied as is"
        out_size = os.path.getsize(dst_path)
        verify(dst_path)
        return {
            "name": name, "in": in_size, "out": out_size,
            "note": note, "images": n_images,
        }

    max_side = PER_FILE_MAX.get(name, DEFAULT_MAX)
    gltf, new_bin, stats = optimize(gltf, bin_bytes, max_side)
    write_glb(dst_path, gltf, new_bin)
    out_size = os.path.getsize(dst_path)
    note = "max %dpx, scaled %d, recoded %d" % (
        max_side, stats["scaled"], stats["recoded"]
    )

    # Second pass at 512 if still over budget and we were not already there.
    if out_size > BUDGET_BYTES and max_side > 512:
        gltf2, bin2 = read_glb(src_path)
        gltf2, new_bin2, stats2 = optimize(gltf2, bin2, 512)
        write_glb(dst_path, gltf2, new_bin2)
        out_size = os.path.getsize(dst_path)
        note = "max 512px (retry), scaled %d, recoded %d" % (
            stats2["scaled"], stats2["recoded"]
        )

    verify(dst_path)
    return {
        "name": name, "in": in_size, "out": out_size,
        "note": note, "images": n_images,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--dst", default=DEFAULT_DST)
    args = ap.parse_args()

    src_dir = os.path.abspath(args.src)
    dst_dir = os.path.abspath(args.dst)
    os.makedirs(dst_dir, exist_ok=True)

    files = sorted(f for f in os.listdir(src_dir) if f.lower().endswith(".glb"))
    if not files:
        print("no glb files found in", src_dir)
        return 1

    print("Source:", src_dir)
    print("Dest:  ", dst_dir)
    print()

    rows = []
    total_out = 0
    ok = True
    for name in files:
        src_path = os.path.join(src_dir, name)
        dst_path = os.path.join(dst_dir, name)
        print("processing %s ..." % name)
        try:
            r = process_file(src_path, dst_path, name)
        except Exception as exc:  # noqa: BLE001
            print("  ERROR:", exc)
            rows.append({"name": name, "in": os.path.getsize(src_path),
                         "out": 0, "note": "FAILED: %s" % exc, "images": 0})
            ok = False
            continue
        total_out += r["out"]
        over = " OVER BUDGET" if r["out"] > BUDGET_BYTES else ""
        if over:
            ok = False
        print("  -> %.1f MB -> %.1f MB  (%s)%s"
              % (r["in"] / 1e6, r["out"] / 1e6, r["note"], over))
        rows.append(r)

    # Size table.
    print()
    print("=" * 74)
    print("%-26s %10s %10s  %s" % ("model", "in (MB)", "out (MB)", "note"))
    print("-" * 74)
    for r in rows:
        print("%-26s %10.1f %10.1f  %s"
              % (r["name"], r["in"] / 1e6, r["out"] / 1e6, r["note"]))
    print("-" * 74)
    print("%-26s %10s %10.1f  budget %d MB each, %s"
          % ("TOTAL", "", total_out / 1e6, BUDGET_BYTES // (1024 * 1024),
             "all under budget" if ok else "SOME OVER BUDGET"))
    print("=" * 74)

    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
