保留应用数据覆盖安装整合后的 APK，再导入统一课程包。用户已在完成前端回退、深色开关及收藏修复后要求打包。

课程规则与素材位于 `listening/cherina-pod/`。桌面原目录保留，迁移时共核验 1,241 个文件、3,624,809,763 字节，SHA-256 全部一致。旧 Git 历史、原代码快照和核验清单在 `listening/archive/`。原始音频、转写、译文、历史课程和旧 ZIP 都有本项目内的副本；`tools/sync-web.ps1` 已使用本地路径。删除旧桌面目录不影响本项目的这些文件。

当前课程数据：39 节、7,643 条字幕。287 条超长字幕拆成 574 个语义片段，逐片段配译文；英文上限 28 个词，实际最长 171 个字符，中文最长 80 个字符。统一课程位于 `listening/cherina-pod/lessons/unified/`，原四级、六级材料留作存档。

音频校准使用本机 Wav2Vec2 CTC 对齐，缓存 81,675 个词的起止时间。5,290 个首尾词置信度均达到 0.5 的原句边界中，182 处存在下一词起音至少提前 60 ms 落入上一句的情况。修订后，这组可靠边界没有发现同阈值的残留串音或尾音截短。另有 1,338 条句子的首尾至少一端置信度低于 0.2，保留回退与复核标记；未逐句人工试听，也未验证手机扬声器和蓝牙的实际停止延迟。

课程生成入口是 `listening/cherina-pod/SKILL.md`；主项目 `.agents/skills/cherina-pod/SKILL.md` 只负责指向这个来源。在生成器目录里运行：

1. `python scripts/rebuild_library.py --plan` 仅输出分句计划。更改分句规则后，需要重新逐条核对译文缓存。
2. `python scripts/rebuild_library.py` 更新课程文件，默认不打包。当前用户要求等待另一位 AI 完成前端。
3. `python scripts/audit_unified.py` 检查原文完整性、分句、时间、难点、封面和音频。用户要求打包后，再显式执行 `python scripts/rebuild_library.py --package`。

进度兼容由 `hwfeeCourse` 元数据定义：

- `id` 为不带水平前缀的稳定课程 ID；`legacyIds` 包含先前的 `cet4-<id>`、`cet6-<id>` 和旧 payload ID。
- `legacyTimeline` 保存旧句子的音频起止时间及原段落；新句子有 `legacy_n`，原段号和段数保持稳定。
- `web/listen/progress-migration.js` 在播放器读取状态前，按音频秒数重定位新句号，合并旧版本完成记录与断点；原 localStorage 键保留，并另存迁移备份。
- `LessonStore` 对统一课按稳定 ID 导入；旧四级、六级文件保留，列表隐藏其重复项。重新导入不会删除应用的学习存储。

手机上的正确次序是保留应用数据覆盖安装 `dist/HwFee-English-1.0.9.apk`，再导入 `dist/HwFee-English-精听39节-修订版-2026-11-04.zip`。这是用户明确要求打包后的最终产物；签名与 1.0.8 相同，已验证打包资源与源码一致。尚未安装到设备。

前端整合需保留以下本轮改动：

- `web/listen/lesson-progress.js` 和 `progress-migration.js`：分段、分阶段断点以及旧时间轴迁移。
- `web/listen/player-identity.js`：在生成播放器启动前迁移；`library-shim.js`：识别旧课程别名；`player-shim.js`：阶段解锁依据真实完成数。
- `android/.../LessonServer.java`：在服务旧课程时修复提前打勾，注入迁移脚本与手机内容滚动；`LessonStore.java`：稳定导入 ID 和旧条目隐藏；`NativeAudioEngine.java`：临近句尾时缩短停止检查间隔。
- `listening/cherina-pod/scripts/templates/player.html` 是课程模板；`web/listen/player.template.html` 是本轮同步的副本。当前新课的精听阶段只在最后一句播完后打勾，最后一句未播完时按“下一句”会重播当前句。

界面已回退到 1.0.8 原版，新增深色开关，并将自动预加载放回“翻译与分析”同一卡片。`player-layout.js` 同时约束精听、对照阶段的高度与位置，长句在卡片内滚动；旧版和修订版每课最长字幕、两个阶段、四种尺寸，共 624 组均通过显示检查。手机安装、重新导入及实际听感仍需交付后验证。

收藏卡片保留原样式：`saved-sentences.js` 接入原生片段播放，并通过存储事件和明确的跨帧通知立即刷新收藏、取消收藏及数量。播放失败给出提示；播放收藏前保存课程断点，返回课程时等待片段停止并重新取得音频控制，避免收藏播放覆盖课程进度。

已通过的验证：网页 180 项；Android 单元测试 155 项（3 项 Windows 跳过）；原生服务实际输出的课程库页面通过收藏、取消、卡片播放和复习播放集成检查；课程数据全量检查零失败；分句规则 4 项 Python 单元测试。最终 release 检查另见交付记录。原音频与上次已交付课程包的 ZIP CRC、字节数一致。

本机核验记录位于 `listening/archive/migration-sha256.json`、`unified-audit.json`、`audio-boundary-audit.json` 和 `rebuild-report.json`。这些记录和第三方课程素材均留在本机。
