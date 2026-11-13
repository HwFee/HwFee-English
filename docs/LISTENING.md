# 精听课程制作、统一包结构与进度迁移

> 课程生成命令入口位于 [`listening/cherina-pod/SKILL.md`](../listening/cherina-pod/SKILL.md)；主项目的 [`.agents/skills/cherina-pod/SKILL.md`](../.agents/skills/cherina-pod/SKILL.md) 仅负责指向该目录。

## 素材与统一课程数据

- **本地素材库**：课程规则与原始素材全部托管在 `listening/cherina-pod/`（`tools/sync-web.ps1` 已切换至该本地路径，不依赖旧桌面目录）。迁移核验 `1,241` 个文件、共 `3,624,809,763` 字节，SHA-256 全部一致；旧 Git 历史、原代码快照及核验报告留在 `listening/archive/`。
- **统一 39 节修订库**：位于 `listening/cherina-pod/lessons/unified/`（原四级、六级目录保留作历史存档）。全库共 **39 节、7,643 条字幕**：其中 `287` 条超长字幕按语义拆分为 `574` 个片段并逐片段配齐译文，英文上限 `28` 词（实际最长 `171` 字符），中文最长 `80` 字符。
- **音频词级对齐与置信度边界**：使用本机 Wav2Vec2 CTC 对齐并缓存 `81,675` 个词的起止时间。在 `5,290` 个首尾词置信度均 ≥ `0.5` 的原句边界中，曾有 `182` 处存在下一词起音提前至少 `60 ms` 落入上一句的情况；修订后，该高置信组未再发现同阈值串音或尾音截短。另有 `1,338` 条句子的首尾至少一端置信度 `< 0.2`，保留回退与复核标记（仍待真机抽检听感）。

## 课程重建与校验命令

在 `listening/cherina-pod/` 目录下执行：

1. `python scripts/rebuild_library.py --plan` — 仅输出分句计划；若修改分句规则，须逐条复核译文缓存。
2. `python scripts/rebuild_library.py` — 更新统一课程文件（默认不打包 ZIP）。
3. `python scripts/audit_unified.py` — 全量检查原文完整性、分句上限、时间轴、难点、封面与音频一致性；若需生成供 App 导入的完整课程包，显式追加 `--package` 参数执行重建。

## 进度兼容与客户端接线

修订课程在升级时必须保证原有四级、六级及早期独立包的学习记录无损迁移，由 `hwfeeCourse`（v2）元数据与前端/原生协同完成：

- **课程标识映射**：`id` 为不带水平前缀的稳定课程 ID；`legacyIds` 记录历史 `cet4-<id>`、`cet6-<id>` 与早期 payload ID。`LessonStore` 按稳定 ID 导入统一课并隐藏重复旧项，重新导入不会清空应用 `localStorage` 中的学习记录。
- **时间轴重定位**：`legacyTimeline` 保存旧句号对应的音频起止时间及原段落；新句子保留 `legacy_n`，原段号与段数保持不变。`web/listen/progress-migration.js` 在播放器读档前按音频秒数定位新句号，合并旧完成记录与断点，同时保留旧键并写一份迁移备份。
- **分阶段断点与解锁**：`web/listen/lesson-progress.js` 负责分阶段断点；`web/listen/player-identity.js` 在生成播放器启动前触发迁移；`web/listen/library-shim.js` 识别旧课程别名；`web/listen/player-shim.js` 依据真实完成数解锁阶段。新模板 `listening/cherina-pod/scripts/templates/player.html`（已同步至 `web/listen/player.template.html`）仅在精听最后一句播完后打勾。
- **服务端注入与原文件只读**：`LessonServer` 在下发旧课程、播放器和讲义时按需注入迁移脚本、排版适配、睡眠模式和导出能力，磁盘上的已导入课程文件始终不被改写。
- **句卡与原地收藏复习**：`web/listen/player-layout.js` 同步约束精听与对照模式的句卡视口高度；`web/listen/saved-sentences.js` 通过跨帧通知与原生有界 PCM 片段实现原地收藏播放与即时计数刷新，并在播放前保存、返回时恢复原课程断点。

## 手机端导入次序

升级统一课程包时，**保留应用数据**（勿卸载清库）：

1. 覆盖安装当前版本的签名 APK。
2. 在「精听」页面通过导入按钮（或系统分享）重新导入统一课程 ZIP。客户端会自动迁移旧进度并隐藏旧版重复课程卡片。

本机核验报告归档在 `listening/archive/` 下：`migration-sha256.json`、`unified-audit.json`、`audio-boundary-audit.json` 及 `rebuild-report.json`。
