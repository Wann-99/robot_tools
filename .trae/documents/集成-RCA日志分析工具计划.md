# 集成 RCA 日志分析工具计划

## Summary
- 将 `d:\PythonDevelop\Projects\PycharmProjects\robot_calc_beat\.trae\specs\define-tool-home-experience\robot-rca-log` 作为新工具原生集成到当前工具集。
- 新工具在首页卡片名称显示为“RCA日志分析”，图标采用与现有工具卡片一致的简洁风格，由主项目统一控制。
- 集成后保留现有工具集的登录、首页卡片入口、顶部导航和右上角用户菜单；新工具页面适配当前浅色工作台风格，而不是保留独立项目的整套外壳。
- 集成完成并验证后，删除独立目录 `robot-rca-log`，避免仓库同时维护两套实现。

## Current State Analysis
- 当前工具集入口集中在 `src/App.jsx`：
  - `TOOLS` 注册表定义工具卡片，当前只有 `beat-analyzer`。
  - 首页由 `ToolHub()` 渲染，点击卡片通过 `activeTool` 切换工具页。
  - 工具页分发也在 `src/App.jsx` 内部用条件渲染实现。
- 主项目依赖为 `React 18 + antd + framer-motion + recharts`，见 `package.json`。
- 待集成项目 `robot-rca-log` 是独立 Vite 应用：
  - 入口为 `robot-rca-log/src/App.jsx`。
  - 依赖 `echarts`、`echarts-for-react`、`lucide-react`、`web worker` 等，且当前 `package.json` 使用 `React 19`。
  - 解析逻辑在 `robot-rca-log/src/logWorker.js`，用于多文件日志异步解析。
  - 图表组件拆分为：
    - `src/components/AlertScatterChart.jsx`
    - `src/components/StateTimelineChart.jsx`
    - `src/components/TopAlertsList.jsx`
- 目标项目的产品定位来自 `robot-rca-log/documents/prd.md`：
  - 展示设备信息与全局统计卡片。
  - 展示状态流转时序图。
  - 展示异常散点图与高频报警排行。
- 用户已确认的关键决策：
  - 集成方式：原生集成。
  - 页面风格：适配当前工具集浅色风格。
  - 工具图标：由我按当前工具集风格统一选定。
  - 迁移后清理：集成完成后删除独立目录 `robot-rca-log`。

## Proposed Changes

### 1. 主项目依赖补齐与兼容处理
- 文件：`package.json`
- 变更：
  - 增加 `echarts`、`echarts-for-react`、`lucide-react`。
  - 不引入 `robot-rca-log` 的 React 19 版本依赖，统一沿用主项目的 React 18。
- 原因：
  - 原生集成需要直接在主项目中渲染 ECharts 图表和 Lucide 图标。
  - 保持单一 React 版本，避免运行时冲突。
- 实现要点：
  - 只迁移实际用到的依赖，不迁移其独立 Vite 配置、eslint 配置和 Tailwind v4 配置。

### 2. 新建 RCA 日志分析工具源码目录
- 文件：
  - `src/components/rca-log/RcaLogTool.jsx`
  - `src/components/rca-log/AlertScatterChart.jsx`
  - `src/components/rca-log/StateTimelineChart.jsx`
  - `src/components/rca-log/TopAlertsList.jsx`
  - `src/components/rca-log/logWorker.js`
- 变更：
  - 将 `robot-rca-log/src/App.jsx` 的主体逻辑拆出为可复用的工具组件 `RcaLogTool`。
  - 将 3 个图表/列表组件迁入主项目，并改用主项目可用的导入路径。
  - 保留 `?worker` 方式引入 `logWorker.js`，但路径改为主项目组件目录或独立 worker 文件。
- 原因：
  - 当前 `src/App.jsx` 已经很大，不适合继续把第二个复杂工具直接塞进同一文件。
  - 组件化迁移便于后续维护，也便于把现有工具逐步拆分。
- 实现要点：
  - 保留 `robot-rca-log` 的多文件上传、Worker 异步解析、虚拟列表、过滤、自动滚动、时间线图和异常统计等能力。
  - 删除独立应用壳层（如 `h-screen w-screen` 的整页根容器），改成适配工具集工作区的 `h-full`/`flex-1` 布局。
  - 清理 demo 资产与静态示例数据依赖，不把 `src/data/`、`src/assets/react.svg`、`src/assets/vite.svg`、`hero.png` 迁入主项目。

### 3. 浅色风格适配
- 文件：
  - `src/components/rca-log/RcaLogTool.jsx`
  - `src/index.css`（仅当需要补充少量全局变量/滚动条样式时）
- 变更：
  - 将 `robot-rca-log` 原始页面中的深色面板、深色 tooltip、深色边框风格适配到当前工具集浅色工作台视觉。
  - 统一与现有导航、卡片、留白、圆角和阴影体系。
- 原因：
  - 用户已明确要求新工具适配现有浅色风格。
  - 现有工具集顶部导航与右上角用户菜单应保持一致体验。
- 实现要点：
  - 保留信息架构，不强行复刻其深色主题。
  - ECharts 的背景、坐标轴、tooltip 配色改为适合浅色背景的样式。
  - 拖拽上传空态、进度态、结果态都使用当前工具集语言。

### 4. 工具注册与入口接入
- 文件：`src/App.jsx`
- 变更：
  - 在 `TOOLS` 数组中新增：
    - `id: "rca-log-analyzer"`
    - `name: "RCA日志分析"`
    - 简洁图标（默认使用文档/日志语义图标）
  - 在工具分发区域中新增 `activeTool === "rca-log-analyzer"` 的渲染分支。
  - 新工具页继续复用现有顶部导航与用户菜单，不重复实现应用级壳层。
- 原因：
  - 当前项目只有一种工具接入方式，即 `TOOLS + activeTool`。
- 实现要点：
  - 保持首页卡片展示规则不变，只新增卡片。
  - 不改动现有 `beat-analyzer` 的行为。

### 5. 独立项目内容清理
- 文件/目录：
  - `d:\PythonDevelop\Projects\PycharmProjects\robot_calc_beat\.trae\specs\define-tool-home-experience\robot-rca-log`
- 变更：
  - 在主项目集成验证通过后删除该目录。
- 原因：
  - 用户已明确要求迁移后删除独立目录，避免双份源码。
- 实现要点：
  - 删除前先确认主项目中的新工具可正常运行。
  - 删除范围包括独立项目的源码、依赖清单、构建配置、文档与临时脚本。

## Assumptions & Decisions
- 决策：采用原生源码迁移，不用 iframe，不保留第二个独立前端应用。
- 决策：保留 `robot-rca-log` 的核心能力，而不是只迁移一部分解析逻辑。
- 决策：新工具将拆到 `src/components/rca-log/`，而不是继续堆叠进 `src/App.jsx`。
- 决策：工具集首页卡片图标由主项目统一定义，保持和现有卡片风格一致。
- 决策：迁移后直接删除独立目录 `robot-rca-log`。
- 假设：`echarts-for-react` 在 React 18 下可直接工作，不需要额外兼容层。
- 假设：Worker 的 `File.text()` 调用在当前目标浏览器环境可用，沿用原实现即可。
- 假设：现有主项目允许新增若干源文件与依赖，不要求保持单文件 `App.jsx` 架构。

## Verification Steps
- 依赖验证：
  - 安装新增依赖后，确认主项目可正常启动/构建。
- 功能验证：
  - 首页显示新卡片“RCA日志分析”。
  - 点击卡片后进入新工具页。
  - 支持多文件拖拽/选择上传。
  - Worker 可完成解析并返回设备信息、日志流、状态时间线、异常散点、Top Alerts。
  - 搜索、级别筛选、自动滚动、跳转到底部等交互可用。
- 视觉验证：
  - 新工具页在现有浅色工作台中显示协调，无独立应用外壳残留。
  - 顶部导航和右上角用户菜单正常叠加，不被工具内容遮挡。
- 兼容与清理验证：
  - 新工具运行正常后，删除 `robot-rca-log` 目录。
  - 删除后再次启动/构建主项目，确认无缺失引用。
