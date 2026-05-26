import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer,
  BarChart, Bar, Cell
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { DatePicker, ConfigProvider, Select } from "antd";
import locale from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
// Lazy-load each tool so the homepage ships with only its own code.
// Each tool's chunk is fetched on demand the first time the user selects it.
const RcaLogTool     = lazy(() => import("./components/rca-log/RcaLogTool"));
const LogFetcherTool = lazy(() => import("./components/log-fetcher/LogFetcherTool"));
const PlanParserTool = lazy(() => import("./components/plan-parser/PlanParserTool"));

dayjs.locale("zh-cn");
const { RangePicker } = DatePicker;

/* ============================================================
   "GREETING" LOGIN — NOT real authentication.
   This is a UI-only gate so we can show a name in the header and
   log "who" triggered AI calls. Anyone who reads the bundled JS can
   trivially bypass it. For real protection, use Cloudflare Access
   or another edge auth gate.
   ============================================================ */
const _OBF_KEY = "RCALOG_2026";
const encodePwd = (str) => {
  let encoded = "";
  for (let i = 0; i < str.length; i++)
    encoded += String.fromCharCode(str.charCodeAt(i) ^ _OBF_KEY.charCodeAt(i % _OBF_KEY.length));
  return btoa(encoded);
};
const decodePwd = (b64) => {
  try {
    const decoded = atob(b64); let str = "";
    for (let i = 0; i < decoded.length; i++)
      str += String.fromCharCode(decoded.charCodeAt(i) ^ _OBF_KEY.charCodeAt(i % _OBF_KEY.length));
    return str;
  } catch { return ""; }
};

/* ============================================================
   BEAT ANALYZER — algorithm (unchanged)
   ============================================================ */
const splitCyclesAuto = (nodes) => {
  if (!nodes || nodes.length === 0) return [];
  const posMap = {};
  nodes.forEach((n, i) => { if (!posMap[n.name]) posMap[n.name] = []; posMap[n.name].push(i); });

  let bestNode = null, bestScore = 0, bestPattern = null;
  Object.entries(posMap).forEach(([name, positions]) => {
    if (positions.length < 2) return;
    const diffs = [];
    for (let i = 1; i < positions.length; i++) diffs.push(positions[i] - positions[i - 1]);
    const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const variance = diffs.reduce((a, b) => a + (b - avg) ** 2, 0) / diffs.length;
    const stability = 1 / (1 + Math.sqrt(variance));
    const lengthScore = avg >= 2 && avg <= 15 ? 1.2 : 1;
    let simScore = 0, simCount = 0;
    for (let i = 0; i < positions.length - 1; i++) {
      const nextPos = i + 2 < positions.length ? positions[i + 2] : nodes.length;
      const s1 = nodes.slice(positions[i], positions[i + 1]);
      const s2 = nodes.slice(positions[i + 1], nextPos);
      let matches = 0;
      const cl = Math.min(s1.length, s2.length);
      for (let j = 0; j < cl; j++) if (s1[j].name === s2[j].name) matches++;
      simScore += s1.length > 0 ? matches / s1.length : 0;
      simCount++;
    }
    const avgSim = simCount > 0 ? simScore / simCount : 0;
    const score = positions.length * stability * lengthScore * avgSim ** 2;
    if (score > bestScore) { bestScore = score; bestNode = name; bestPattern = { positions, avgInterval: avg, diffs, avgSim }; }
  });

  if (!bestNode || !bestPattern || bestScore < 0.1)
    return [{ type: "all", nodes, total: nodes.reduce((a, b) => a + b.time, 0) }];

  let b = [...bestPattern.positions], maxShift = 0;
  while (true) {
    const shift = maxShift + 1;
    if (b[0] - shift < 0) break;
    const refNode = nodes[b[0] - shift].name;
    if (b.every((pos, i) => b[i] - shift >= 0 && nodes[b[i] - shift].name === refNode)) maxShift = shift;
    else break;
  }
  b = b.map(x => x - maxShift);

  const groups = [];
  if (b[0] > 0) { const init = nodes.slice(0, b[0]); groups.push({ type: "init", nodes: init, total: init.reduce((a, x) => a + x.time, 0) }); }
  let loopIndex = 1;
  for (let i = 0; i < b.length - 1; i++) {
    const slice = nodes.slice(b[i], b[i + 1]);
    groups.push({ type: "loop", index: loopIndex++, nodes: slice, total: slice.reduce((a, x) => a + x.time, 0), triggerNode: bestNode });
  }
  const lastPos = b[b.length - 1];
  if (lastPos < nodes.length) {
    let tail = nodes.slice(lastPos);
    while (tail.length > 0) {
      let extracted = false;
      if (groups.length > 0 && groups[groups.length - 1].type === "loop") {
        const prevLoop = groups[groups.length - 1].nodes;
        const loopStartNode = prevLoop[0].name;
        let nextStartRelIdx = -1;
        const minLen = Math.max(1, Math.floor(prevLoop.length * 0.5));
        for (let i = minLen; i < tail.length; i++) {
          if (tail[i].name === loopStartNode) {
            let matches = 0;
            const cl = Math.min(i, prevLoop.length);
            for (let j = 0; j < cl; j++) if (tail[j].name === prevLoop[j].name) matches++;
            if (matches / cl >= 0.7) { nextStartRelIdx = i; break; }
          }
        }
        if (nextStartRelIdx === -1 && tail.length >= prevLoop.length) {
          let matches = 0;
          for (let i = 0; i < prevLoop.length; i++) if (tail[i].name === prevLoop[i].name) matches++;
          if (matches / prevLoop.length >= 0.8) nextStartRelIdx = prevLoop.length;
        }
        if (nextStartRelIdx !== -1) {
          const extraLoop = tail.slice(0, nextStartRelIdx);
          groups.push({ type: "loop", index: loopIndex++, nodes: extraLoop, total: extraLoop.reduce((a, x) => a + x.time, 0), triggerNode: bestNode });
          tail = tail.slice(nextStartRelIdx); extracted = true;
        }
      }
      if (!extracted) break;
    }
    if (tail.length > 0)
      groups.push({ type: tail.some(n => n.name === bestNode) ? "tail" : "cleanup", nodes: tail, total: tail.reduce((a, x) => a + x.time, 0) });
  }
  return groups;
};

const GROUP_CONFIG = {
  init:    { icon: "🚀", label: "初始化",   gradient: "bg-slate-50",      borderColor: "border-slate-200",  badgeColor: "bg-slate-400",   textColor: "text-slate-700"  },
  loop:    { icon: "🔄", label: "循环",     gradient: "bg-blue-50/50",    borderColor: "border-blue-200",   badgeColor: "bg-blue-500",    textColor: "text-blue-700"   },
  tail:    { icon: "⚠️", label: "尾部异常", gradient: "bg-orange-50/50",  borderColor: "border-orange-200", badgeColor: "bg-orange-500",  textColor: "text-orange-700" },
  cleanup: { icon: "🧹", label: "清理阶段", gradient: "bg-emerald-50/50", borderColor: "border-emerald-200",badgeColor: "bg-emerald-500", textColor: "text-emerald-700"},
  all:     { icon: "📋", label: "完整序列", gradient: "bg-purple-50/50",  borderColor: "border-purple-200", badgeColor: "bg-purple-500",  textColor: "text-purple-700" },
};

/* ============================================================
   TOOL REGISTRY  —  add new tools here
   ============================================================ */
const TOOLS = [
  {
    id: "beat-analyzer",
    name: "节拍统计分析",
    nameEn: "Beat Analyzer",
    desc: "解析 RCA .log 日志，自动识别循环结构，统计各 Plan 的节点耗时分布，支持 AI 诊断报告导出。",
    icon: "⏱",
    color: "blue",
    badge: "核心工具",
  },
  {
    id: "rca-log-analyzer",
    name: "RCA日志分析",
    nameEn: "RCA Log Analyzer",
    desc: "聚合多份机器人日志文件，支持上传解析、状态流转、异常时间分布与高频报警排行。",
    icon: "🧾",
    color: "violet",
    badge: "近期更新",
  },
  {
    id: "log-fetcher",
    name: "日志抓取",
    nameEn: "Log Fetcher",
    desc: "通过 FTP / Telnet 协议连接远程设备并拉取日志文件。",
    icon: "🌐",
    color: "emerald",
    badge: "新增工具",
  },
  {
    id: "plan-parser",
    name: "PLAN工程解析",
    nameEn: "Plan Project Parser",
    desc: "解析 Flexiv Elements Studio 工程文件，展示流程、变量、子计划与 GPIO 定义，便于快速接手。",
    icon: "🗂",
    color: "amber",
    badge: "新增工具",
  },
  // future tools — just add objects here
  // { id: "log-converter", name: "日志格式转换", icon: "🔄", color: "violet", badge: "即将上线", disabled: true },
  // { id: "diff-tool",     name: "数据 Diff 对比", icon: "⚖️", color: "emerald", badge: "规划中", disabled: true },
];

const COLOR_MAP = {
  blue:   { bg: "bg-blue-50",   border: "border-blue-200",   icon: "bg-blue-100 text-blue-600",   badge: "bg-blue-100 text-blue-600",   ring: "ring-blue-300"  },
  violet: { bg: "bg-violet-50", border: "border-violet-200", icon: "bg-violet-100 text-violet-600",badge: "bg-violet-100 text-violet-600",ring: "ring-violet-300"},
  emerald:{ bg: "bg-emerald-50",border: "border-emerald-200",icon: "bg-emerald-100 text-emerald-600",badge:"bg-emerald-100 text-emerald-600",ring:"ring-emerald-300"},
  amber:  { bg: "bg-amber-50",  border: "border-amber-200",  icon: "bg-amber-100 text-amber-600",  badge: "bg-amber-100 text-amber-600",  ring: "ring-amber-300" },
};

/* ============================================================
   TOOL HUB HOME PAGE
   ============================================================ */
function ToolHub({ onSelectTool }) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {TOOLS.map(tool => {
            const c = COLOR_MAP[tool.color] || COLOR_MAP.blue;
            return (
              <motion.button
                key={tool.id}
                whileHover={{ y: -4, scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => !tool.disabled && onSelectTool(tool.id)}
                className={`group relative flex min-h-[220px] flex-col items-center justify-center overflow-hidden rounded-[24px] border p-6 text-center transition-all duration-200 ${c.border} ${c.bg} ${tool.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer shadow-[0_18px_45px_-34px_rgba(15,23,42,0.45)] hover:-translate-y-0.5 hover:shadow-[0_24px_55px_-32px_rgba(37,99,235,0.45)]"}`}
              >
                <div className="absolute inset-0 opacity-[0.04] bg-[radial-gradient(circle_at_70%_20%,_#000_1px,_transparent_1px)] bg-[length:16px_16px] pointer-events-none" />
                <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-white/70 via-white/10 to-transparent pointer-events-none" />
                <div className="relative flex flex-col items-center justify-center">
                  <div className={`mb-5 flex h-16 w-16 items-center justify-center rounded-[24px] text-3xl shadow-sm ${c.icon}`}>
                    {tool.icon}
                  </div>
                  <h3 className="text-xl font-bold text-slate-800">{tool.name}</h3>
                </div>
              </motion.button>
            );
          })}

          <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-white/70 p-6 text-center text-slate-400">
            <div className="mb-3 text-4xl">＋</div>
            <p className="text-sm font-semibold text-slate-500">更多工具即将加入</p>
            <p className="mt-2 max-w-[16rem] text-xs leading-5 text-slate-400">后续能力会继续沿用当前首页卡片和顶部账户菜单交互。</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function UserAvatarMenu({ username, role, onOpenSettings, onOpenPwd, onLogout }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (!open || !menuRef.current) return;
      if (!menuRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const isAdmin = role === "admin";
  const initial = (username || "?").charAt(0).toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-3 rounded-2xl border px-3 py-2 text-left transition-all ${open ? "border-blue-200 bg-blue-50/80 shadow-[0_12px_30px_-22px_rgba(37,99,235,0.7)]" : "border-slate-200 bg-white/90 hover:border-slate-300 hover:bg-white"}`}
      >
        <div className={`flex h-9 w-9 items-center justify-center rounded-2xl text-xs font-black text-white shadow-sm ${isAdmin ? "bg-gradient-to-br from-violet-600 to-fuchsia-600" : "bg-gradient-to-br from-blue-600 to-indigo-600"}`}>
          {initial}
        </div>
        <div className="hidden min-w-0 sm:flex flex-col items-start leading-tight">
          <div className="max-w-[10rem] truncate text-sm font-bold text-slate-700">{username || "用户"}</div>
          <div className={`text-[10px] font-bold ${isAdmin ? "text-violet-600" : "text-slate-400"}`}>{isAdmin ? "管理员" : "普通用户"}</div>
        </div>
        <svg className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.45)] backdrop-blur"
          >
            <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
              <div className="text-sm font-bold text-slate-800">{username || "用户"}</div>
              <div className={`mt-1 text-[11px] ${isAdmin ? "text-violet-600" : "text-slate-500"}`}>
                {isAdmin ? "管理员账户" : "普通用户账户"}
              </div>
            </div>
            {isAdmin && (
              <button
                onClick={() => { setOpen(false); onOpenSettings(); }}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
              >
                <span className="w-5 text-center">⚙️</span>
                系统设置
              </button>
            )}
            <button
              onClick={() => { setOpen(false); onOpenPwd(); }}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
            >
              <span className="w-5 text-center">🔑</span>
              修改密码
            </button>
            <div className="h-px bg-slate-200" />
            <button
              onClick={() => { setOpen(false); onLogout(); }}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
            >
              <span className="w-5 text-center">🚪</span>
              退出登录
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ============================================================
   PASSWORD MODAL
   ============================================================ */
function PwdModal({ role, username, accounts, setAccounts, onClose }) {
  const [form, setForm] = useState({ old: "", next: "", confirm: "" });
  const [error, setError] = useState("");

  const submit = () => {
    setError("");
    if (!form.old || !form.next) return setError("不能为空");
    if (form.next !== form.confirm) return setError("两次新密码不一致");
    if (role === "admin") {
      if (form.old !== decodePwd(accounts.admin.passwordEncoded)) return setError("原密码错误");
      const upd = { ...accounts, admin: { ...accounts.admin, passwordEncoded: encodePwd(form.next) } };
      setAccounts(upd); localStorage.setItem("APP_ACCOUNTS", JSON.stringify(upd));
    } else {
      const idx = accounts.users.findIndex(u => u.username === username);
      if (idx === -1) return setError("用户不存在");
      if (form.old !== decodePwd(accounts.users[idx].passwordEncoded)) return setError("原密码错误");
      const users = [...accounts.users];
      users[idx] = { ...users[idx], passwordEncoded: encodePwd(form.next) };
      const upd = { ...accounts, users };
      setAccounts(upd); localStorage.setItem("APP_ACCOUNTS", JSON.stringify(upd));
    }
    alert("密码已更新");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-sm rounded-2xl border border-slate-100 bg-white p-6 shadow-2xl">
        <button onClick={onClose} className="absolute right-4 top-4 rounded-full bg-slate-100 p-1.5 text-slate-400 hover:text-slate-600">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
        <h3 className="mb-4 text-base font-bold text-slate-800">🔑 修改密码</h3>
        <div className="space-y-3">
          {[["原密码", "old"], ["新密码", "next"], ["确认新密码", "confirm"]].map(([label, key]) => (
            <div key={key}>
              <label className="mb-1 block text-xs font-bold text-slate-600">{label}</label>
              <input type="password" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && submit()}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white" />
            </div>
          ))}
        </div>
        {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        <button onClick={submit} className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
          保存
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   LOGIN PAGE (greeting / display-name only)
   ============================================================ */
function LoginPage({ accounts, setAccounts, onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", confirm: "" });
  const [error, setError] = useState("");

  const submit = () => {
    setError("");
    const { username, password, confirm } = form;
    if (!username || !password) return setError("用户名和密码不能为空");
    if (isRegister) {
      if (password !== confirm) return setError("两次密码不一致");
      if (username === accounts.admin.username || accounts.users.some(u => u.username === username))
        return setError("用户名已存在");
      const upd = { ...accounts, users: [...accounts.users, { username, passwordEncoded: encodePwd(password) }] };
      setAccounts(upd);
      localStorage.setItem("APP_ACCOUNTS", JSON.stringify(upd));
      onLogin(username, "user");
    } else {
      // admin first
      if (username === accounts.admin.username && decodePwd(accounts.admin.passwordEncoded) === password) {
        return onLogin(username, "admin");
      }
      const u = accounts.users.find(u => u.username === username && decodePwd(u.passwordEncoded) === password);
      if (!u) return setError("用户名或密码错误");
      onLogin(username, "user");
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[linear-gradient(180deg,#f8fbff_0%,#f2f6fb_42%,#eef2f7_100%)] px-4">
      <div className="w-full max-w-sm rounded-3xl border border-slate-200/80 bg-white/95 p-8 shadow-[0_24px_70px_-46px_rgba(15,23,42,0.25)]">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-[0_14px_30px_-16px_rgba(37,99,235,0.55)]">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
          </svg>
        </div>
        <h1 className="text-center text-xl font-black tracking-tight text-slate-900">机器人工具集</h1>
        <div className="text-center text-[11px] font-mono uppercase tracking-[0.2em] text-slate-400">Robot Toolkit</div>
        <p className="mt-1 text-center text-xs text-slate-500">
          {isRegister ? "注册新账号" : "请登录"}
        </p>

        <div className="mt-6 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">用户名</label>
            <input
              type="text"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && submit()}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white"
              placeholder="admin"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">密码</label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && submit()}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white"
              placeholder="••••••"
            />
          </div>
          {isRegister && (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">确认密码</label>
              <input
                type="password"
                value={form.confirm}
                onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && submit()}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:bg-white"
                placeholder="再输入一次"
              />
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <button
          onClick={submit}
          className="mt-5 w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(37,99,235,0.6)] transition-all hover:-translate-y-0.5"
        >
          {isRegister ? "注册并登录" : "登录"}
        </button>

        <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
          <button
            type="button"
            onClick={() => { setIsRegister(v => !v); setError(""); setForm({ username: "", password: "", confirm: "" }); }}
            className="text-blue-600 hover:underline"
          >
            {isRegister ? "已有账号？登录" : "没有账号？注册"}
          </button>
          <span className="text-slate-400">默认 admin/admin123 · user/user123</span>
        </div>

        <div className="mt-5 rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-[11px] leading-5 text-amber-700">
          ⚠ 此登录仅作身份标识，不是真实安全鉴权 —— 账号密码存储在你本地浏览器，所有人可注册。如需真实访问控制，请在前端外层加 Cloudflare Access 等边缘鉴权。
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   BEAT ANALYZER TOOL (full feature, extracted from original App)
   ============================================================ */
function BeatAnalyzerTool({ username, role, aiConfig, onAiLog }) {
  const [result, setResult] = useState(null);
  const [trendData, setTrendData] = useState({});
  const [activePlan, setActivePlan] = useState(null);
  const [rawText, setRawText] = useState("");
  const [fileMeta, setFileMeta] = useState(null);
  const [planFilter, setPlanFilter] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(288);
  const [isResizing, setIsResizing] = useState(false);
  const [startTime, setStartTime] = useState(null);
  const [endTime, setEndTime] = useState(null);
  const [filterNotice, setFilterNotice] = useState(null);
  const [expandedRuns, setExpandedRuns] = useState({});
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiTargetPlan, setAiTargetPlan] = useState(null);
  const abortControllerRef = useRef(null);

  useEffect(() => { setExpandedRuns({ 0: true }); if (activePlan) setAiTargetPlan(activePlan); }, [activePlan]);
  useEffect(() => {
    if (!filterNotice) return;
    const t = setTimeout(() => setFilterNotice(null), 3500);
    return () => clearTimeout(t);
  }, [filterNotice]);

  const toggleRun = (i) => setExpandedRuns(p => ({ ...p, [i]: !p[i] }));

  const startResizing = React.useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = React.useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = React.useCallback((e) => {
    if (!isResizing) return;
    const newWidth = e.clientX;
    if (newWidth >= 240 && newWidth <= 520) {
      setSidebarWidth(newWidth);
    }
  }, [isResizing]);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", resize);
      window.addEventListener("mouseup", stopResizing);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    } else {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  const parseLog = (text) => {
    const lines = text.split("\n");
    let currentPlan = null, currentRun = null, lastTimestamp = null;
    const planRuns = {};
    lines.forEach(line => {
      const tm = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\]/);
      if (tm) lastTimestamp = tm[1];
      const pm = line.match(/====== Plan \[(.*?)\]/);
      if (pm) {
        currentPlan = pm[1];
        if (!planRuns[currentPlan]) planRuns[currentPlan] = [];
        currentRun = { nodes: {}, nodeSeq: [], startTime: lastTimestamp };
        planRuns[currentPlan].push(currentRun);
      }
      const nm = line.match(/node \[(.*?)\] time : ([\d\.]+)/);
      if (nm && currentRun) {
        const [, node, t] = nm; const time = parseFloat(t);
        if (!currentRun.nodes[node]) currentRun.nodes[node] = [];
        currentRun.nodes[node].push(time);
        currentRun.nodeSeq.push({ name: node, time });
      }
      const total = line.match(/Total Time = ([\d\.]+)/);
      if (total && currentRun) {
        currentRun.total = parseFloat(total[1]);
        currentRun.groups = splitCyclesAuto(currentRun.nodeSeq);
        currentRun = null;
      }
    });
    const summary = {}, trend = {};
    Object.entries(planRuns).forEach(([plan, runs]) => {
      const filtered = runs.filter(run => {
        if (!run.startTime) return true;
        const t = dayjs(run.startTime).valueOf();
        if (startTime && t < startTime.valueOf()) return false;
        if (endTime && t > endTime.valueOf()) return false;
        return true;
      });
      if (!filtered.length) return;
      const totals = filtered.filter(r => r.total !== undefined).map(r => r.total);
      if (!totals.length) return;
      const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
      const nodeMap = {};
      filtered.forEach(run => Object.entries(run.nodes).forEach(([n, ts]) => { if (!nodeMap[n]) nodeMap[n] = []; nodeMap[n].push(...ts); }));
      const nodes = Object.entries(nodeMap).map(([node, ts]) => {
        const navg = ts.reduce((a, b) => a + b, 0) / ts.length;
        return { node, avg: navg, max: Math.max(...ts), min: Math.min(...ts) };
      }).sort((a, b) => b.avg - a.avg);
      const anomalies = [];
      filtered.forEach((run, i) => {
        const issues = [];
        if (run.total === undefined) issues.push("缺失Total");
        else if (run.total > avg * 1.2) issues.push("Total过高");
        run.issues = issues;
        if (issues.length) anomalies.push({ index: i + 1, issues });
      });
      summary[plan] = { avg, max: Math.max(...totals), min: Math.min(...totals), count: filtered.length, nodes, rawRuns: filtered, anomalies };
      trend[plan] = totals.map((t, i) => ({ index: i + 1, time: t }));
    });
    setTrendData(trend);
    return summary;
  };

  const handleFile = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const invalid = files.filter(f => !f.name.toLowerCase().endsWith(".log"));
    if (invalid.length) { alert("只允许导入 .log 格式的日志文件"); e.target.value = null; return; }
    files.sort((a, b) => a.name.localeCompare(b.name));
    const totalSize = files.reduce((a, f) => a + f.size, 0);
    setFileMeta({ isMultiple: files.length > 1, totalSize, files: files.map(f => ({ name: f.name, size: f.size })) });
    const texts = await Promise.all(files.map(f => f.text()));
    const combined = texts.join("\n");
    setRawText(combined);
    const parsed = parseLog(combined);
    setResult(parsed);
    const plans = Object.keys(parsed);
    if (plans.length) setActivePlan(plans[0]);
    e.target.value = null;
  };

  const applyFilter = () => {
    if (!rawText) return;
    const parsed = parseLog(rawText);
    const plans = Object.keys(parsed);
    if (!plans.length) { setFilterNotice("当前筛选范围内没有数据，请重新选择时间范围"); return; }
    setFilterNotice(null);
    setResult(parsed);
    if (!plans.includes(activePlan)) setActivePlan(plans[0]);
  };

  const cancelAI = () => abortControllerRef.current?.abort();

  const handleGenerateAI = async () => {
    const targetData = result && aiTargetPlan ? result[aiTargetPlan] : null;
    if (!targetData) { alert("请先选择一个有效的 Plan"); return; }
    if (!aiConfig.apiKey) {
      alert(role === "admin" ? "请先在右上角『系统设置』中配置 API Key" : "系统尚未配置 AI 密钥，请联系管理员"); return;
    }
    setIsGeneratingAI(true);
    abortControllerRef.current = new AbortController();
    try {
      const promptText = `你是机器人系统性能分析专家。请根据以下数据生成专业诊断报告。
【Plan】${aiTargetPlan}
【运行次数】${targetData.count}
【均值/最大/最小】${targetData.avg.toFixed(3)}s / ${targetData.max.toFixed(3)}s / ${targetData.min.toFixed(3)}s
【耗时最高节点 Top5】
${targetData.nodes.slice(0, 5).map(n => `- ${n.node}: 均值${n.avg.toFixed(3)}s 最大${n.max.toFixed(3)}s`).join("\n")}
【异常】${targetData.anomalies.length ? targetData.anomalies.slice(0, 10).map(a => `Run#${a.index}: ${a.issues.join(",")}`).join("; ") : "无"}
输出 Markdown，包含：整体评估、瓶颈分析、稳定性、优化建议。`;
      const res = await fetch(aiConfig.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${aiConfig.apiKey}` },
        body: JSON.stringify({ model: aiConfig.model, messages: [{ role: "user", content: promptText }] }),
        signal: abortControllerRef.current.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "API 请求失败");
      const content = data.choices[0].message.content;
      const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${aiTargetPlan}_诊断报告.md`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      onAiLog(username, aiTargetPlan, "成功");
    } catch (err) {
      if (err.name === "AbortError") onAiLog(username, aiTargetPlan, "已取消");
      else { onAiLog(username, aiTargetPlan, "失败"); alert("生成失败：" + err.message); }
    } finally { setIsGeneratingAI(false); abortControllerRef.current = null; }
  };

  const activeData = result && activePlan ? result[activePlan] : null;

  if (!result) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-6 sm:px-6 lg:px-8">
        <div className="w-full max-w-xl rounded-[28px] border border-slate-200/80 bg-white/92 px-6 py-8 shadow-[0_24px_70px_-46px_rgba(15,23,42,0.25)] sm:px-8 sm:py-9">
          <div className="mx-auto max-w-md text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[22px] border border-blue-100 bg-gradient-to-br from-blue-50 to-slate-100 text-blue-600 shadow-[0_16px_32px_-24px_rgba(37,99,235,0.45)]">
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M14 3v5h5" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 11v6m-3-3h6" />
              </svg>
            </div>

            <h2 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">导入日志文件</h2>
            <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-slate-500 sm:text-base">
              请上传包含 Plan 和节点执行时间的 `.log` 文件，系统将自动
              <br className="hidden sm:block" />
              进行循环拆解与性能分析。
            </p>

            <div className="mt-8 flex items-center justify-center">
              <label className="inline-flex min-w-[220px] cursor-pointer items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-base font-bold text-white shadow-[0_18px_34px_-22px_rgba(37,99,235,0.75)] transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_40px_-24px_rgba(79,70,229,0.85)]">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-5l-4-4m0 0L8 11m4-4v12" />
                </svg>
                选择文件并开始分析
                <input type="file" accept=".log" multiple onChange={handleFile} className="hidden" />
              </label>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#f1f5f9] font-sans text-slate-800">
      <aside style={{ width: sidebarWidth }} className="my-2 ml-2 flex flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-4">
          <div className="flex items-center gap-2 overflow-hidden">
            <span className="truncate text-sm font-bold text-slate-800">解析的 PLAN 列表</span>
            <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{result ? Object.keys(result).length : 0}</span>
          </div>
        </div>

        <div className="border-b border-slate-100 bg-white px-4 py-3">
          <div className="relative flex items-center">
            <svg className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
            <input
              type="text"
              placeholder="搜索 Plan..."
              value={planFilter}
              onChange={e => setPlanFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm outline-none transition-all placeholder:text-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>

        <div className="custom-scrollbar flex-1 overflow-y-auto bg-white p-3 space-y-2">
          {Object.keys(result).length === 0 ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-10 flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
              <svg className="h-8 w-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
              <span>没有找到符合筛选条件的 Plan</span>
            </motion.div>
          ) : (
            <motion.div initial="hidden" animate="visible" variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.05 } } }}>
              {Object.keys(result).filter(plan => plan.toLowerCase().includes(planFilter.toLowerCase())).map(plan => {
                const isActive = activePlan === plan;
                const data = result[plan];
                const hasError = data.anomalies.length > 0;
                return (
                  <button
                    key={plan}
                    onClick={() => setActivePlan(plan)}
                    className={`group mb-2 flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-all duration-200 ${
                      isActive ? "bg-blue-600 text-white shadow-md ring-1 ring-blue-600" : "bg-white text-slate-700 hover:border-slate-300 hover:shadow-sm"
                    } border-slate-200`}
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className={`truncate font-mono text-sm font-semibold transition-colors ${isActive ? "text-white" : "text-slate-600 group-hover:text-slate-800"}`} title={plan}>
                        {plan}
                      </div>
                      <div className={`mt-1 flex items-center gap-2 text-[11px] ${isActive ? "text-blue-200" : "text-slate-400"}`}>
                        <span className="flex items-center gap-1"><svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> {data.avg.toFixed(3)}s</span>
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                      <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${isActive ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500 group-hover:bg-slate-200"}`}>
                        {data.count} 次
                      </span>
                      {hasError && <span className={`h-2 w-2 rounded-full ${isActive ? "bg-white" : "bg-red-400"}`}></span>}
                    </div>
                  </button>
                );
              })}
            </motion.div>
          )}
        </div>
      </aside>

      <div
        onMouseDown={startResizing}
        className={`mx-0.5 my-2 flex w-1.5 flex-shrink-0 cursor-col-resize items-center justify-center rounded-full transition-colors ${isResizing ? "bg-blue-100" : "bg-transparent hover:bg-slate-200"}`}
        title="拖动调整宽度"
      >
        <div className={`h-8 w-0.5 rounded-full ${isResizing ? "bg-blue-400" : "bg-slate-300"}`}></div>
      </div>

      <main className="flex min-w-0 flex-1 flex-col space-y-4 overflow-y-auto py-2 pr-2">
        <div className="flex flex-shrink-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="relative z-20 flex flex-col items-start justify-between gap-4 border-b border-slate-100 bg-white p-4 md:flex-row md:items-center md:px-6 md:py-4">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
              </div>
              <div className="flex flex-row items-center gap-4">
                <h1 className="whitespace-nowrap text-lg font-extrabold leading-tight tracking-tight text-slate-900">RCA.log Analyzer</h1>
                <div className="grid auto-cols-max grid-flow-col items-center gap-x-3 gap-y-1.5">
                  {!fileMeta ? (
                    <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">未导入文件</span>
                  ) : fileMeta.isMultiple ? (
                    fileMeta.files.map((f, i) => (
                      <span key={i} className="w-fit rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-slate-500">
                        {f.name} · {(f.size / 1024).toFixed(1)} KB
                      </span>
                    ))
                  ) : (
                    <span className="w-fit rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-slate-500">
                      {fileMeta.files[0].name} · {(fileMeta.totalSize / 1024).toFixed(1)} KB
                    </span>
                  )}
                </div>
              </div>
            </div>

            {result && Object.keys(result).length > 0 && (
              <div className="flex items-center gap-2 self-end md:self-auto">
                <Select
                  value={aiTargetPlan}
                  onChange={setAiTargetPlan}
                  options={Object.keys(result).map(plan => ({ value: plan, label: plan }))}
                  className="w-[200px]"
                  placeholder="选择分析的 Plan"
                  size="large"
                />
                <button
                  onClick={isGeneratingAI ? cancelAI : handleGenerateAI}
                  className={`flex h-[40px] items-center gap-2 rounded-lg px-4 text-sm font-bold shadow-sm transition-all ${
                    isGeneratingAI
                      ? "border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:shadow-md hover:-translate-y-0.5"
                      : "bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:shadow-md hover:-translate-y-0.5"
                  }`}
                >
                  {isGeneratingAI ? <><svg className="h-4 w-4 animate-spin text-red-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> 停止分析</> : <>✨ 生成 AI 诊断报告</>}
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-50/50 p-3 md:px-6 md:py-3">
            <div className="flex w-full items-center gap-3 md:w-auto">
              <span className="text-sm font-bold text-slate-600">时间筛选</span>
              <ConfigProvider locale={locale} theme={{ token: { colorPrimary: "#3b82f6", borderRadius: 6 } }}>
                <RangePicker
                  showTime={{ format: "HH:mm" }}
                  format="YYYY-MM-DD HH:mm"
                  allowEmpty={[true, true]}
                  onChange={(dates) => {
                    if (dates) {
                      setStartTime(dates[0] || null);
                      setEndTime(dates[1] || null);
                    } else {
                      setStartTime(null);
                      setEndTime(null);
                    }
                  }}
                  value={[startTime, endTime]}
                  className="h-[36px] w-[320px] border-slate-200 bg-white shadow-sm hover:border-blue-400 focus:border-blue-500"
                />
              </ConfigProvider>
              <button className="flex h-[36px] items-center justify-center rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white shadow-md transition-all active:scale-95 hover:bg-slate-800" onClick={applyFilter}>
                应用筛选
              </button>

              <AnimatePresence initial={false}>
                {filterNotice && (
                  <motion.div
                    key="filter-notice"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600"
                  >
                    <span className="text-red-500">⚠️</span> {filterNotice}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {!activeData ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-400 shadow-sm">
            <svg className="mb-4 h-16 w-16 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            <p className="text-lg font-medium">请从左侧选择一个 Plan 以查看详情</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div key={activePlan} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="space-y-4">
                {/* stats */}
                <div className="rounded-[22px] border border-slate-200/90 bg-white/95 p-5 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.45)]">
                  <h2 className="mb-4 flex items-center gap-3 text-[17px] font-black text-slate-900">
                    <span className="h-6 w-1.5 rounded-full bg-blue-500" />
                    选择 {activePlan} 以分析
                  </h2>
                  <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
                    {[["执行次数", activeData.count, "次"], ["平均节拍", activeData.avg.toFixed(3), "s"], ["最大耗时", activeData.max.toFixed(3), "s"], ["最小耗时", activeData.min.toFixed(3), "s"]].map(([label, val, unit]) => (
                      <div key={label}>
                        <div className="mb-1.5 text-[11px] font-bold text-slate-500">{label}</div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-[2.7rem] font-black text-slate-900 tabular-nums leading-none xl:text-[3rem]">{val}</span>
                          <span className="text-xs text-slate-400">{unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* anomalies */}
                {activeData.anomalies.length > 0 && (
                  <div className="rounded-[22px] border border-red-100 bg-red-50/85 p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-red-700">⚠️ 检测到异常执行</h3>
                    <div className="flex flex-wrap gap-2">
                      {activeData.anomalies.map(a => (
                        <div key={a.index} className="flex items-center gap-2 rounded-xl border border-red-100 bg-white px-3 py-1.5 text-xs text-red-700">
                          <span className="rounded-md bg-red-50 px-2 py-0.5 font-bold">Run #{a.index}</span>
                          {a.issues.join("，")}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* charts */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                  <div className="lg:col-span-2 rounded-[24px] border border-slate-200/90 bg-white/95 p-5 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.45)]">
                    <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-700"><span className="rounded-lg bg-slate-100 p-1.5">📈</span>信号时间序列趋势</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={trendData[activePlan]} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="index" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)" }} />
                        <Line type="monotone" dataKey="time" stroke="#3b82f6" strokeWidth={2.5} dot={{ fill: "#3b82f6", r: 3 }} activeDot={{ r: 5, strokeWidth: 0, fill: "#2563eb" }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="rounded-[24px] border border-slate-200/90 bg-white/95 p-5 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.45)]">
                    <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-700"><span className="rounded-lg bg-slate-100 p-1.5">📊</span>多信号均值对比 (Top)</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={activeData.nodes} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="node" stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} interval={0} tick={{ width: 48 }} />
                        <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                        <Tooltip cursor={{ fill: "#f8fafc" }} contentStyle={{ borderRadius: 12, border: "none", boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)" }} />
                        <Bar dataKey="avg" radius={[4, 4, 0, 0]} maxBarSize={28}>
                          {activeData.nodes.map((_, i) => <Cell key={i} fill={i === 0 ? "#f43f5e" : "#94a3b8"} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* run list */}
                <div className="rounded-[24px] border border-slate-200/90 bg-white/95 shadow-[0_18px_45px_-38px_rgba(15,23,42,0.45)]">
                  <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2"><span className="bg-blue-100 text-blue-600 p-1.5 rounded-lg">🔄</span>节点执行流拆解</h3>
                    <span className="text-xs text-slate-400">共 {activeData.rawRuns.length} 次</span>
                  </div>
                  <div className="p-5 space-y-4">
                    {activeData.rawRuns.map((run, i) => {
                      const total = run.groups?.reduce((s, g) => s + g.total, 0) || 0;
                      const loops = run.groups?.filter(g => g.type === "loop") || [];
                      const loopTs = loops.map(g => g.total).filter(Number.isFinite);
                      const loopAvg = loopTs.length ? loopTs.reduce((a, b) => a + b, 0) / loopTs.length : null;
                      const isExp = !!expandedRuns[i];
                      return (
                        <div key={i} className="bg-slate-50/90 rounded-2xl border border-slate-200">
                          <div onClick={() => toggleRun(i)}
                            className={`flex items-center justify-between px-4 py-3 bg-white/95 cursor-pointer hover:bg-blue-50/50 transition-colors ${loops.length > 0 && isExp ? "sticky top-2 z-20 border-b border-slate-200 rounded-t-2xl shadow-sm backdrop-blur" : isExp ? "border-b border-slate-200 rounded-t-2xl" : "rounded-2xl"}`}>
                            <div className="flex items-center gap-3">
                              <span className="bg-slate-800 text-white w-6 h-6 rounded flex items-center justify-center text-xs font-bold">{i + 1}</span>
                              <span className="text-sm font-bold text-slate-700">运行记录 #{i + 1}</span>
                              {loops.length > 0 && <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-100 rounded">发现 {loops.length} 个循环</span>}
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="hidden md:flex gap-2 text-[11px] text-slate-500">
                                <span className="bg-white border border-slate-200 rounded px-2 py-0.5">均值: {loopAvg != null ? loopAvg.toFixed(3) + "s" : "-"}</span>
                                <span className="bg-white border border-slate-200 rounded px-2 py-0.5">最大: {loopTs.length ? Math.max(...loopTs).toFixed(3) + "s" : "-"}</span>
                              </div>
                              <span className="text-sm font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-lg">{total.toFixed(3)}s</span>
                              <svg className={`w-4 h-4 text-slate-400 transition-transform ${isExp ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
                            </div>
                          </div>
                          <AnimatePresence initial={false}>
                            {isExp && (
                              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
                                <div className="p-3 space-y-2">
                                  {run.groups?.map((g, gi) => {
                                    const cfg = GROUP_CONFIG[g.type] || GROUP_CONFIG.all;
                                    const pct = total > 0 ? ((g.total / total) * 100).toFixed(1) : 0;
                                    return (
                                      <div key={gi} className={`rounded-xl border ${cfg.borderColor} ${cfg.gradient} overflow-hidden`}>
                                        <div className="flex items-center justify-between px-3 py-2 border-b border-white/40">
                                          <div className="flex items-center gap-2">
                                            <span className="text-sm">{cfg.icon}</span>
                                            <span className={`text-xs font-bold ${cfg.textColor}`}>{cfg.label} {g.type === "loop" ? g.index : ""}</span>
                                            {g.triggerNode && <span className="text-[10px] text-slate-400 bg-white/60 px-1.5 rounded">Trigger: {g.triggerNode}</span>}
                                          </div>
                                          <div className="flex items-center gap-3">
                                            <div className="flex items-center gap-1.5 w-28">
                                              <div className="h-1 flex-1 bg-slate-200 rounded-full overflow-hidden">
                                                <div className={`h-full ${cfg.badgeColor} rounded-full`} style={{ width: `${pct}%` }} />
                                              </div>
                                              <span className="text-[10px] text-slate-400 w-10 text-right">{pct}%</span>
                                            </div>
                                            <span className={`text-xs font-black ${cfg.textColor} bg-white px-2 py-0.5 rounded shadow-sm`}>{g.total.toFixed(3)}s</span>
                                          </div>
                                        </div>
                                        <div className="px-3 py-2 flex flex-wrap gap-1.5">
                                          {g.nodes.map((n, ni) => (
                                            <div key={ni} className="flex bg-white border border-slate-100 rounded shadow-sm text-[10px]">
                                              <span className="font-mono text-slate-500 px-1.5 py-0.5">{n.name}</span>
                                              <span className={`font-bold px-1.5 py-0.5 bg-slate-50 ${cfg.textColor}`}>{n.time.toFixed(3)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                </div>
            </motion.div>
          </AnimatePresence>
        )}
      </main>
    </div>
  );
}

/* ============================================================
   MODALS — Settings, Password
   ============================================================ */
function SettingsModal({ aiConfig, setAiConfig, onSave, onClose, accounts, setAccounts, aiLogs }) {
  const [tab, setTab] = useState("users");
  const [balanceInfo, setBalanceInfo] = useState("");
  const [newUser, setNewUser] = useState({ username: "", password: "" });

  const addUser = () => {
    if (!newUser.username || !newUser.password) return alert("用户名和密码不能为空");
    if (newUser.username === accounts.admin.username || accounts.users.some(u => u.username === newUser.username))
      return alert("用户名已存在");
    const updated = { ...accounts, users: [...accounts.users, { username: newUser.username, passwordEncoded: encodePwd(newUser.password) }] };
    setAccounts(updated); localStorage.setItem("APP_ACCOUNTS", JSON.stringify(updated)); setNewUser({ username: "", password: "" });
  };

  const deleteUser = (username) => {
    if (!confirm(`确定删除用户 ${username}？`)) return;
    const updated = { ...accounts, users: accounts.users.filter(u => u.username !== username) };
    setAccounts(updated); localStorage.setItem("APP_ACCOUNTS", JSON.stringify(updated));
  };

  const checkBalance = async () => {
    setBalanceInfo("查询中…");
    try {
      let res, data;
      if (aiConfig.baseUrl.includes("moonshot.cn")) {
        res = await fetch("https://api.moonshot.cn/v1/users/me/balance", { headers: { Authorization: `Bearer ${aiConfig.apiKey}` } });
        data = await res.json();
        setBalanceInfo(data.data ? `余额: ${data.data.available_balance} 元` : "解析失败");
      } else if (aiConfig.baseUrl.includes("deepseek.com")) {
        res = await fetch("https://api.deepseek.com/user/balance", { headers: { Authorization: `Bearer ${aiConfig.apiKey}`, Accept: "application/json" } });
        data = await res.json();
        const cny = data.balance_infos?.find(b => b.currency === "CNY");
        setBalanceInfo(`余额: ${cny?.total_balance ?? 0} 元`);
      } else { setBalanceInfo("当前平台暂不支持自动查询"); }
    } catch (e) { setBalanceInfo("查询失败: " + e.message); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 border border-slate-100 flex gap-6 relative">
        <button onClick={onClose} className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 bg-slate-100 rounded-full p-1.5 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>

        {/* AI config */}
        <div className="flex-1 space-y-4 border-r border-slate-100 pr-6">
          <h3 className="text-base font-bold text-slate-800">⚙️ AI 模型配置</h3>
          <p className="text-[11px] text-slate-500">配置仅保存在你本地浏览器，不会上传服务器</p>
          {[["API Base URL", "baseUrl", "https://api.moonshot.cn/v1/chat/completions"], ["模型名称", "model", "moonshot-v1-8k"], ["API Key", "apiKey", "sk-…"]].map(([label, key, placeholder]) => (
            <div key={key}>
              <label className="block text-xs font-bold text-slate-600 mb-1">{label}</label>
              <input type={key === "apiKey" ? "password" : "text"} value={aiConfig[key]} placeholder={placeholder}
                onChange={e => setAiConfig(c => ({ ...c, [key]: e.target.value }))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:border-blue-400 transition-all" />
            </div>
          ))}
          <div className="flex items-center gap-3">
            <button onClick={checkBalance} className="px-3 py-1.5 bg-indigo-50 text-indigo-600 text-xs font-bold rounded-lg hover:bg-indigo-100 transition-colors">查询余额</button>
            {balanceInfo && <span className="text-xs font-mono text-slate-500">{balanceInfo}</span>}
          </div>
          <button onClick={onSave} className="w-full py-2.5 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-colors">保存配置</button>
        </div>

        {/* users & logs */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex gap-1 bg-slate-100 p-1 rounded-lg mb-4">
            {[["users", "👤 账号管理"], ["logs", "📋 AI 日志"]].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${tab === id ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}>{label}</button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto space-y-2">
            {tab === "users" && (
              <>
                {accounts.users.map((u, i) => (
                  <div key={i} className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-lg">
                    <div>
                      <div className="text-xs font-bold text-slate-700">{u.username}</div>
                      <div className="text-[10px] text-slate-400">密码: <span className="font-bold text-purple-600">{decodePwd(u.passwordEncoded)}</span></div>
                    </div>
                    <button onClick={() => deleteUser(u.username)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                  </div>
                ))}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 mt-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">添加用户</p>
                  <div className="flex gap-2">
                    <input placeholder="用户名" value={newUser.username} onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))} className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-400" />
                    <input placeholder="密码" value={newUser.password} onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))} className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-400" />
                  </div>
                  <button onClick={addUser} className="w-full py-1.5 bg-purple-600 text-white text-xs font-bold rounded-lg hover:bg-purple-700">+ 添加</button>
                </div>
              </>
            )}
            {tab === "logs" && (
              aiLogs.length === 0
                ? <div className="text-center py-8 text-xs text-slate-400">暂无记录</div>
                : aiLogs.map(log => (
                  <div key={log.id} className="p-2.5 bg-white border border-slate-200 rounded-lg text-xs">
                    <div className="flex justify-between mb-1">
                      <span className="font-bold text-slate-700 font-mono bg-slate-100 px-1.5 rounded">{log.username || "—"}</span>
                      <span className="text-slate-400">{log.time}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 truncate max-w-[180px]">{log.plan}</span>
                      <span className={`font-bold px-2 py-0.5 rounded text-[10px] ${log.status === "成功" ? "bg-emerald-50 text-emerald-600" : log.status === "已取消" ? "bg-orange-50 text-orange-600" : "bg-red-50 text-red-600"}`}>{log.status}</span>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


/* ============================================================
   ROOT APP
   ============================================================ */
// Loading fallback shown while a tool chunk is being fetched.
function ToolLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <svg className="h-8 w-8 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
          <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <span className="text-sm">加载工具中…</span>
      </div>
    </div>
  );
}

export default function App() {
  const [activeTool, setActiveTool] = useState(null); // null = hub
  const [username, setUsername] = useState(() => localStorage.getItem("LOGGED_IN_USERNAME") || null);
  const [role, setRole] = useState(() => localStorage.getItem("LOGGED_IN_ROLE") || null);
  // Local "account book" — purely client-side. `admin` is a singleton; `users[]` are regular users.
  const [accounts, setAccounts] = useState(() => {
    const s = localStorage.getItem("APP_ACCOUNTS");
    if (s) {
      try { const p = JSON.parse(s); if (p?.admin?.passwordEncoded) return p; } catch {}
    }
    return {
      admin: { username: "admin", passwordEncoded: encodePwd("admin123") },
      users: [{ username: "user", passwordEncoded: encodePwd("user123") }],
    };
  });
  const [aiConfig, setAiConfig] = useState(() => {
    const s = localStorage.getItem("AI_CONFIG");
    return s ? JSON.parse(s) : { baseUrl: "https://api.moonshot.cn/v1/chat/completions", model: "moonshot-v1-8k", apiKey: "" };
  });
  const [aiLogs, setAiLogs] = useState(() => { try { return JSON.parse(localStorage.getItem("AI_LOGS") || "[]"); } catch { return []; } });
  const [showSettings, setShowSettings] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  const handleLogin = (name, r) => {
    setUsername(name); setRole(r);
    localStorage.setItem("LOGGED_IN_USERNAME", name);
    localStorage.setItem("LOGGED_IN_ROLE", r);
    setActiveTool(null);
  };

  const handleLogout = () => {
    setUsername(null); setRole(null);
    localStorage.removeItem("LOGGED_IN_USERNAME");
    localStorage.removeItem("LOGGED_IN_ROLE");
    setActiveTool(null);
  };

  const addAiLog = (user, plan, status) => {
    const entry = { id: Date.now(), username: user, plan, status, time: new Date().toLocaleString() };
    setAiLogs(prev => { const u = [entry, ...prev].slice(0, 100); localStorage.setItem("AI_LOGS", JSON.stringify(u)); return u; });
  };

  const saveAiConfig = () => {
    localStorage.setItem("AI_CONFIG", JSON.stringify(aiConfig));
    setShowSettings(false);
  };

  const currentTool = TOOLS.find(t => t.id === activeTool) || null;

  if (!username) {
    return <LoginPage accounts={accounts} setAccounts={setAccounts} onLogin={handleLogin} />;
  }

  return (
    <>
      <div className="h-screen w-full overflow-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#f2f6fb_42%,#eef2f7_100%)]">
        <div className="relative z-40 border-b border-slate-200/80 bg-white/70 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <button
                onClick={() => setActiveTool(null)}
                className={`rounded-lg px-2.5 py-1.5 font-medium transition-colors ${activeTool ? "text-slate-500 hover:bg-slate-100 hover:text-blue-600" : "bg-slate-900 text-white"}`}
              >
                工具首页
              </button>
              {currentTool && (
                <>
                  <svg className="h-4 w-4 flex-shrink-0 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
                  <button
                    onClick={() => setActiveTool(currentTool.id)}
                    className="truncate rounded-lg bg-blue-50 px-2.5 py-1.5 font-semibold text-blue-700"
                  >
                    {currentTool.name}
                  </button>
                </>
              )}
            </div>

            <UserAvatarMenu
              username={username}
              role={role}
              onOpenSettings={() => setShowSettings(true)}
              onOpenPwd={() => setShowPwd(true)}
              onLogout={handleLogout}
            />
          </div>
        </div>

        <div className="h-[calc(100%-65px)] min-h-0 overflow-hidden">
          <AnimatePresence mode="wait">
            {!activeTool ? (
              <motion.div key="hub" className="h-full overflow-hidden flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                <ToolHub onSelectTool={setActiveTool} />
              </motion.div>
            ) : activeTool === "beat-analyzer" ? (
              <motion.div key="beat" className="h-full overflow-hidden flex" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                <BeatAnalyzerTool
                  username={username}
                  role={role}
                  aiConfig={aiConfig}
                  onAiLog={addAiLog}
                />
              </motion.div>
            ) : activeTool === "rca-log-analyzer" ? (
              <motion.div key="rca-log" className="flex h-full min-h-0 overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                <Suspense fallback={<ToolLoading />}><RcaLogTool /></Suspense>
              </motion.div>
            ) : activeTool === "log-fetcher" ? (
              <motion.div key="log-fetcher" className="flex h-full min-h-0 overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                <Suspense fallback={<ToolLoading />}><LogFetcherTool /></Suspense>
              </motion.div>
            ) : activeTool === "plan-parser" ? (
              <motion.div key="plan-parser" className="flex h-full min-h-0 overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                <Suspense fallback={<ToolLoading />}><PlanParserTool /></Suspense>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {showSettings && role === "admin" && (
        <SettingsModal
          aiConfig={aiConfig}
          setAiConfig={setAiConfig}
          onSave={saveAiConfig}
          onClose={() => setShowSettings(false)}
          accounts={accounts}
          setAccounts={setAccounts}
          aiLogs={aiLogs}
        />
      )}

      {showPwd && (
        <PwdModal
          role={role}
          username={username}
          accounts={accounts}
          setAccounts={setAccounts}
          onClose={() => setShowPwd(false)}
        />
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar{width:4px}
        .custom-scrollbar::-webkit-scrollbar-track{background:transparent}
        .custom-scrollbar::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px}
      `}</style>
    </>
  );
}
