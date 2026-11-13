# HwFee English

整合 **cherina-pod 精听** 与 **扇贝阅读 精读** 的个人 Android 学习应用（`com.hwfee.english`，当前版本 `1.0.12` / `versionCode 13`）。采用 **Capacitor 7 + 单同源 WebView + 原生 Java/Kotlin 插件层**，底部导航为基于 `io.github.kyant0:backdrop` 实现的 Compose 液态玻璃标签栏。

## 核心能力

- **精听（cherina-pod）**
  - 支持通过系统文件选择器（SAF）或外部 `content://` 分享传入离线课程 ZIP（同时兼容分目录包与内嵌音频单文件 HTML）。
  - 导入后的课程文件在磁盘保持只读不被改写；`LessonServer` 在 `https://localhost/lessons/` 实时响应 HTTP `Range` 分片请求，并在输出响应时按需注入移动端适配、多阶段进度迁移、睡眠模式和讲义 PDF 导出钩子。
  - **逐句精准停止**：精听练习与单句循环由原生 `PcmSentence` / `SentenceClip` 将选定区间解码并缓存为有界 PCM WAV，通过文件自然结束停在句尾，避免整段音频定时轮询带来的句尾串音；盲听、对照、连续睡眠模式及整课播放则使用原生完整音源（`NativeAudioEngine` + `PlaybackService` 前台服务 + `MediaSession` 锁屏控制）。
  - 支持全局跨课 `localStorage` 连续打卡、句库收藏与原地沉浸复习（不污染正常练习检查点）、课程列表过滤/删除，以及双向讲义 `存为 PDF`（`HandoutPdfExporter`）。
- **精读（扇贝阅读）**
  - 原生 Cookie 鉴权同步当日学习进度、词表与每日文章（`ShanbayPlugin` / `ShanbayClient`），离线可用最近有效快照。
  - 基于头词与变形词表的正文高亮（`today` / `wordbook` / `learned` / `unlearned`）、生词统计看板、点击查词卡片（美音音标、发音、释义折叠与增删生词本）、阅读状态追踪（`待读` / `在读` / `已读`）及手动**刷新高亮**。
  - 长按句子弹出锚定卡片：提供 **翻译** 与 **长难句分析**，路由为 **扇贝官方 SSE 优先、个人 OpenAI 兼容 API 兜底**（默认 DeepSeek）；共享 30 天本地持久化缓存与可选今日文章自动预加载，并在发散/重排中严格对齐原句。
- **壳与设置（Shell & Settings）**
  - 原生 Compose 液态玻璃底栏（`TabBar` / `GlassHost` / `LiquidBottomTabs`），支持跨标签悬浮迷你播放器与外观切换（`跟随系统` / `浅色` / `深色`）。
  - 扇贝账号支持应用内 `LoginActivity` 登录取 Cookie 或手动粘贴 `Cookie` / cURL；Cookie 与个人 API Key 均加密保存在 Android Keystore（`Vault`，别名 `hwfee.vault.v1`），绝不回传给 WebView。
  - 设置页内含扇贝账户剩余额度独立刷新、DeepSeek 账户余额查询与本地 30 天调用/Token/缓存/预加载用量统计，以及 `PasswordDots.woff2` 等宽圆点密码掩码。

## 仓库结构

```text
HwFee-English/
├── AGENTS.md                  # AI 协作规范、UI 令牌、原生玻璃栏与 Apple HIG 指引
├── HANDOFF.md                 # 当前状态、未完成的真机验证清单、签名与风险边界
├── package.json               # Web 测试与 Android 构建脚本入口
├── web/                       # 单同源 WebView 前端资产（打包进 APK assets/public）
│   ├── index.html, shell.*    # 应用壳、悬浮提示岛、迷你播放器、设置页与降级底栏
│   ├── fonts/, icons/         # 离线字体（Noto Sans SC / Literata / PasswordDots）与 Phosphor 图标
│   ├── listen/                # cherina-pod 模板与注入脚本（进度迁移、原生音频桥、睡眠、复习、讲义）
│   └── read/                  # 精读模块（桥接、词表高亮、手势/弹窗、SSE/LLM 调度、文章策略）
├── android/                   # Capacitor Android 工程（AGP 9.1 / Gradle 9.3 / compileSdk 37）
│   └── app/src/
│       ├── main/java/com/hwfee/english/
│       │   ├── MainActivity.java, Appearance.java, LoginActivity.java, Vault.java
│       │   ├── LessonsPlugin.java, LessonStore.java, LessonServer.java, LessonWebViewClient.java
│       │   ├── LessonArchive.java, LessonInstaller.java, LessonPath.java, LessonRequestSupport.java, HandoutPdfExporter.java
│       │   ├── AudioPlugin.java, AudioBridge.java, NativeAudioEngine.java, PlaybackService.java, MediaArtwork.java, PcmSentence.java, SentenceClip.java, SentenceClock.java
│       │   ├── ShanbayPlugin.java, ShanbayClient.java, ShanbaySseClient.java
│       │   ├── LlmPlugin.java, LlmRepository.java, LlmClient.java, LlmCache.java, UsageStore.java, SourceAlign.java, SentenceService.java, SentenceCancellation.java, DeepSeekBalanceClient.java
│       │   └── glass/         # Compose 液态玻璃底栏（TabBarPlugin、GlassHost、GlassTabBar、LiquidBottomTabs 等）
│       ├── debug/java/.../glass/GlassPreviews.kt
│       ├── test/              # JUnit / Robolectric 本地单测
│       └── androidTest/       # 设备端仪器化测试（NativeBridge*、SentenceClipDeviceTest）
├── docs/                      # 开发手册、课程包装规范、版本记录与接口契约（详见下方索引）
├── tools/                     # 构建器、同步、资源/字体生成、CDP 调试与性能/复习验证脚本
├── tests/                     # Node.js 自动化测试套件（node --test）
├── assets/brand/              # 应用图标、自适应前景与启动图源文件及说明
├── examples/listening/        # 精听示例课程包（native-speed.zip + sha256）
└── listening/                 # cherina-pod 课程生成器、39 节本地素材及归档
```

## 已确立的架构决策

- **单同源与只读课件**：应用壳、精读页与导入课程均服务自 `https://localhost`，保证跨课程打卡（`cherina-pod:activity`）与生词/复习进度共享；磁盘上的课程 ZIP 解压内容永不就地改写，兼容性补丁由 `LessonServer` 在下发时注入。
- **双通道音频与不污染进度**：逐句练习与单句复习通过 `PcmSentence` 生成有界 WAV 交由原生 `MediaPlayer` 播放，避免依赖 Web 定时器停句；睡眠模式切回整课音源并冻结练习检查点，到期后恢复原断点且不计入课程阶段完成。
- **密钥隔离与同源防御**：扇贝 Cookie 与个人 API Key 仅在原生层读写并经 `ShanbayClient` / `LlmClient` 发往受限 HTTPS 域名；本地资源路由严格校验协议、域名与规范路径，防止目录穿越与非可信 URI 注入。
- **Iframe 桥接约定**：`精听` 与 `精读` 均运行在 Shell 的同源 `<iframe>` 内，调用 Capacitor 插件必须走 `window.top.Capacitor`，否则子框架内独立注入的桥接调用将永久挂起。
- **课程 ID 与兼容性**：早期 `cet4/` 与 `cet6/` 目录存在相同课程 payload ID，导入时由目录路径生成稳定 ID 并将旧 ID 与逐句时间轴记入 `hwfeeCourse`（`legacyIds`、`legacyTimeline`），支持旧学习进度无损迁移到修订版统一课程。
- **接口细节约定**：向扇贝生词本写入（`POST /wordscollection/words`）必须附带 `business_id: 1`；长难句分析要求保留原文全部词形与空白（通过 `SourceAlign.java` 对齐），不接受占位标签或残缺片段。
- **硬件加速 WebView 与液态玻璃底栏**：`WebView` 必须保持 `LAYER_TYPE_HARDWARE` 以确保 `backdrop` 能正确采集固定定位与滤镜内容；需要避让底栏的页面元素使用 CSS 变量 `--island-reserve`。

## 快速开始

环境依赖：**Node.js 20+**、**JDK 21**（`JAVA_HOME` 必须指向 JDK 21）以及 Android SDK **`platforms;android-37.0`**。

```powershell
npm ci
npx cap sync android
npm test                 # 运行 Web (node --test) 与 Android 原生单测
npm run apk              # 构建 debug APK -> android/app/build/outputs/apk/debug/app-debug.apk
npm run apk:release      # 构建已签名 release APK（需本机 android/keystore.properties）
```

## 文档导航

| 文档 | 用途 |
|---|---|
| [AGENTS.md](AGENTS.md) | 编码约定、设计 Token、Apple HIG 技能指引与玻璃底栏规则 |
| [HANDOFF.md](HANDOFF.md) | 当前 `v1.0.12` 运行现状、真机待验证事项、密钥与已知边界 |
| [docs/DEV.md](docs/DEV.md) | 构建、测试、品牌/字体生成、模拟器 CDP 调试与排坑记录 |
| [docs/LISTENING.md](docs/LISTENING.md) | `cherina-pod` 39 节统一课程结构、音频对齐统计、重建命令与进度迁移 |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | `v1.0.0` ~ `v1.0.12-v7` 版本演进、关键修复与验证记录 |
| [docs/shanbay-api.md](docs/shanbay-api.md) | 逆向整理的扇贝阅读/词库/高亮/额度接口清单与实测说明 |
| [docs/shanbay-sentence-analysis.md](docs/shanbay-sentence-analysis.md) | 扇贝长难句分析与句子翻译 SSE 线协议、组件配色与实测抓包样本 |
| [docs/llm-api.md](docs/llm-api.md) | 句子工具（`web/read/llm.mjs` 与 `LlmPlugin`）调用契约、缓存与并发取消规范 |
| [docs/usage-api.md](docs/usage-api.md) | 设置页本地统计（`getUsage`）与扇贝额度独立查询（`getShanbayQuota`）契约 |
| [docs/deepseek-balance-api.md](docs/deepseek-balance-api.md) | DeepSeek 账户余额查询（`getDeepSeekBalance`）契约与错误码 |
| [assets/brand/README.md](assets/brand/README.md) | 应用图标、自适应前景与启动屏幕的生成与检查说明 |
| [examples/listening/README.md](examples/listening/README.md) | 精听示例课程包说明与校验信息 |
