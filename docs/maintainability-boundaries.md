# Claw 可维护恢复边界

## 目标

当前仓库以运行中的扩展目录为事实来源，不再追求缺失的原始 TS/React/Vite 工程结构。

后续恢复工作只做两类事情：

- 把高价值逻辑外提到根目录可读、可测模块
- 给现有 bundle 补语义锚点和行为测试

## 冻结接口

第一阶段必须保持以下接口不漂移：

- `manifest.json` 里的入口文件、HTML 页面和权限声明
- `chrome.storage` 里的关键键名
- `chrome.runtime.sendMessage` 的关键消息类型
- sidepanel/options 页面对根目录脚本与 bundle 的加载顺序

这些稳定契约统一收口在 `claw-contract.js`。

## 模块边界

优先继续在这些可维护层内开发：

- `service-worker-loader.js`
- `service-worker-runtime.js`
- `custom-provider-models.js`
- `provider-format-adapter.js`
- `custom-provider-settings.js`
- `sidepanel-inline-provider.js`
- `github-update-*.js`
- `options-update-enhancer.js`

以下 bundle 仍视为高风险黑盒：

- `assets/sidepanel-BoLm9pmH.js`
- `assets/useStorageState-hbwNMVUA.js`
- `assets/PermissionManager-9s959502.js`
- `assets/mcpPermissions-qqAoJjJ8.js`

## 实施顺序

1. 先复用 `claw-contract.js`，避免存储键和消息名继续散落。
2. 再把外围桥接逻辑从页面脚本和 worker 壳层中继续外提。
3. 必须动 bundle 时，只做定点补锚和最小化改动。
4. 每外提一块逻辑，就补对应回归测试。

## 验证要求

- 基线回归：`node tests/run-all-tests.js`
- 发布前确认 zip 打包清单包含所有新增根目录脚本
- 手工冒烟至少覆盖 sidepanel、options、自定义 provider、更新检查、会话恢复、独立窗口
