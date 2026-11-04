"""Create the native tab-label font from the bundled Noto Sans SC variable font.

Requires fonttools and brotli. Run again when labels in GlassTabBar.kt change.
The font is licensed under web/fonts/OFL-NotoSansSC.txt.
"""
from pathlib import Path
import re

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
source = ROOT / "web/fonts/NotoSansSC.woff2"
target = ROOT / "android/app/src/main/res/font/noto_sans_sc_tabs.ttf"
labels_file = ROOT / "android/app/src/main/java/com/hwfee/english/glass/GlassTabBar.kt"
match = re.search(r'private val labels = listOf\(([^\n]+)\)', labels_file.read_text(encoding="utf-8"))
if not match:
    raise ValueError("Cannot locate native tab labels")
labels = re.findall(r'"([^"\n]+)"', match.group(1))
if len(labels) != 3:
    raise ValueError("Expected exactly three tab labels")

font = TTFont(source, recalcTimestamp=False)
font.flavor = None
subsetter = subset.Subsetter()
subsetter.populate(text="".join(labels))
subsetter.subset(font)
instantiateVariableFont(font, {"wght": 600}, inplace=True)
font.save(target)
print(f"Generated {target.relative_to(ROOT)}: {target.stat().st_size} bytes; weight 600; labels {', '.join(labels)}")
