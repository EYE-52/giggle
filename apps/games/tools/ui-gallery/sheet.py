# Contact sheet: python3 sheet.py <gameDir> <out.png> [size=desk]
import sys, os
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
size = sys.argv[3] if len(sys.argv) > 3 else 'desk'
fs = sorted(f for f in os.listdir(d) if f.endswith(f'-{size}.png'))
if not fs: sys.exit(0)
W, H = (490, 410) if size == 'desk' else (260, 520)
cols = 3 if size == 'desk' else 5
rows = (len(fs) + cols - 1) // cols
S = Image.new('RGB', (W * cols, (H + 18) * rows), (20, 20, 24))
dr = ImageDraw.Draw(S)
for i, f in enumerate(fs):
    im = Image.open(os.path.join(d, f)).resize((W, H))
    x, y = (i % cols) * W, (i // cols) * (H + 18)
    S.paste(im, (x, y + 18)); dr.text((x + 4, y + 3), f[:60], fill=(255, 255, 255))
S.save(out)
