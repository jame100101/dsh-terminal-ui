"""Rasterize captured PTY cells, never synthesize application state or claim a native screenshot.
Usage: python render-pty-cells.py <capture-directory> [--font /path/to/monospace.ttf]
Requires Pillow only for this optional evidence export, not for the TUI.
"""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageColor

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
parser.add_argument('--font', default='/System/Library/Fonts/Menlo.ttc')
args = parser.parse_args()
manifest_path = args.directory / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
assert manifest['status'] == 'PASS' and manifest['host'] == '0.2.1-rc.2'
scale, cw, ch, margin, top = 2, 10, 22, 16, 72
font = ImageFont.truetype(args.font, 16 * scale)
italic_font = ImageFont.truetype(args.font, 16 * scale, index=2) if args.font.endswith('Menlo.ttc') else font
caption = ImageFont.truetype(args.font, 11 * scale)
wide_path = Path('/System/Library/Fonts/Supplemental/Arial Unicode.ttf')
wide_font = ImageFont.truetype(str(wide_path), 16 * scale) if wide_path.exists() else font
images = []
for entry in manifest['captures']:
    data = json.loads((args.directory / (entry['name'] + '.json')).read_text())
    image = Image.new('RGB', ((data['cols'] * cw + margin * 2) * scale, (data['rows'] * ch + top + margin) * scale), '#161616')
    draw = ImageDraw.Draw(image)
    draw.text((margin * scale, 12 * scale), f"DSH-TUI | Harness rc.2 | {entry['name']}", font=caption, fill='#ddd')
    draw.text((margin * scale, 32 * scale), 'Actual isolated PTY capture - cell replay image', font=caption, fill='#aaa')
    draw.text((margin * scale, 49 * scale), 'Not a native macOS Terminal screenshot', font=caption, fill='#aaa')
    for cell in data['cells']:
        x, y = (margin + cell['x'] * cw) * scale, (top + cell['y'] * ch) * scale
        draw.rectangle((x, y, x + cell['width'] * cw * scale - 1, y + ch * scale - 1), fill=cell['bg'])
        fg = cell['fg']
        if cell['dim']:
            front, back = ImageColor.getrgb(fg), ImageColor.getrgb(cell['bg'])
            fg = tuple(round(a * .65 + b * .35) for a, b in zip(front, back))
        chosen = wide_font if any(ord(char) >= 0x2e80 for char in cell['text']) else italic_font if cell.get('italic') else font
        # Use a shared baseline: glyph-top anchoring incorrectly raises hyphens and box strokes.
        draw.text((x, y + 18 * scale), cell['text'], font=chosen, fill=fg, anchor='ls', stroke_width=1 if cell['bold'] else 0)
        if cell.get('underline'):
            draw.line((x, y + 20 * scale, x + cell['width'] * cw * scale, y + 20 * scale), fill=fg, width=scale)
        if cell.get('strikethrough'):
            draw.line((x, y + 12 * scale, x + cell['width'] * cw * scale, y + 12 * scale), fill=fg, width=scale)
    target = args.directory / (entry['name'] + '.png')
    image.save(target)
    images.append(target.name)
manifest['replayImages'] = {'files': images, 'font': args.font, 'scale': scale, 'limitation': 'Pillow raster of actual PTY cells, not a native window screenshot. Replay fonts/leading may differ.'}
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'status': 'PASS', 'images': images}))
