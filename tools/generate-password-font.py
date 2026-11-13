"""Match native password masking to the saved-key circle without exposing the key.

Chromium masks passwords with U+2022; Noto Sans SC draws that as a tiny middle dot.
Use its U+25CF filled circle for both characters in this password-only font.
Requires fonttools + brotli; license: web/fonts/OFL-NotoSansSC.txt.
"""
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
font = TTFont(ROOT / "web/fonts/NotoSansSC.woff2", recalcTimestamp=False)
circle = font.getBestCmap()[0x25CF]
for table in font["cmap"].tables:
    if table.isUnicode():
        table.cmap[0x2022] = circle
        table.cmap[0x25CF] = circle
subsetter = subset.Subsetter()
subsetter.populate(unicodes=[0x2022, 0x25CF])
subsetter.subset(font)
instantiateVariableFont(font, {"wght": 400}, inplace=True)
for name_id, name in {
    1: "HwFee Password Dots", 2: "Regular", 3: "HwFeePasswordDots-Regular-1.0",
    4: "HwFee Password Dots Regular", 6: "HwFeePasswordDots-Regular",
}.items():
    font["name"].setName(name, name_id, 3, 1, 0x409)
font.flavor = "woff2"
target = ROOT / "web/fonts/PasswordDots.woff2"
font.save(target)
print(f"Generated {target.relative_to(ROOT)}: {target.stat().st_size} bytes")
