"""Assemble the 32 trophy turntable frames into an 8x4 webp spritesheet."""
import os
import sys
from PIL import Image

src_dir, out_path = sys.argv[1], sys.argv[2]
frames = [Image.open(os.path.join(src_dir, "f%02d.png" % i)) for i in range(32)]
fw, fh = frames[0].size
sheet = Image.new("RGBA", (fw * 8, fh * 4), (0, 0, 0, 0))
for i, fr in enumerate(frames):
    sheet.paste(fr, ((i % 8) * fw, (i // 8) * fh))
sheet.save(out_path, "WEBP", quality=84, method=6)
print("SHEET_OK", out_path, os.path.getsize(out_path) // 1024, "KB",
      sheet.size)
