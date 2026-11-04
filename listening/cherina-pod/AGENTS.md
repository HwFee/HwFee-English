# cherina-pod 项目规则

## 定位（2026-10-31 重新定盘）
- **一个开源的 agent skill + 本地脚本**：把一期外语播客做成一节精听课（`player.html` 精听网页 + `handout.html` 打印讲义 + `notes.md` 难点表达）。
- 不做网站、托管服务、账号、原生 App、浏览器插件。pod.cherina.app 已关闭。
- 需求与优先级见 `docs/PRD.md`；用户调研在 `private/调研/`。
- 讲义二维码是可选的低优先级功能，需要使用者自己有公开网址。

## 技术栈
- Python 3.10+，只用标准库（`opencc` 可选），外部依赖 `ffmpeg` / `ffprobe`；
  YouTube 来源另需 `yt-dlp`（可选，装了才支持视频链接）
- 转写：阿里云百炼 Paraformer（`DASHSCOPE_API_KEY`）；YouTube 来源改用视频自带字幕
  （`scripts/youtube.py`，依赖 `yt-dlp`），不走 ASR、不产生转写费用
- 翻译与难点表达：OpenAI 兼容接口，默认模型 `deepseek-v4.1-flash`；供应商顺序 `LLM_BASE_URL` 自定义 → DashScope 兼容模式 → ollama-cloud → opencode-go
- 精听网页与讲义：单文件 HTML，原生 JS，无构建步骤；模板在 `scripts/templates/`

## 核心约定
- **转写必须保留词级时间戳**，逐句对齐依赖它。YouTube 自动字幕给真实词级时间戳，
  人工字幕只有句子级时间，按字符比例摊算；两者写进同一个 `transcript.json` 契约。
- **`audio_path` 一律用正斜杠**（`audio/episode.mp4`）：`os.path.relpath` 在 Windows 上返回
  反斜杠，浏览器 `<audio src>` 直接加载失败。
- **生成的内容不入库**：`episodes/*/` 下的音频、`transcript.json`、`translation.json`、`bilingual.json`、`meta.json`、`player.html`、`handout.html`、`notes.*` 全部 gitignore。仓库只跟踪合成样例 `episodes/_sample-intro/`。词级时间戳只存在于本机，请自行备份。
- `player.html` 必须能在 `file://` 下离线运行：数据内联进 HTML，音频用相对路径 `audio/episode.mp4`，不发任何网络请求。
- 语言对是配置项：`--source-lang`（默认 auto）/ `--target-lang`（默认 zh）；数据键名一律 `source` / `target`，读入兼容旧格式 `en` / `zh` / `title_zh`。界面语言跟随译文语言（中文译文 → 中文界面，否则英文界面）。
- 翻译遵循信达雅，逐句输出 `{source, target}`；`translation.json` 的 source 必须回填 transcript 原文。
- 难点表达必须能在原句中原样找到，对不上的条目直接丢弃。
- 广告识别结果缓存在 `ads.json`（原文列表），课里删除这些句子并重新编号；播放时句间空隙 > 0.8 秒自动跳过。宁可漏标，不能误删正文。
- 学习记录存在浏览器 localStorage：`cherina-lesson:<id>`（单课进度）、`cherina-pod:activity`（每日时长与完成段数）、`cherina-pod:saved`（收藏与复习排期）、`cherina-pod:last`（上次练的课）。改键名要同时改 player.html 和 index.html。
- 密钥只放 `.env`（gitignore），绝不进仓库、不打印。查找顺序：当前目录、仓库根目录、`~/.config/cherina-pod/.env`。
- 产物目录默认 `episodes/`，环境变量 `CHERINA_POD_OUT` 可覆盖。
- **统一交付（2026-11-04）**：一部素材只交付一份课，日常和进阶难点合并；当前修订课在 `lessons/unified/<期名>/`。`lessons/cet4/`、`lessons/cet6/` 和旧 ZIP 是历史存档。音频硬链接只指向本项目里的素材，删除旧桌面目录不会影响它们。
- **手机分句**：`scripts/sentence_chunks.py` 是上限与语义边界的唯一来源；字幕按语义拆块，译文逐块对应。`alignment.json` 记录本地音频校准，低置信度边界保留复核标记。原始 transcript、translation 和音频保持不变。
- **进度兼容**：修订课保留原段号及旧时间轴，生成 `hwfeeCourse` 元数据；课程 ID 保持稳定。App 以原音频时间映射新句号，保留阶段、倍速、自评、已完成段落及各阶段断点。
- **没有 API key 时的翻译口径**：由 agent 手写 `translation.json`，用
  `scripts/tl.py fill` 按序号回填（source 从 transcript 取，避免抄错）；
  难点表达用 `scripts/tl.py notes` 写入（按 expr 自动反查句号）。
  不用 key 也可以完整交付，但广告识别与难点挑选是人工/代理判断，不是模型。
- `lesson.py` 的 RESULT 契约（`ok` / `stage` / `error` / `fix` 及成功字段）是 SKILL.md 依赖的接口，改动要同步 SKILL.md。

## 目录
- `SKILL.md`：agent skill 说明（仓库根目录即 skill 目录，可直接克隆进 agent 的 skills 目录）
- `scripts/lesson.py`：唯一入口，最后一行输出 `RESULT {json}`；其余脚本是它调用的步骤
- `scripts/youtube.py`：YouTube 来源（视频自带字幕 → transcript.json）
- `scripts/batch_youtube.py`：批量导入频道/列表（可 `--ids` 分片并行）
- `scripts/rebuild_library.py`：统一重建、旧进度映射数据和 Android ZIP
- `scripts/align_audio.py`：本地音频对齐；`scripts/audit_unified.py`：统一课程全量验收
- `scripts/two_levels.py`：历史双水平构建工具，保留用于旧包复现
- `scripts/tl.py`：翻译辅助（dump / fill / notes / ads / check）
- `scripts/audit.py`：全量验收（素材 + 78 份成品）
- `scripts/templates/`：精听网页模板（前端由主代理亲自写，不外包给子代理）
- `episodes/`：素材，内容全部 gitignore（样例除外）
- `lessons/`：统一成品和历史版本（同样不入库）
- `docs/`：PRD
- `private/`：调研与内部材料，gitignore

## 常用命令
```bash
python3 scripts/lesson.py --doctor                          # 检查环境与密钥
python3 scripts/lesson.py "播客名或RSS" --list                # 列单集
python3 scripts/lesson.py "播客名或RSS" --episode 1 --level 四级 # 一键生成精听课
python3 scripts/lesson.py "https://youtu.be/<id>" --level 四级   # YouTube：用视频自带字幕，不烧转写费
python3 scripts/youtube.py "https://youtu.be/<id>"              # 只把视频导入为一期素材
python3 scripts/lesson.py --recommend --level 四级            # 推荐播客（scripts/catalog.json）
python3 scripts/lesson.py --setup                           # 交互式填密钥
python3 scripts/lesson.py --serve                           # 局域网课程库，手机直接练
python3 scripts/build_lesson.py episodes/<id>               # 只重新生成精听课（含课程库 index.html）
python3 scripts/build_lesson.py episodes/<id> --single-file --parts 1-3   # 手机单文件
python3 scripts/build_lesson.py episodes/<id> --no-notes                # 不调用 LLM
bash scripts/batch_add.sh                                               # 批量（scripts/batch_jobs.txt）

# —— 无 key，代理手写译文；统一课程工作流见 SKILL.md ——
python3 scripts/batch_youtube.py "<频道URL>" --list-only     # 列清单
python3 scripts/batch_youtube.py "<频道URL>"                # 下载音频 + 字幕
python3 scripts/batch_youtube.py --ids id1,id2              # 指定视频（用于分片并行）
python3 scripts/tl.py dump  episodes/<id>                   # 看原文
python3 scripts/tl.py fill  episodes/<id> zh.json           # 中文数组 → translation.json
python3 scripts/tl.py notes episodes/<id> items.json notes-4.json   # 四级 20 条
python3 scripts/tl.py notes episodes/<id> items.json notes-6.json   # 六级 20 条
python3 scripts/tl.py ads   episodes/<id> ads.json          # 赞助句（整句精确匹配）
python3 scripts/tl.py check episodes/<id>                   # 校验译文 + 两套难点
python3 scripts/rebuild_library.py                         # → lessons/unified + 主项目 dist
python3 scripts/audit_unified.py                           # 统一课程验收
```

## 音频
- 下载后一律压缩为 AAC-LC 64k mono（MP4 容器，`audio/episode.mp4`），转写和播放都用这一份，保证字幕和音频对齐。
