# 部署到 Cloudflare Pages

## 一次性准备

```bash
npm install   # 拉新增的 jszip / terser / vite-plugin-javascript-obfuscator
```

## 本地预览生产构建（验证混淆 + 分包是否正常）

```bash
npm run build      # 产出 dist/
npm run preview    # 默认 http://localhost:4173
```

打开 `http://localhost:4173`，DevTools → Sources 看 `assets/index-xxx.js` —— 应该几乎不可读（控制流扁平化 + 字符串数组 + 标识符乱码）。

## 部署到 Cloudflare Pages

### 方式 A：Git 集成（推荐）

1. 把工程推到 GitHub / GitLab
2. Cloudflare Dashboard → Pages → Create a project → Connect to Git
3. 选仓库，配置：
   - **Framework preset**：Vite
   - **Build command**：`npm run build`
   - **Build output directory**：`dist`
   - **Node version**：18 或 20
4. 部署完成会得到 `xxx.pages.dev` 域名

### 方式 B：Wrangler 手动上传

```bash
npm install -g wrangler
wrangler login
npm run build
wrangler pages deploy dist --project-name=robot-tools
```

## 关于"登录"

应用首屏的登录页**只是身份标识 UI**，不是真实鉴权：
- 账号密码用 XOR + base64 简单编码后存在浏览器 `localStorage`
- 任何打开 DevTools 的人都能读到、改到、绕过
- 默认账号：`admin / admin123`，注册功能开放

它的作用：
- 在工具内部记录"是谁触发了 AI 调用"（AI 调用日志按用户名分）
- 顶部头像显示用户名

如果你需要**真实的访问控制**（不让陌生人打开页面），有两条路：

1. **不部署到公开 Pages**——只在内网或本机用
2. **在 Cloudflare 外层加 Cloudflare Access**——零代码改动，配置完后只有授权用户能加载页面（详情可在 Cloudflare Zero Trust dashboard 里加 Self-hosted application 保护你的 Pages 域名）

## log-fetcher 工具的说明

LogFetcher（FTP/Telnet 拉日志）**需要用户本地或工控机运行 `server.js`**（在 `server/`），默认监听 `localhost:3101`。前端直接 fetch 这个本地地址（或 Cloudflare Tunnel 暴露的 HTTPS 地址）。

请在 README 或工具内提示用户：
```bash
cd server/log-fetcher
npm install
node server.js
```

`_headers` 文件里的 CSP 已经放行了 `connect-src 'self' http://localhost:* https:`（任意 localhost 端口 + 所有 HTTPS），不会被 CSP 拦截。

## 已生效的性能优化

- ✅ **代码分包**：`react-core / antd / echarts / recharts / motion / icons / datepicker` 各自独立 chunk
- ✅ **工具懒加载**：每个工具（RcaLog / LogFetcher / PlanParser）首次进入才下载其代码
- ✅ **去 console**：生产构建 `drop_console: true`
- ✅ **去 sourcemap**：生产无 sourcemap
- ✅ **强混淆**：仅对 `src/**` 启用 JS Obfuscator（控制流扁平化 + 字符串数组 + 标识符 mangling + selfDefending）
- ✅ **静态资源缓存**：`_headers` 里 `/assets/*` 设了 1 年 immutable 缓存（带 hash），`/index.html` 不缓存

## 已生效的安全 headers

`public/_headers`：

- `Content-Security-Policy` —— 只允许 self 脚本 + 必要的 AI API 域名
- `X-Frame-Options: DENY` —— 防 clickjacking
- `Referrer-Policy` —— 限制泄露 referrer
- `Permissions-Policy` —— 禁用 geolocation/camera/mic 等
- `Strict-Transport-Security` —— HSTS 1 年
- `X-Robots-Tag: noindex` —— 阻止搜索引擎索引

## 故障排查

- **构建报 Terser 找不到**：`npm install terser --save-dev`
- **混淆后某些功能崩溃**：调低 `vite.config.js` 里 `controlFlowFlatteningThreshold` 或 `stringArrayThreshold`，或临时关闭 `selfDefending`
- **LogFetcher 报 CORS / fetch failed**：用户本地的 `server.js` 没启动或不在配置的端口（默认 3101）
