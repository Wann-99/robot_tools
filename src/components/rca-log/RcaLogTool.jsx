import React, { useState, useCallback, useMemo, useRef, useEffect, startTransition } from "react";
import {
  LayoutDashboard, AlertTriangle, Activity, TrendingUp, TerminalSquare,
  UploadCloud, X, FileText, Search, Clock, ChevronRight, ChevronDown, Filter, Trash2, FolderOpen,
  GitBranch, ArrowRight
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Cell, ReferenceLine
} from "recharts";
import LogWorker from "./logWorker?worker";
import { CATEGORY_META, SEVERITY_META, RULE_BY_ID } from "./rules";

/* ============================================================
   Top-level container
   ============================================================ */

const TABS = [
  { id: "dashboard",   name: "仪表盘",     icon: LayoutDashboard },
  { id: "fault",       name: "故障定位",   icon: AlertTriangle   },
  { id: "states",      name: "状态切换",   icon: GitBranch       },
  { id: "performance", name: "性能优化",   icon: Activity        },
  { id: "trend",       name: "趋势",       icon: TrendingUp      },
  { id: "raw",         name: "原始日志",   icon: TerminalSquare  },
];

const LEVEL_COLOR = {
  DEBUG:   "bg-slate-100 text-slate-600",
  INFO:    "bg-blue-100 text-blue-700",
  WARNING: "bg-amber-100 text-amber-700",
  ERROR:   "bg-rose-100 text-rose-700",
  CRITICAL:"bg-rose-200 text-rose-800",
  FATAL:   "bg-rose-200 text-rose-800",
};

const COLOR_CHIP = {
  blue:    "border-blue-200 bg-blue-50 text-blue-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  violet:  "border-violet-200 bg-violet-50 text-violet-700",
  amber:   "border-amber-200 bg-amber-50 text-amber-700",
  rose:    "border-rose-200 bg-rose-50 text-rose-700",
  slate:   "border-slate-200 bg-slate-50 text-slate-600",
};
const COLOR_DOT = {
  blue: "bg-blue-500", emerald: "bg-emerald-500", violet: "bg-violet-500",
  amber: "bg-amber-500", rose: "bg-rose-500", slate: "bg-slate-400",
};
const SEVERITY_TONE = {
  error: "border-rose-200 bg-rose-50/60 text-rose-700",
  warn:  "border-amber-200 bg-amber-50/60 text-amber-700",
  info:  "border-blue-200 bg-blue-50/60 text-blue-700",
};

export default function RcaLogTool() {
  const [logs, setLogs] = useState([]);
  const [summary, setSummary] = useState(null);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ percent: 0, status: "" });
  const [activeTab, setActiveTab] = useState("dashboard");
  const [dragOver, setDragOver] = useState(false);
  const pendingLogsRef = useRef([]);
  const fileInputRef = useRef(null);

  const processFiles = useCallback((files) => {
    const arr = Array.from(files).filter(f => f.name.toLowerCase().endsWith(".log"));
    if (!arr.length) { alert("请选择 .log 文件"); return; }
    // sort by file name to merge sessions chronologically (file names contain timestamps)
    arr.sort((a, b) => a.name.localeCompare(b.name));
    setLoading(true);
    setLogs([]); setSummary(null); setDeviceInfo(null);
    pendingLogsRef.current = [];
    setProgress({ percent: 0, status: "启动 Worker…" });

    const worker = new LogWorker();
    worker.onmessage = (e) => {
      const { type, percent, status, payload, message } = e.data;
      if (type === "progress") {
        setProgress({ percent, status });
      } else if (type === "log-batch") {
        for (const l of payload.logs) pendingLogsRef.current.push(l);
        if (payload.loaded % 60000 === 0 || payload.isLast) {
          setProgress({
            percent: 95 + Math.round((payload.loaded / Math.max(payload.total, 1)) * 5),
            status: `加载日志 ${payload.loaded.toLocaleString()} / ${payload.total.toLocaleString()}`,
          });
        }
      } else if (type === "hydrate-complete") {
        startTransition(() => {
          setLogs(pendingLogsRef.current);
          setSummary(payload);
          setDeviceInfo(payload.deviceInfo);
          setLoading(false);
          setActiveTab("dashboard");
        });
        worker.terminate();
      } else if (type === "error") {
        alert("解析失败：" + message);
        setLoading(false); worker.terminate();
      }
    };
    worker.postMessage(arr);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files?.length) processFiles(e.dataTransfer.files);
  }, [processFiles]);

  if (!summary && !loading) return <Intake onDrop={onDrop} dragOver={dragOver} setDragOver={setDragOver} pick={() => fileInputRef.current?.click()} fileInputRef={fileInputRef} onPick={processFiles} />;
  if (loading) return <LoadingPanel progress={progress} />;

  return (
    <div className="flex h-full w-full overflow-hidden bg-gradient-to-br from-slate-50 via-slate-100/50 to-slate-50 font-sans text-slate-800">
      <Sidebar
        summary={summary} deviceInfo={deviceInfo}
        activeTab={activeTab} setActiveTab={setActiveTab}
        onReset={() => { setSummary(null); setLogs([]); setDeviceInfo(null); }}
      />
      <main className="flex-1 overflow-y-auto px-6 py-5">
        {activeTab === "dashboard"   && <DashboardPanel summary={summary} logs={logs} />}
        {activeTab === "fault"       && <FaultPanel summary={summary} logs={logs} />}
        {activeTab === "states"      && <StatesPanel summary={summary} logs={logs} />}
        {activeTab === "performance" && <PerformancePanel summary={summary} />}
        {activeTab === "trend"       && <TrendPanel summary={summary} logs={logs} />}
        {activeTab === "raw"         && <RawLogPanel logs={logs} sessions={summary.sessions} />}
      </main>
    </div>
  );
}

/* ============================================================
   Intake + Loading
   ============================================================ */

function Intake({ onDrop, dragOver, setDragOver, pick, fileInputRef, onPick }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-8">
      <div className="w-full max-w-xl">
        <div
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          className={`rounded-3xl border-2 border-dashed px-10 py-14 text-center transition-all duration-200 ${dragOver ? "border-violet-500 bg-violet-50 scale-[1.02]" : "border-slate-300 bg-white/95 hover:border-violet-300"}`}
        >
          <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-[0_18px_45px_-18px_rgba(124,58,237,0.55)]">
            <UploadCloud className="h-10 w-10" />
          </div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 sm:text-[28px]">导入机器人日志</h2>
          <p className="mx-auto mt-3 max-w-sm text-sm text-slate-500">拖入 .log 文件或点击下方按钮选择</p>
          <button onClick={pick} className="mt-8 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-7 py-3 text-sm font-bold text-white shadow-[0_8px_24px_-8px_rgba(124,58,237,0.6)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-8px_rgba(124,58,237,0.7)]">
            <FolderOpen className="h-4 w-4" /> 选择文件
          </button>
          <input ref={fileInputRef} type="file" accept=".log" multiple
            onChange={(e) => { if (e.target.files?.length) onPick(e.target.files); e.target.value = ""; }}
            className="hidden" />
        </div>
      </div>
    </div>
  );
}

function LoadingPanel({ progress }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-2 w-2 animate-pulse rounded-full bg-violet-500" />
          <span className="font-mono text-xs text-slate-500">{progress.status}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all" style={{ width: `${progress.percent}%` }} />
        </div>
        <div className="mt-2 text-right font-mono text-xs text-slate-400">{progress.percent}%</div>
      </div>
    </div>
  );
}

/* ============================================================
   Sidebar
   ============================================================ */

function Sidebar({ summary, deviceInfo, activeTab, setActiveTab, onReset }) {
  return (
    <aside className="my-3 ml-3 flex w-60 flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]">
      <div className="border-b border-slate-100 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-[0_8px_20px_-8px_rgba(124,58,237,0.5)]">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold tracking-tight text-slate-900">RCA 日志分析</div>
            <div className="truncate font-mono text-[10px] text-slate-400" title={deviceInfo || ""}>{deviceInfo || "—"}</div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4 text-[11px] text-slate-500">
          <span>会话 <strong className="text-slate-800">{summary.sessions.length}</strong></span>
          <span className="h-3 w-px bg-slate-200" />
          <span>日志 <strong className="text-slate-800">{summary.totals.logs.toLocaleString()}</strong></span>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          const badge = t.id === "fault" && summary.totals.anomalies > 0 ? summary.totals.anomalies : null;
          return (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-[13px] font-bold transition-all ${active ? "bg-gradient-to-r from-violet-50 to-fuchsia-50/40 text-violet-700 shadow-[inset_0_0_0_1px_rgba(167,139,250,0.3)]" : "text-slate-600 hover:bg-slate-50"}`}>
              <Icon className={`h-[18px] w-[18px] ${active ? "text-violet-600" : "text-slate-400"}`} />
              {t.name}
              {badge && (
                <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-rose-500 text-white" : "bg-rose-50 text-rose-600"}`}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="border-t border-slate-100 p-3">
        <button onClick={onReset} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50">
          <X className="h-3.5 w-3.5" /> 重新导入
        </button>
      </div>
    </aside>
  );
}

/* ============================================================
   Dashboard
   ============================================================ */

function fmtMs(ms) {
  if (!ms || ms < 0) return "—";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s - m * 60);
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m - h * 60}m`;
}
function fmtTime(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
}

function DashboardPanel({ summary, logs }) {
  const totalDuration = summary.sessions.reduce((a, s) => a + (s.endTime - s.startTime), 0);
  const totalAnomalies = summary.totals.anomalies;
  const levelTotals = summary.sessions.reduce((acc, s) => {
    Object.keys(s.levelCounts).forEach(k => { acc[k] = (acc[k] || 0) + s.levelCounts[k]; });
    return acc;
  }, {});
  const levelData = ["DEBUG", "INFO", "WARNING", "ERROR"].map(l => ({ level: l, count: levelTotals[l] || 0 }));
  const levelColor = { DEBUG: "#94a3b8", INFO: "#3b82f6", WARNING: "#f59e0b", ERROR: "#ef4444" };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:gap-5">
        <StatCard label="日志会话" value={summary.sessions.length} accent="violet" />
        <StatCard label="累计时长" value={fmtMs(totalDuration)} accent="blue" />
        <StatCard label="异常事件" value={totalAnomalies.toLocaleString()} accent={totalAnomalies > 0 ? "rose" : "emerald"} />
        <StatCard label="日志总条数" value={summary.totals.logs.toLocaleString()} accent="amber" />
      </div>

      <Card>
        <SectionTitle>日志级别分布</SectionTitle>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={levelData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="level" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", boxShadow: "0 10px 30px -10px rgba(15,23,42,0.12)" }} />
            <Bar dataKey="count" radius={[8, 8, 0, 0]}>
              {levelData.map((d, i) => <Cell key={i} fill={levelColor[d.level]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card padding="p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <SectionTitle noMargin>会话列表</SectionTitle>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">{summary.sessions.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2.5">#</th>
                <th className="px-4 py-2.5">文件</th>
                <th className="px-4 py-2.5">起止时间</th>
                <th className="px-4 py-2.5">时长</th>
                <th className="px-4 py-2.5">日志</th>
                <th className="px-4 py-2.5">异常</th>
                <th className="px-4 py-2.5">平均节拍</th>
              </tr>
            </thead>
            <tbody>
              {summary.sessions.map(s => (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50/40">
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">#{s.id + 1}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-700 break-all">{s.fileName}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-slate-500">
                    {fmtTime(s.startTime)}<br />
                    <span className="text-slate-400">↓ {fmtTime(s.endTime)}</span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-700">{fmtMs(s.endTime - s.startTime)}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-700">{s.logCount.toLocaleString()}</td>
                  <td className="px-4 py-2">
                    {s.anomalyCount > 0
                      ? <span className="rounded bg-rose-50 px-2 py-0.5 font-mono text-xs font-bold text-rose-700">{s.anomalyCount}</span>
                      : <span className="text-xs text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-700">
                    {s.cycleAvg > 0 ? `${s.cycleAvg.toFixed(2)}s` : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ============================================================
   Fault Localization
   ============================================================ */

function FaultPanel({ summary, logs }) {
  const [catFilter, setCatFilter] = useState("");
  const [sevFilter, setSevFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [selectedRule, setSelectedRule] = useState(null);

  const clusters = summary.anomalyClusters.map(c => ({
    ...c,
    rule: RULE_BY_ID[c.ruleId] || { name: c.ruleId, category: "other", severity: "info", description: "" },
  }));
  // Sort by max log level severity then by count, so ERROR clusters surface first
  const LEVEL_RANK = { ERROR: 4, CRITICAL: 4, FATAL: 4, WARNING: 3, INFO: 2, DEBUG: 1 };
  const topLevel = (lvls) => Math.max(0, ...Object.keys(lvls || {}).map(k => LEVEL_RANK[k] || 0));
  clusters.sort((a, b) => (topLevel(b.levels) - topLevel(a.levels)) || (b.count - a.count));

  const filtered = clusters.filter(c => {
    if (catFilter && c.rule.category !== catFilter) return false;
    if (sevFilter && c.rule.severity !== sevFilter) return false;
    if (levelFilter && !(c.levels || {})[levelFilter]) return false;
    return true;
  });

  // Group displayed clusters by their dominant level
  const groupedByLevel = useMemo(() => {
    const groups = { ERROR: [], WARNING: [], INFO: [], DEBUG: [] };
    filtered.forEach(c => {
      const lvls = c.levels || {};
      const dominant = Object.entries(lvls).sort((a, b) => b[1] - a[1])[0]?.[0] || "INFO";
      const key = ["ERROR", "CRITICAL", "FATAL"].includes(dominant) ? "ERROR" : (groups[dominant] ? dominant : "INFO");
      groups[key].push(c);
    });
    return groups;
  }, [filtered]);

  // Pick context for selected rule's most recent occurrence
  const contextLogs = useMemo(() => {
    if (!selectedRule) return [];
    const cluster = clusters.find(c => c.ruleId === selectedRule);
    if (!cluster || !cluster.samples.length) return [];
    const lastSample = cluster.samples[cluster.samples.length - 1];
    const targetIdx = lastSample.logId;
    const start = Math.max(0, targetIdx - 15);
    const end = Math.min(logs.length, targetIdx + 6);
    return logs.slice(start, end).map(l => ({ ...l, highlighted: l.id === targetIdx }));
  }, [selectedRule, clusters, logs]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Filter className="h-4 w-4 text-slate-400" />
          <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-violet-500">
            <option value="">全部日志等级</option>
            <option value="ERROR">ERROR</option>
            <option value="WARNING">WARNING</option>
            <option value="INFO">INFO</option>
            <option value="DEBUG">DEBUG</option>
          </select>
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-violet-500">
            <option value="">全部分类</option>
            {Object.entries(CATEGORY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={sevFilter} onChange={e => setSevFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-violet-500">
            <option value="">全部严重度</option>
            {Object.entries(SEVERITY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <div className="ml-auto text-xs text-slate-500">{filtered.length} / {clusters.length} 类异常</div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card><div className="py-10 text-center text-sm text-slate-400">无匹配异常事件</div></Card>
      ) : (
        <div className="space-y-5">
          {["ERROR", "WARNING", "INFO", "DEBUG"].map(lvl => {
            const list = groupedByLevel[lvl];
            if (!list || list.length === 0) return null;
            return (
              <div key={lvl}>
                <div className="mb-2 flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 font-mono text-[11px] font-bold ${LEVEL_COLOR[lvl]}`}>{lvl}</span>
                  <span className="text-xs font-bold text-slate-600">日志等级</span>
                  <span className="text-xs text-slate-400">{list.length} 类 / {list.reduce((a, c) => a + c.count, 0)} 次</span>
                </div>
                <div className="space-y-2">
                  {list.map(c => (
                    <AnomalyCluster key={c.ruleId} cluster={c}
                      expanded={selectedRule === c.ruleId}
                      onToggle={() => setSelectedRule(s => s === c.ruleId ? null : c.ruleId)}
                      contextLogs={selectedRule === c.ruleId ? contextLogs : []} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AnomalyCluster({ cluster, expanded, onToggle, contextLogs }) {
  const r = cluster.rule;
  const catMeta = CATEGORY_META[r.category] || CATEGORY_META.other;
  const sevMeta = SEVERITY_META[r.severity] || SEVERITY_META.info;
  const levelEntries = Object.entries(cluster.levels || {}).sort((a, b) => b[1] - a[1]);
  return (
    <Card padding="p-0">
      <button onClick={onToggle} className="flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-slate-50/40">
        <div className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border ${SEVERITY_TONE[r.severity]}`}>
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-base font-bold text-slate-900">{r.name}</span>
            {levelEntries.map(([lev, n]) => (
              <span key={lev} className={`rounded px-1.5 py-0 font-mono text-[10px] font-bold ${LEVEL_COLOR[lev] || "bg-slate-100 text-slate-600"}`}>
                {lev} × {n}
              </span>
            ))}
            <span className={`rounded-md border px-1.5 py-0 text-[10px] font-bold ${COLOR_CHIP[catMeta.color]}`}>{catMeta.label}</span>
            <span className="font-mono text-xs text-slate-500">×{cluster.count}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">{r.description}</div>
          <div className="mt-2 flex flex-wrap gap-3 font-mono text-[11px] text-slate-500">
            <span>首次 {fmtTime(cluster.firstTime)}</span>
            <span>· 末次 {fmtTime(cluster.lastTime)}</span>
            <span>· 涉及会话 {Array.from(new Set(cluster.sessions)).map(i => `#${i + 1}`).join(", ")}</span>
          </div>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
      </button>
      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">最近一次发生前后的日志</div>
          <pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-slate-200">
            {contextLogs.length === 0 ? "无上下文" : contextLogs.map((l, i) => (
              <div key={i} className={l.highlighted ? "rounded bg-rose-600/30 px-1 text-rose-100" : "text-slate-300"}>
                <span className="text-slate-500">[{l.t}]</span>
                <span className={l.l === "WARNING" ? "text-amber-400" : l.l === "ERROR" ? "text-rose-400" : "text-slate-500"}> [{l.l}]</span>
                {" "}{l.m.split("\n")[0]}
              </div>
            ))}
          </pre>
        </div>
      )}
    </Card>
  );
}

/* ============================================================
   State Transitions
   ============================================================ */

function StatesPanel({ summary, logs }) {
  const [view, setView] = useState("node");   // "node" | "system"
  const [q, setQ] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [limit, setLimit] = useState(500);
  const [expandedId, setExpandedId] = useState(null);

  // Merge all state transitions + plan entries across sessions, sorted by time.
  // Node-level view shows PT_TRANSITION + plan entry markers.
  // System-level view shows only "Transit system state" lines.
  const allEvents = useMemo(() => {
    const all = [];
    summary.sessionDetails.forEach((d, sessionId) => {
      d.stateTimeline.forEach(s => all.push({
        kind: s.kind || "node",
        from: s.from, to: s.to,
        time: s.time, timeStr: s.timeStr, logId: s.logId, sessionId,
      }));
      d.planEntries.forEach(p => all.push({
        kind: "enter_plan", plan: p.plan,
        time: p.time, timeStr: p.timeStr, logId: p.logId, sessionId,
      }));
    });
    all.sort((a, b) => a.time - b.time);

    // Attach trigger conditions for transitions
    return all.map(ev => {
      if (ev.kind !== "node" && ev.kind !== "system") return ev;
      const triggers = [];
      for (let k = ev.logId - 1; k >= Math.max(0, ev.logId - 8); k--) {
        const L = logs[k];
        if (!L) break;
        if (L.m.includes("transition triggered")) {
          const t = L.m.replace(/^\[CPrimitivePlan[^\]]*\]\s*/, "").trim();
          triggers.unshift(t);
        } else break;
      }
      return { ...ev, triggers };
    });
  }, [summary, logs]);

  // Slice by current view
  const events = useMemo(() => {
    if (view === "system") return allEvents.filter(e => e.kind === "system");
    // node view: include node transitions + plan entries
    return allEvents.filter(e => e.kind === "node" || e.kind === "enter_plan");
  }, [allEvents, view]);

  // Plan associations only meaningful in node view
  const enriched = useMemo(() => {
    if (view !== "node") return events.map(e => ({ ...e, plan: "" }));
    let curPlan = "";
    return events.map(ev => {
      if (ev.kind === "enter_plan") { curPlan = ev.plan; return { ...ev, plan: curPlan }; }
      return { ...ev, plan: curPlan };
    });
  }, [events, view]);

  const plans = useMemo(() => Array.from(new Set(enriched.map(e => e.plan).filter(Boolean))).sort(), [enriched]);

  const filtered = useMemo(() => {
    const lc = q.toLowerCase();
    const out = [];
    for (const ev of enriched) {
      if (planFilter && ev.plan !== planFilter) continue;
      if (lc) {
        const hay = ev.kind === "enter_plan"
          ? `entered plan ${ev.plan}`
          : `${ev.from} ${ev.to} ${ev.triggers?.join(" ") || ""}`;
        if (!hay.toLowerCase().includes(lc)) continue;
      }
      out.push(ev);
      if (out.length >= limit) break;
    }
    return out;
  }, [enriched, q, planFilter, limit]);

  const nodeTotal = allEvents.filter(e => e.kind === "node").length;
  const sysTotal = allEvents.filter(e => e.kind === "system").length;
  const entryTotal = allEvents.filter(e => e.kind === "enter_plan").length;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:gap-5">
        <StatCard label="节点切换" value={nodeTotal.toLocaleString()} accent="violet" />
        <StatCard label="系统切换" value={sysTotal.toLocaleString()} accent="rose" />
        <StatCard label="进入计划次数" value={entryTotal.toLocaleString()} accent="blue" />
        <StatCard label={view === "node" ? "涉及计划" : "当前显示"} value={view === "node" ? plans.length : `${filtered.length} / ${enriched.length}`} accent="emerald" />
      </div>

      <Card padding="p-0">
        {/* Table header: segmented view toggle + filters */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
          <div className="inline-flex rounded-xl bg-slate-100/80 p-1">
            <button onClick={() => { setView("node"); setExpandedId(null); }}
              className={`rounded-lg px-3.5 py-1.5 text-[13px] font-bold transition-all ${view === "node" ? "bg-white text-violet-700 shadow-[0_1px_3px_rgba(15,23,42,0.08)]" : "text-slate-500 hover:text-slate-800"}`}>
              节点状态切换 <span className="ml-1 font-mono text-[11px] opacity-70">{nodeTotal}</span>
            </button>
            <button onClick={() => { setView("system"); setExpandedId(null); }}
              className={`rounded-lg px-3.5 py-1.5 text-[13px] font-bold transition-all ${view === "system" ? "bg-white text-violet-700 shadow-[0_1px_3px_rgba(15,23,42,0.08)]" : "text-slate-500 hover:text-slate-800"}`}>
              系统状态切换 <span className="ml-1 font-mono text-[11px] opacity-70">{sysTotal}</span>
            </button>
          </div>
          <div className="relative max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索 from / to / 触发条件…"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-[13px] shadow-sm outline-none placeholder:text-slate-300 focus:border-violet-500" />
          </div>
          {view === "node" && (
            <select value={planFilter} onChange={e => setPlanFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] shadow-sm outline-none focus:border-violet-500">
              <option value="">全部计划</option>
              {plans.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          <select value={limit} onChange={e => setLimit(+e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] shadow-sm outline-none focus:border-violet-500">
            <option value={500}>显示 500</option>
            <option value={2000}>显示 2000</option>
            <option value={10000}>显示 10000</option>
          </select>
        </div>

        <div className="max-h-[calc(100vh-260px)] overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2.5 w-48">时间</th>
                {view === "node" && <th className="px-4 py-2.5 w-44">所属计划</th>}
                <th className="px-4 py-2.5">状态切换</th>
                <th className="px-4 py-2.5 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(ev => (
                <StateRow key={`${ev.kind}-${ev.logId}`} ev={ev} view={view}
                  expanded={expandedId === `${ev.kind}-${ev.logId}`}
                  onToggle={() => setExpandedId(x => x === `${ev.kind}-${ev.logId}` ? null : `${ev.kind}-${ev.logId}`)} />
              ))}
            </tbody>
          </table>
          {!filtered.length && <div className="px-4 py-10 text-center text-sm text-slate-400">无匹配状态切换</div>}
        </div>
      </Card>
    </div>
  );
}

function StateRow({ ev, view, expanded, onToggle }) {
  const isEnter = ev.kind === "enter_plan";
  const isSystem = ev.kind === "system";
  const hasTriggers = ev.triggers && ev.triggers.length > 0;
  return (
    <>
      <tr onClick={onToggle}
          className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50/40 ${isEnter ? "bg-blue-50/30" : isSystem ? "bg-rose-50/20" : ""}`}>
        <td className="px-4 py-2.5 font-mono text-[12px] text-slate-600 whitespace-nowrap">{ev.timeStr}</td>
        {view === "node" && (
          <td className="px-4 py-2.5 font-mono text-[12px] text-slate-500">{ev.plan || <span className="text-slate-300">—</span>}</td>
        )}
        <td className="px-4 py-2.5">
          {isEnter ? (
            <div className="flex items-center gap-2">
              <span className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-blue-700">ENTER</span>
              <span className="font-mono text-[13px] font-bold text-slate-800">{ev.plan}</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {isSystem && <span className="rounded bg-rose-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-rose-700">SYS</span>}
              <span className="font-mono text-[13px] font-bold text-slate-700">{ev.from}</span>
              <ArrowRight className={`h-4 w-4 ${isSystem ? "text-rose-500" : "text-violet-500"}`} />
              <span className={`font-mono text-[13px] font-bold ${isSystem ? "text-rose-700" : "text-violet-700"}`}>{ev.to}</span>
              {hasTriggers && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">{ev.triggers.length} 触发</span>
              )}
            </div>
          )}
        </td>
        <td className="px-4 py-2.5 text-right">
          {hasTriggers && (expanded ? <ChevronDown className="h-4 w-4 text-slate-400 inline" /> : <ChevronRight className="h-4 w-4 text-slate-400 inline" />)}
        </td>
      </tr>
      {expanded && hasTriggers && (
        <tr>
          <td colSpan={view === "node" ? 4 : 3} className="bg-slate-50/60 px-4 py-3 border-t border-slate-100">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">触发条件</div>
            <div className="space-y-1">
              {ev.triggers.map((t, i) => (
                <div key={i} className="font-mono text-[12px] text-slate-700 break-all">
                  <span className="text-slate-400">›</span> {t}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ============================================================
   Performance
   ============================================================ */

const GROUP_CFG = {
  init:    { icon: "🚀", label: "初始化",   bar: "bg-slate-400",   text: "text-slate-700",   border: "border-slate-200",  bg: "bg-slate-50/60"   },
  loop:    { icon: "🔄", label: "循环",     bar: "bg-blue-500",    text: "text-blue-700",    border: "border-blue-200",   bg: "bg-blue-50/40"    },
  tail:    { icon: "⚠️", label: "尾部异常", bar: "bg-orange-500",  text: "text-orange-700",  border: "border-orange-200", bg: "bg-orange-50/40"  },
  cleanup: { icon: "🧹", label: "清理阶段", bar: "bg-emerald-500", text: "text-emerald-700", border: "border-emerald-200",bg: "bg-emerald-50/40" },
  all:     { icon: "📋", label: "完整序列", bar: "bg-violet-500",  text: "text-violet-700",  border: "border-violet-200", bg: "bg-violet-50/40"  },
};

function PerformancePanel({ summary }) {
  const [selectedPlan, setSelectedPlan] = useState(null);
  // ------------------------------------------------------------
  // Aggregate raw data across all sessions (content-driven)
  // ------------------------------------------------------------
  const agg = useMemo(() => {
    const planExecutions = [];   // from "====== Plan [X] Time Log =====" blocks
    const trajectoryPlans = [];
    const primitiveLoops = [];
    summary.sessionDetails.forEach(d => {
      planExecutions.push(...d.planExecutions);
      trajectoryPlans.push(...d.trajectoryPlans);
      primitiveLoops.push(...d.primitiveLoops);
    });
    // chronological order
    planExecutions.sort((a, b) => a.time - b.time);
    trajectoryPlans.sort((a, b) => a.time - b.time);
    primitiveLoops.sort((a, b) => a.time - b.time);
    return { planExecutions, trajectoryPlans, primitiveLoops };
  }, [summary]);

  // ------------------------------------------------------------
  // Group Plan Time Log executions by plan name (in time order).
  // Each block = one execution; repeated occurrences of the same plan
  // accumulate into a single record with N executions.
  // For each execution, detect inner node-level cycles -> init / loop / cleanup groups.
  // ------------------------------------------------------------
  const planGroups = useMemo(() => {
    const byPlan = {};
    let order = 0;
    agg.planExecutions.forEach(p => {
      if (!byPlan[p.plan]) {
        byPlan[p.plan] = { plan: p.plan, executions: [], nodeMap: {}, firstSeenOrder: order++ };
      }
      byPlan[p.plan].executions.push({
        time: p.time, timeStr: p.timeStr,
        total: p.total, nodes: p.nodes, logId: p.logId,
        groups: splitNodeCycles(p.nodes),
      });
      p.nodes.forEach(n => {
        if (!byPlan[p.plan].nodeMap[n.node]) byPlan[p.plan].nodeMap[n.node] = [];
        byPlan[p.plan].nodeMap[n.node].push(n.time);
      });
    });
    return Object.values(byPlan).map(p => {
      const totals = p.executions.map(e => e.total).filter(Number.isFinite);
      const nodeStats = Object.entries(p.nodeMap).map(([node, ts]) => ({
        node, count: ts.length,
        avg: ts.reduce((a, x) => a + x, 0) / ts.length,
        max: Math.max(...ts), min: Math.min(...ts),
        total: ts.reduce((a, x) => a + x, 0),
      })).sort((a, b) => b.avg - a.avg);
      const totalTimeSum = totals.reduce((a, x) => a + x, 0);
      const cyclesFound = p.executions.reduce((a, e) => a + e.groups.filter(g => g.type === "loop").length, 0);
      return {
        ...p,
        count: p.executions.length,
        totalTimeSum,
        cyclesFound,
        cycleAvg: totals.length ? totalTimeSum / totals.length : 0,
        cycleMax: totals.length ? Math.max(...totals) : 0,
        cycleMin: totals.length ? Math.min(...totals) : 0,
        nodeStats,
        bottleneck: nodeStats[0] || null,
      };
    }).sort((a, b) => b.count - a.count);  // sort by execution count descending
  }, [agg]);

  // Top 10 slowest nodes across all plans (avg time, with plan attribution)
  const topSlowNodes = useMemo(() => {
    const all = [];
    planGroups.forEach(p => p.nodeStats.forEach(n => all.push({ plan: p.plan, ...n })));
    return all.sort((a, b) => b.avg - a.avg).slice(0, 10);
  }, [planGroups]);

  const totalExecCount = planGroups.reduce((a, p) => a + p.count, 0);
  const globalCycleAvg = useMemo(() => {
    const totals = agg.planExecutions.map(p => p.total).filter(Number.isFinite);
    return totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
  }, [agg]);
  const globalCycleMax = useMemo(() => {
    const totals = agg.planExecutions.map(p => p.total).filter(Number.isFinite);
    return totals.length ? Math.max(...totals) : 0;
  }, [agg]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:gap-5">
        <StatCard label="执行总次数" value={totalExecCount.toLocaleString()} accent="violet" />
        <StatCard label="平均节拍" value={globalCycleAvg > 0 ? `${globalCycleAvg.toFixed(2)}s` : "—"} accent="blue" />
        <StatCard label="最大节拍" value={globalCycleMax > 0 ? `${globalCycleMax.toFixed(2)}s` : "—"} accent="amber" />
        <StatCard label="控制循环超时" value={agg.primitiveLoops.length.toLocaleString()} accent={agg.primitiveLoops.length > 0 ? "rose" : "emerald"} />
      </div>

      <Card padding="p-0">
        <div className="border-b border-slate-100 px-6 py-4">
          <SectionTitle noMargin>各 Plan 执行统计</SectionTitle>
        </div>
        {planGroups.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">无 Plan Time Log 数据</div>
        ) : (
          <div className="grid grid-cols-12">
            <div className="col-span-12 border-b border-slate-100 lg:col-span-3 lg:border-b-0 lg:border-r">
              <PlanListPanel
                plans={planGroups}
                selected={selectedPlan || planGroups[0]?.plan}
                onSelect={setSelectedPlan}
              />
            </div>
            <div className="col-span-12 lg:col-span-9">
              <PlanDetailPanel
                plan={planGroups.find(p => p.plan === (selectedPlan || planGroups[0]?.plan)) || planGroups[0]}
              />
            </div>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>Top 10 耗时节点（含计划归属）</SectionTitle>
        {topSlowNodes.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">无节点耗时数据</div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, topSlowNodes.length * 32)}>
            <BarChart data={topSlowNodes} layout="vertical" margin={{ left: 150, right: 60, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} unit="s" />
              <YAxis type="category" dataKey="node" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} width={140}
                tickFormatter={(v, i) => { const r = topSlowNodes[i]; return r ? `${r.plan} / ${v}` : v; }} />
              <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0" }}
                formatter={(v) => `${v.toFixed(3)}s`}
                labelFormatter={(label, payload) => payload?.[0] ? `${payload[0].payload.plan} / ${label}` : label} />
              <Bar dataKey="avg" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card>
        <SectionTitle>轨迹规划耗时分布</SectionTitle>
        {agg.trajectoryPlans.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">无规划数据</div>
        ) : (
          <TrajectoryHistogram data={agg.trajectoryPlans} />
        )}
      </Card>

      {agg.primitiveLoops.length > 0 && (
        <Card>
          <SectionTitle>控制循环抖动（超时记录）</SectionTitle>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={agg.primitiveLoops} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="time" tickFormatter={(v) => new Date(v).toLocaleTimeString("zh-CN", { hour12: false })} stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} unit="ms" />
              <ReferenceLine y={1} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "1ms 阈值", fill: "#ef4444", fontSize: 10 }} />
              <Tooltip labelFormatter={(v) => new Date(v).toLocaleString("zh-CN", { hour12: false })}
                contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0" }} formatter={(v) => `${v.toFixed(3)} ms`} />
              <Line type="monotone" dataKey="cost" stroke="#f59e0b" strokeWidth={1.5} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}

/* ---------- helpers: cycle splitting within one execution ---------- */

// Adapted from BeatAnalyzer.splitCyclesAuto — find best repeating anchor
// in a node sequence and split into init / loop[i] / cleanup groups.
function splitNodeCycles(nodes) {
  if (!nodes || nodes.length === 0) return [];
  const posMap = {};
  nodes.forEach((n, i) => {
    if (!posMap[n.node]) posMap[n.node] = [];
    posMap[n.node].push(i);
  });

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
      for (let j = 0; j < cl; j++) if (s1[j].node === s2[j].node) matches++;
      simScore += s1.length > 0 ? matches / s1.length : 0;
      simCount++;
    }
    const avgSim = simCount > 0 ? simScore / simCount : 0;
    const score = positions.length * stability * lengthScore * avgSim ** 2;
    if (score > bestScore) { bestScore = score; bestNode = name; bestPattern = { positions, avgInterval: avg, avgSim }; }
  });

  if (!bestNode || !bestPattern || bestScore < 0.1) {
    return [{ type: "all", nodes, total: nodes.reduce((a, b) => a + b.time, 0) }];
  }

  // Pull cycle starts backward if leading context is identical
  let b = [...bestPattern.positions], maxShift = 0;
  while (true) {
    const shift = maxShift + 1;
    if (b[0] - shift < 0) break;
    const refNode = nodes[b[0] - shift].node;
    if (b.every((pos, i) => b[i] - shift >= 0 && nodes[b[i] - shift].node === refNode)) maxShift = shift;
    else break;
  }
  b = b.map(x => x - maxShift);

  const groups = [];
  if (b[0] > 0) {
    const init = nodes.slice(0, b[0]);
    groups.push({ type: "init", nodes: init, total: init.reduce((a, x) => a + x.time, 0) });
  }
  let loopIdx = 1;
  for (let i = 0; i < b.length - 1; i++) {
    const slice = nodes.slice(b[i], b[i + 1]);
    groups.push({ type: "loop", index: loopIdx++, nodes: slice, total: slice.reduce((a, x) => a + x.time, 0), trigger: bestNode });
  }
  const lastPos = b[b.length - 1];
  if (lastPos < nodes.length) {
    const tail = nodes.slice(lastPos);
    groups.push({ type: tail.some(n => n.node === bestNode) ? "tail" : "cleanup",
                  nodes: tail, total: tail.reduce((a, x) => a + x.time, 0) });
  }
  return groups;
}

// Deterministic color per node name (HSL hash). Same node = same color everywhere.
function colorForNode(name) {
  if (!name) return "#cbd5e1";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  // slightly vary lightness by length so similar names don't blend
  return `hsl(${hue}, 62%, 58%)`;
}


function PlanListPanel({ plans, selected, onSelect }) {
  return (
    <div className="max-h-[700px] overflow-y-auto">
      <ul>
        {plans.map(p => {
          const active = p.plan === selected;
          const hasIssue = p.cycleMax > p.cycleAvg * 1.5 && p.count > 2;  // outlier alert
          return (
            <li key={p.plan}>
              <button onClick={() => onSelect(p.plan)}
                className={`flex w-full flex-col gap-1 border-l-4 px-4 py-3 text-left transition-colors ${active ? "border-violet-500 bg-violet-50/60" : "border-transparent hover:bg-slate-50"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`truncate font-mono text-sm font-bold ${active ? "text-violet-800" : "text-slate-800"}`} title={p.plan}>
                    {p.plan}
                  </span>
                  <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-violet-200 text-violet-800" : "bg-slate-100 text-slate-600"}`}>
                    {p.count} 次
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {p.totalTimeSum.toFixed(3)}s
                  </span>
                  {hasIssue && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" title="存在异常长执行" />}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PlanDetailPanel({ plan }) {
  const [expanded, setExpanded] = useState(new Set([0]));   // first execution open by default
  if (!plan) return <div className="p-6 text-center text-sm text-slate-400">请选择左侧 Plan</div>;

  const toggle = (i) => setExpanded(s => {
    const next = new Set(s);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  // global max total — used to scale outer bar of each execution
  const globalMax = Math.max(...plan.executions.map(e => e.total), 0.001);

  return (
    <div className="max-h-[700px] overflow-y-auto">
      {/* Plan header */}
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 backdrop-blur px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-base font-bold text-slate-900">{plan.plan}</span>
          <span className="rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-bold text-violet-700">
            ×{plan.count} 次执行
          </span>
          {plan.cyclesFound > 0 && (
            <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
              共检测到 {plan.cyclesFound} 个内部循环
            </span>
          )}
          {plan.cycleAvg > 0 && (
            <span className="font-mono text-xs text-slate-500">
              avg <strong className="text-slate-700">{plan.cycleAvg.toFixed(3)}s</strong>
              {" · max "}<strong className="text-amber-700">{plan.cycleMax.toFixed(3)}s</strong>
              {" · min "}<strong className="text-emerald-700">{plan.cycleMin.toFixed(3)}s</strong>
            </span>
          )}
        </div>
        {plan.bottleneck && (
          <div className="mt-1 text-[11px] text-slate-500">
            瓶颈 <code className="rounded bg-slate-100 px-1 font-mono text-slate-700">{plan.bottleneck.node}</code>
            {" "}avg {plan.bottleneck.avg.toFixed(3)}s
          </div>
        )}
      </div>

      {/* Execution rows */}
      <div className="divide-y divide-slate-100">
        {plan.executions.map((e, i) => (
          <ExecutionRow key={i} index={i} exec={e} globalMax={globalMax}
            expanded={expanded.has(i)} onToggle={() => toggle(i)} />
        ))}
      </div>
    </div>
  );
}

function ExecutionRow({ index, exec, globalMax, expanded, onToggle }) {
  const loops = exec.groups.filter(g => g.type === "loop");
  const loopTotals = loops.map(g => g.total);
  const loopAvg = loopTotals.length ? loopTotals.reduce((a, b) => a + b, 0) / loopTotals.length : 0;
  const loopMax = loopTotals.length ? Math.max(...loopTotals) : 0;
  const widthPct = (exec.total / globalMax) * 100;
  const isPeak = exec.total >= globalMax * 0.95;

  return (
    <div>
      <button onClick={onToggle} className="flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-slate-50/40">
        <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg font-mono text-[11px] font-bold ${expanded ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}>
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-bold text-slate-800">运行记录 #{index + 1}</span>
            {loops.length > 0 && (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 ring-1 ring-blue-200">
                发现 {loops.length} 个循环
              </span>
            )}
            <span className="font-mono text-[11px] text-slate-500">{exec.timeStr}</span>
          </div>
          {!expanded && (
            <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-slate-100" title={`${exec.total.toFixed(3)}s`}>
              <div style={{ width: `${widthPct}%` }} className={`${isPeak ? "bg-rose-400" : "bg-violet-400"}`} />
            </div>
          )}
        </div>
        <div className="hidden md:flex flex-col items-end gap-0.5 font-mono text-[10px] text-slate-500">
          {loops.length > 0 && (
            <>
              <span>均值: {loopAvg.toFixed(3)}s</span>
              <span>最大: {loopMax.toFixed(3)}s</span>
            </>
          )}
        </div>
        <span className={`font-mono text-sm font-bold tabular-nums ${isPeak ? "text-rose-600" : "text-slate-800"}`}>
          {exec.total.toFixed(3)}s
        </span>
        {expanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-slate-100 bg-slate-50/30 px-5 py-3">
          {exec.groups.map((g, gi) => <GroupRow key={gi} group={g} execTotal={exec.total} />)}
        </div>
      )}
    </div>
  );
}

function GroupRow({ group, execTotal }) {
  const cfg = GROUP_CFG[group.type] || GROUP_CFG.all;
  const pct = execTotal > 0 ? (group.total / execTotal) * 100 : 0;
  return (
    <div className={`rounded-xl border ${cfg.border} ${cfg.bg} overflow-hidden`}>
      {/* Group header */}
      <div className="flex items-center gap-3 border-b border-white/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-base">{cfg.icon}</span>
          <span className={`text-sm font-bold ${cfg.text}`}>
            {cfg.label}{group.type === "loop" ? ` ${group.index}` : ""}
          </span>
          {group.trigger && (
            <span className="rounded bg-white/70 px-1.5 py-0 font-mono text-[10px] text-slate-600">
              Trigger: {group.trigger}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/60">
              <div className={`h-full rounded-full ${cfg.bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <span className="font-mono text-[10px] text-slate-500 w-10 text-right">{pct.toFixed(1)}%</span>
          </div>
          <span className={`rounded bg-white px-2 py-0.5 font-mono text-xs font-bold shadow-sm ${cfg.text}`}>
            {group.total.toFixed(3)}s
          </span>
        </div>
      </div>

      {/* Stacked node bar */}
      <div className="px-3 pt-2.5 pb-1">
        <div className="flex h-5 w-full overflow-hidden rounded ring-1 ring-slate-200">
          {group.nodes.map((n, ni) => {
            const w = group.total > 0 ? (n.time / group.total) * 100 : 0;
            return (
              <div key={ni}
                style={{ width: `${w}%`, background: colorForNode(n.node) }}
                title={`${n.node}: ${n.time.toFixed(3)}s (${w.toFixed(1)}%)`}
                className="transition-opacity hover:brightness-110"
              />
            );
          })}
        </div>
      </div>

      {/* Node chips */}
      <div className="flex flex-wrap gap-1.5 px-3 pb-3 pt-2">
        {group.nodes.map((n, ni) => (
          <span key={ni} className="inline-flex items-baseline gap-1.5 rounded border border-white bg-white/80 px-2 py-0.5 font-mono text-[10px] shadow-sm">
            <span className="h-2 w-2 rounded-sm flex-shrink-0" style={{ background: colorForNode(n.node) }} />
            <span className="font-bold text-slate-700">{n.node}</span>
            <span className="text-slate-500">{n.time.toFixed(3)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}


function TrajectoryHistogram({ data }) {
  // bin into 5 buckets by total time
  const max = Math.max(...data.map(d => d.total));
  const binCount = 12;
  const binSize = max / binCount || 1;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    range: `${(i * binSize).toFixed(0)}–${((i + 1) * binSize).toFixed(0)}ms`,
    count: 0,
  }));
  data.forEach(d => {
    const idx = Math.min(binCount - 1, Math.floor(d.total / binSize));
    bins[idx].count++;
  });
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={bins} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis dataKey="range" stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} interval={0} />
        <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0" }} />
        <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ============================================================
   Trend (cross-session)
   ============================================================ */

function TrendPanel({ summary, logs }) {
  // Auto-bucket: aim for ~40 buckets across full time span
  const trend = useMemo(() => {
    if (!logs.length) return null;
    const tStart = logs[0].t_ms;
    const tEnd = logs[logs.length - 1].t_ms;
    const span = tEnd - tStart;
    if (span <= 0) return null;
    // pick a "nice" bucket from a fixed set near span/40
    const candidates = [
      10_000, 30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000,
      15 * 60_000, 30 * 60_000, 60 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000,
    ];
    const target = span / 40;
    const bucketMs = candidates.find(c => c >= target) || candidates[candidates.length - 1];
    const bucketCount = Math.ceil(span / bucketMs) + 1;
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      t: tStart + i * bucketMs,
      cycleTotals: [],
      anomalies: 0,
      visionTimeout: 0,
      loopWarn: 0,
      tpSlow: 0,
    }));
    const bucketIdx = (t) => Math.min(bucketCount - 1, Math.floor((t - tStart) / bucketMs));

    // Aggregate cycle data from planExecutions
    summary.sessionDetails.forEach(d => {
      d.planExecutions.forEach(p => {
        if (Number.isFinite(p.total)) buckets[bucketIdx(p.time)].cycleTotals.push(p.total);
      });
    });
    // Aggregate anomalies from logs
    for (const l of logs) {
      if (!l.ruleId) continue;
      const b = buckets[bucketIdx(l.t_ms)];
      b.anomalies++;
      if (l.ruleId === "vision_tcp_timeout") b.visionTimeout++;
      if (l.ruleId === "primitive_loop_slow") b.loopWarn++;
      if (l.ruleId === "tp_planning_slow") b.tpSlow++;
    }

    return {
      bucketMs,
      data: buckets.map(b => {
        const totals = b.cycleTotals;
        return {
          t: b.t,
          cycleAvg: totals.length ? +(totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(3) : null,
          cycleMax: totals.length ? +Math.max(...totals).toFixed(3) : null,
          cycleCount: totals.length,
          anomalies: b.anomalies,
          visionTimeout: b.visionTimeout,
          loopWarn: b.loopWarn,
          tpSlow: b.tpSlow,
        };
      }),
    };
  }, [logs, summary]);

  if (!trend) {
    return (
      <div className="mx-auto max-w-6xl">
        <Card><div className="py-10 text-center text-sm text-slate-400">无足够数据生成趋势</div></Card>
      </div>
    );
  }

  const bucketLabel = (() => {
    const m = trend.bucketMs;
    if (m < 60_000) return `${m / 1000}s/桶`;
    if (m < 3_600_000) return `${m / 60_000}分钟/桶`;
    return `${m / 3_600_000}小时/桶`;
  })();
  const tickFmt = (t) => {
    const span = trend.data[trend.data.length - 1].t - trend.data[0].t;
    const d = new Date(t);
    if (span > 86_400_000) return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Card>
        <div className="flex items-center justify-between">
          <SectionTitle>节拍趋势（时间序列）</SectionTitle>
          <span className="text-[11px] text-slate-400">{bucketLabel}</span>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={trend.data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="t" tickFormatter={tickFmt} stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} type="number" domain={["dataMin", "dataMax"]} />
            <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} unit="s" />
            <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0" }}
              labelFormatter={(t) => fmtTime(t)}
              formatter={(v, k) => v == null ? "—" : `${v}${k === "cycleCount" ? " 次" : "s"}`} />
            <Line type="monotone" dataKey="cycleAvg" stroke="#3b82f6" strokeWidth={2} dot={false} name="平均节拍" connectNulls />
            <Line type="monotone" dataKey="cycleMax" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 4" name="最大节拍" connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <SectionTitle>异常密度趋势</SectionTitle>
          <span className="text-[11px] text-slate-400">{bucketLabel}</span>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={trend.data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="t" tickFormatter={tickFmt} stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} type="number" domain={["dataMin", "dataMax"]} />
            <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0" }} labelFormatter={(t) => fmtTime(t)} />
            <Line type="monotone" dataKey="anomalies"     stroke="#ef4444" strokeWidth={2} dot={false} name="总异常" />
            <Line type="monotone" dataKey="visionTimeout" stroke="#8b5cf6" strokeWidth={1.5} dot={false} name="视觉超时" />
            <Line type="monotone" dataKey="loopWarn"      stroke="#f59e0b" strokeWidth={1.5} dot={false} name="控制循环超时" />
            <Line type="monotone" dataKey="tpSlow"        stroke="#10b981" strokeWidth={1.5} dot={false} name="规划耗时偏高" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card>
        <SectionTitle>节拍样本密度</SectionTitle>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={trend.data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="t" tickFormatter={tickFmt} stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} type="number" domain={["dataMin", "dataMax"]} />
            <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0" }} labelFormatter={(t) => fmtTime(t)} />
            <Bar dataKey="cycleCount" fill="#a5b4fc" radius={[3, 3, 0, 0]} name="节拍次数" />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

/* ============================================================
   Raw Logs
   ============================================================ */

function RawLogPanel({ logs, sessions }) {
  const [q, setQ] = useState("");
  const [levelFilter, setLevelFilter] = useState("ALL");
  const [sessionFilter, setSessionFilter] = useState("");
  const [onlyAnomalies, setOnlyAnomalies] = useState(false);
  const [limit, setLimit] = useState(500);

  const filtered = useMemo(() => {
    const out = [];
    const lc = q.toLowerCase();
    for (let i = 0; i < logs.length; i++) {
      const l = logs[i];
      if (levelFilter !== "ALL" && l.l !== levelFilter) continue;
      if (sessionFilter !== "" && l.sessionId !== +sessionFilter) continue;
      if (onlyAnomalies && !l.ruleId) continue;
      if (lc && !l.m.toLowerCase().includes(lc)) continue;
      out.push(l);
      if (out.length >= limit) break;
    }
    return out;
  }, [logs, q, levelFilter, sessionFilter, onlyAnomalies, limit]);

  const levelColor = { DEBUG: "text-slate-500", INFO: "text-blue-600", WARNING: "text-amber-600", ERROR: "text-rose-600" };

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索消息…"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm outline-none placeholder:text-slate-300 focus:border-violet-500" />
          </div>
          <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-violet-500">
            <option value="ALL">全部级别</option>
            <option value="DEBUG">DEBUG</option><option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option><option value="ERROR">ERROR</option>
          </select>
          <select value={sessionFilter} onChange={e => setSessionFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-violet-500">
            <option value="">全部会话</option>
            {sessions.map(s => <option key={s.id} value={s.id}>#{s.id + 1} {s.fileName}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={onlyAnomalies} onChange={e => setOnlyAnomalies(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
            仅异常
          </label>
          <select value={limit} onChange={e => setLimit(+e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-violet-500">
            <option value={500}>显示 500</option>
            <option value={2000}>显示 2000</option>
            <option value={10000}>显示 10000</option>
          </select>
          <div className="ml-auto font-mono text-xs text-slate-500">{filtered.length} / {logs.length.toLocaleString()}</div>
        </div>
      </Card>

      <Card padding="p-0">
        <div className="max-h-[calc(100vh-280px)] overflow-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-slate-50/95 backdrop-blur text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 w-44">时间</th>
                <th className="px-2 py-2 w-16">级别</th>
                <th className="px-2 py-2 w-32">模块</th>
                <th className="px-3 py-2">消息</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {filtered.map(l => (
                <tr key={l.id} className={`border-t border-slate-100 hover:bg-slate-50/40 ${l.ruleId ? "bg-rose-50/30" : ""}`}>
                  <td className="px-3 py-1 text-[10px] text-slate-500 whitespace-nowrap">{l.t}</td>
                  <td className={`px-2 py-1 text-[10px] font-bold ${levelColor[l.l] || "text-slate-500"}`}>{l.l}</td>
                  <td className="px-2 py-1 text-[10px] text-slate-500 truncate" title={l.module}>{l.module}</td>
                  <td className="px-3 py-1 text-[11px] text-slate-700 break-all">
                    {l.ruleId && <span className="mr-2 rounded bg-rose-100 px-1 text-[9px] font-bold text-rose-700">{RULE_BY_ID[l.ruleId]?.name || l.ruleId}</span>}
                    {l.content.split("\n")[0]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <div className="px-4 py-10 text-center text-sm text-slate-400">无匹配日志</div>}
        </div>
      </Card>
    </div>
  );
}

/* ============================================================
   Atoms
   ============================================================ */

function Card({ children, padding = "p-6" }) {
  return (
    <div className={`rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)] ${padding}`}>
      {children}
    </div>
  );
}

function SectionTitle({ children, noMargin = false }) {
  return (
    <h3 className={`flex items-center gap-3 text-[15px] font-bold tracking-tight text-slate-900 ${noMargin ? "" : "mb-5"}`}>
      <span className="h-5 w-1 rounded-full bg-gradient-to-b from-violet-500 to-violet-600" />
      {children}
    </h3>
  );
}

const STAT_STYLES = {
  blue:    { grad: "from-blue-500/[0.07] via-white to-white",       accent: "text-blue-600",    bar: "bg-blue-500"    },
  violet:  { grad: "from-violet-500/[0.07] via-white to-white",     accent: "text-violet-600",  bar: "bg-violet-500"  },
  emerald: { grad: "from-emerald-500/[0.07] via-white to-white",    accent: "text-emerald-600", bar: "bg-emerald-500" },
  amber:   { grad: "from-amber-500/[0.07] via-white to-white",      accent: "text-amber-600",   bar: "bg-amber-500"   },
  rose:    { grad: "from-rose-500/[0.07] via-white to-white",       accent: "text-rose-600",    bar: "bg-rose-500"    },
  slate:   { grad: "from-slate-300/[0.07] via-white to-white",      accent: "text-slate-600",   bar: "bg-slate-400"   },
};

function StatCard({ label, value, accent = "blue" }) {
  const s = STAT_STYLES[accent] || STAT_STYLES.blue;
  return (
    <div className={`group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br ${s.grad} px-5 py-5 shadow-[0_1px_3px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_2px_8px_rgba(15,23,42,0.06),0_16px_32px_-12px_rgba(15,23,42,0.12)]`}>
      <span className={`absolute left-0 top-0 h-full w-1 ${s.bar} opacity-90`} />
      <div className="ml-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</div>
        <div className="mt-2.5 text-[28px] font-black leading-none tabular-nums text-slate-900">{value}</div>
      </div>
    </div>
  );
}
