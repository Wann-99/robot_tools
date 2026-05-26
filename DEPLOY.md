# 部署到 Cloudflare Pages

## 一次性准备

```bash
npm install   # 拉新增的 jszip / terser / vite-plugin-javascript-obfuscator
```

## 本地预览生产构建（验证混淆 + 分包是否能正常跑）

```bash
npm run build
npm run preview
```

打开 `http://localhost:4173`，进 DevTools → Sources 看一眼 `assets/index-xxx.js`——应该几乎不可读（控制流扁平化 + 字符串数组 + 标识符乱码）。

## 部署到 Cloudflare Pages

### 方式 A：Git 集成（推荐）

1. 把工程推到 GitHub / GitLab
2. Cloudflare Dashboard → Pages → Create a project → Connect to Git
3. 选仓库，配置：
   - **Framework preset**：Vite
   - **Build command**：`npm run build`
   - **Build output directory**：`dist`
   - **Node version**：18 或 20
4. 部署完成后会得到 `xxx.pages.dev` 域名

### 方式 B：Wrangler 手动上传

```bash
npm install -g wrangler
wrangler login
npm run build
wrangler pages deploy dist --project-name=robot-tools
```

## 启用真鉴权（Cloudflare Access）

⚠ 这一步**必须做**——之前的 `SECRET_KEY` 假鉴权已删除。

1. Cloudflare Dashboard → **Zero Trust** → Access → Applications → **Add an application**
2. 选 **Self-hosted**
3. 配置：
   - **Application name**：robot-tools
   - **Session duration**：例如 24 hours
   - **Application domain**：你的 Pages 域名（如 `xxx.pages.dev` 或自定义域名）
4. 下一步配 **Policies**：
   - **Policy name**：example "Allow internal users"
   - **Action**：Allow
   - **Include**：选 `Emails` 列举允许的邮箱，或选 `Emails ending in @公司域名.com`，也可以接 Google/GitHub OAuth
5. 保存

部署后访问域名 → 会先跳到 CF Access 登录页 → 通过后才进入应用。

应用顶部右上角的用户头像会自动从 CF Access 拉取邮箱显示（`/cdn-cgi/access/get-identity`），登出按钮跳 `/cdn-cgi/access/logout`。

## log-fetcher 工具的说明

LogFetcher 工具（FTP/Telnet 拉日志）**需要用户本地运行 `server.js`**（在 `server/log-fetcher/` 目录），监听 `localhost:3001`。前端会直接 fetch 这个本地地址。

请在 README 或工具内提示用户：
```bash
cd server/log-fetcher
npm install
node server.js
```

⚠ `_headers` 文件里的 CSP 已经放行了 `connect-src http://localhost:3001`，所以前端调用本地服务不会被 CSP 拦截。

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

## 如果要彻底"防盗"

源码无法 100% 防盗——但你已经做到了：

1. ✅ Terser minify + mangle
2. ✅ JavaScript Obfuscator 强混淆（控制流、字符串、标识符）
3. ✅ Self-defending（代码被格式化就会自毁）
4. ✅ 无 sourcemap
5. ✅ Cloudflare Access 锁住未授权访问

进一步**真正的保护**需要把核心业务逻辑搬到 Cloudflare Workers / Functions——前端只调用 API。当前所有工具都是纯前端，所以拿到的只能是 UI + 解析算法，**不存在任何后端密钥泄露**。

## 故障排查

- **构建报 Terser 找不到**：`npm install terser --save-dev`
- **混淆后某些功能崩溃**：调低 `vite.config.js` 里 `controlFlowFlatteningThreshold` 或 `stringArrayThreshold`，或临时关闭 `selfDefending`
- **CF Access 登录通过后白屏**：检查 `_headers` CSP 的 `connect-src` 是否漏了你用到的域名
- **LogFetcher 报 CORS / fetch failed**：用户本地的 `server.js` 没启动或不在 3001 端口
