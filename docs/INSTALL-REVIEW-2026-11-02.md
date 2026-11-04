安装 [HwFee-English-1.0-20261102.apk](../dist/HwFee-English-1.0-20261102.apk)，并仅导入你自己生成或确认可信的 cherina-pod 课件。

安装候选包已构建并签名：包名 `com.hwfee.english`，版本 `1.0` / versionCode `1`，最低 Android 6.0
（API 23），targetSdk 35 / compileSdk 37。文件为 27,360,223 字节，约 27.4 MB。本次基于当前工作区构建，
包含此前尚未提交的界面改动。签名沿用本机现有的发布密钥。

SHA-256：`ce242ff3c0370acc6abe8ee8448ae8d34194eb622bfa13cf8ee7cc9df3755a55`。
旁边的 [校验文件](../dist/HwFee-English-1.0-20261102.apk.sha256) 可用于检查传输后的文件。

图标采用蓝色打开的书与橙色声音波形，沿用现有 UI 的浅色 `#F5F5F7` / `#0071E3`、深色
`#000000` / `#1C1C1E` / `#2997FF` 和 `#FF6B00`。已替换 Capacitor 默认资源，启动使用
AndroidX SplashScreen；底部原生玻璃栏、课件原文件和 WebView 硬件层保留。设计与生成方式见
[品牌资源说明](../assets/brand/README.md)，[预览](../assets/brand/preview.png)。

| 资源检查 | 结果 |
|---|---|
| 普通 / 圆形 PNG | 浅深色各五档：48、72、96、144、192 px |
| 透明前景 PNG | 浅深色各五档：108、162、216、324、432 px；安全圆检查通过 |
| 自适应图标 | API 26 / 33 各有普通、圆形 XML，共 4 份；包含单色层 |
| 启动资源 | 288 dp 矢量、浅深色背景及启动后主题；由系统处理遮罩与交接 |
| 最终 APK | 30 张图标 PNG、4 份自适应 XML 和启动 / 单色矢量均在资源表中；28 个 Web 文件与源码逐字节一致 |

这次审核覆盖原生网络与密钥存储、登录 WebView、原生桥接、导入 / 解压 / 删除 / 本地资源服务、
播放服务、前端内容渲染与缓存，以及依赖和发布配置。发现并修复了以下问题：

| 范围 | 原问题与修复 |
|---|---|
| 发布调试 | Capacitor 配置原来强制开启 WebView 调试；现在使用构建标志默认值。发布 Manifest 没有 debuggable，debug 版仍可用 CDP |
| 本地资源边界 | 课件路由原来只判断路径；现在同时检查 HTTPS、localhost、端口和用户信息，并阻止通用文件 / ContentProvider 代理及 file/content 访问 |
| 翻译密钥目的地址 | 原来更换 base URL 可沿用旧密钥；现在已有密钥时，更换地址必须重新输入目标接口密钥。仍拒绝 HTTP、带凭据的 URL、重定向和响应中的密钥回显 |
| 备份与文件共享 | 禁用备份并明确排除云备份 / 设备迁移数据；FileProvider 从整个外部目录及缓存缩小为 `cache/shared/` |
| 登录与断开 | 登录 WebView 禁止混合内容和文件访问，限制顶层导航到 HTTPS 扇贝域名；断开时同时清除 Keystore 项和 WebView Cookie，避免登录页自动恢复旧会话 |

构建依赖原有 4 条中危告警来自 CLI 的 `glob` / `minimatch` 依赖链；已锁定修复版本并复验
Capacitor 同步与构建。修复依据为维护者发布的
[glob 公告](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) 和
[minimatch 公告](https://github.com/advisories/GHSA-g3hv-75wg-m249)。CLI 已归入开发依赖。

| 验证 | 本次结果 |
|---|---|
| 自动化测试 | 前端 56 通过；原生 53 通过，3 个 Windows 符号链接用例跳过；共 109 通过、0 失败 |
| Android 发布 Lint | 0 错误、18 警告，主要为依赖更新、未用模板资源、WebView JavaScript 和现有布局 / 存储建议；并非零警告 |
| 依赖查询 | `npm audit`：0；2026-11-02 查询 OSV，releaseRuntimeClasspath 的 137 个 Maven 坐标（含 BOM）未返回匹配漏洞；系统 WebView 不属于这些坐标 |
| 签名与兼容包 | APK v1 / v2 签名验证通过，16 KB ZIP 对齐通过，64 位原生库 ELF LOAD 段为 16 KB 对齐；包含 arm64-v8a、armeabi-v7a、x86、x86_64 |
| 内容与凭据 | 包内 Web 文件一致性通过；文本资源未检出密钥 / Cookie 字面量模式；没有打包 keystore 或签名配置。模式扫描不能替代源码审查 |

发布证书 SHA-256：`ab63a748ce01b01e3e20e6f4a56abf1ab1bd4944855900aa0c53d853a17eb58c`。
同一设备上已安装其他签名的同包名应用时，Android 会拒绝覆盖；保留原应用数据，不要为了覆盖而直接卸载。

仍保留两个需要安装者知道的边界：

1. **不可信课件属于高风险输入。** 导入课件的 JavaScript 与应用同源，仍可读取本地学习数据、调用
   扇贝和翻译功能。现有修复收紧文件读取和密钥改址，但没有把任意恶意 HTML 隔离。这个个人使用版本
   只适合可信课件；完整隔离需要改变当前共享 localStorage / 原生桥接的架构。此类桥接风险参见
   [Android 原生桥接安全说明](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges)。
2. **真机表现尚未验证。** API 35 模拟器中，同代码 debug 版安装、浅深色冷启动及进入阅读页成功，未见
   AndroidRuntime 崩溃；录屏中启动页退出与首页出现之间仍可见过渡空白 / 黑帧，原因未确定。发布 APK
   已做静态包与签名验证，未在真实手机上验证启动过渡、后台音频、锁屏控制与系统省电策略。

安装后先播放一课并锁屏 30 秒，确认音频继续播放且锁屏按钮可用。
