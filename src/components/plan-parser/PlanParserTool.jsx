import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  FolderOpen, Upload, X, ChevronRight, ChevronDown, FileArchive, Folder,
  Cpu, Variable, Workflow, Info, AlertTriangle, Search, Activity, Boxes, ArrowRight
} from "lucide-react";
import JSZip from "jszip";
import { parseProtoText, asArray } from "./protoText";

/* ============================================================
   META
   ============================================================ */

const CATEGORY_META = {
  PROJ_VAR:     { label: "工程变量",  short: "工程",   color: "blue"    },
  GLOBAL_VAR:   { label: "全局变量",  short: "全局",   color: "emerald" },
  PLAN_VAR:     { label: "方案变量",  short: "方案",   color: "violet"  },
  GPIO_CMD:     { label: "GPIO 输出", short: "GPIO_O", color: "amber"   },
  GPIO_STATE:   { label: "GPIO 输入", short: "GPIO_I", color: "amber"   },
  DEVICE_CMD:   { label: "设备命令",  short: "设备_O", color: "rose"    },
  DEVICE_STATE: { label: "设备状态",  short: "设备_I", color: "rose"    },
  PT_INPUT:     { label: "节点输入",  short: "节点入", color: "slate"   },
  PT_STATE:     { label: "节点状态",  short: "节点态", color: "slate"   },
  SYS_STATE:    { label: "系统状态",  short: "系统",   color: "slate"   },
  CONST:        { label: "常量",      short: "常量",   color: "slate"   },
};

const NODE_TYPE_META = {
  PLAN:            { label: "子计划",        color: "blue"    },
  HOLD:            { label: "保持/等待",     color: "violet"  },
  MOVEL:           { label: "直线运动",      color: "blue"    },
  MOVEJ:           { label: "关节运动",      color: "blue"    },
  MOVE_COMPLIANCE: { label: "柔顺运动",      color: "blue"    },
  GOTO:            { label: "跳转",          color: "amber"   },
  CALIFORCESENSOR: { label: "力传感器清零",  color: "rose"    },
  CONTACT:         { label: "接触动作",      color: "rose"    },
  STOP:            { label: "停止",          color: "rose"    },
  END:             { label: "结束",          color: "slate"   },
  SYNCSTART:       { label: "同步开始",      color: "emerald" },
  SYNCHOLD:        { label: "同步保持",      color: "emerald" },
  SYNCEND:         { label: "同步结束",      color: "emerald" },
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

/* ============================================================
   PARSING
   ============================================================ */

function formatCondition(cond) {
  if (!cond || typeof cond !== "object") return "";
  const type = cond.condition_type;
  if (type === "AND" || type === "OR") {
    const subs = asArray(cond.trigger_condition).map(formatCondition).filter(Boolean);
    if (!subs.length) return "";
    return `(${subs.join(` ${type} `)})`;
  }
  if (type === "NO_CHECK") return "无条件";
  const opMap = { EQUAL: "==", NOT_EQUAL: "!=", GREATER: ">", LESS: "<", GREATER_EQUAL: ">=", LESS_EQUAL: "<=" };
  const op = opMap[type] || type || "?";
  const lhs = cond.lhs_param || {};
  const rhs = cond.rhs_param || {};
  const fmtSide = (p) => {
    if (!p || (!p.name && p.data === undefined)) return "?";
    if (p.category === "CONST") return String(p.data ?? "");
    if (p.module_name && p.module_name !== "rootNode") return `${p.module_name}.${p.name}`;
    return p.name || String(p.data ?? "?");
  };
  return `${fmtSide(lhs)} ${op} ${fmtSide(rhs)}`;
}

// Walk an AST subtree, return refs grouped by category.
// Returns: { [category]: [{ name, type, module_name }] } (deduped by name).
function extractRefs(node, acc = {}) {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node)) { node.forEach(n => extractRefs(n, acc)); return acc; }
  if (node.name && node.category && node.category !== "CONST") {
    const cat = node.category;
    if (!acc[cat]) acc[cat] = new Map();
    if (!acc[cat].has(node.name)) {
      acc[cat].set(node.name, { name: node.name, type: node.type || "", module_name: node.module_name || "" });
    }
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === "object") extractRefs(v, acc);
  }
  return acc;
}
function refsToObject(acc) {
  const out = {};
  Object.keys(acc).forEach(k => { out[k] = Array.from(acc[k].values()); });
  return out;
}

/**
 * Format one parameter (lhs or rhs of a param_assignment) for display.
 * @returns { text, category, type, name, module_name, data }
 */
function formatParam(p) {
  if (!p) return { text: "?" };
  if (p.category === "CONST") {
    return { text: `"${p.data ?? ""}"`, category: "CONST", type: p.type, data: p.data };
  }
  const display = p.module_name && p.module_name !== "rootNode"
    ? `${p.module_name}.${p.name || "?"}`
    : (p.name || "?");
  return {
    text: display,
    category: p.category, type: p.type,
    name: p.name, module_name: p.module_name,
  };
}

function parseAssignment(a) {
  return { lhs: formatParam(a.lhs_param), rhs: formatParam(a.rhs_param) };
}

/**
 * Order transits by actual execution flow:
 *   1. Find the entry node (a node that is a `from` but never a `to`, prefer "startNode").
 *   2. BFS from the entry — list each node's outgoing transits in declaration order,
 *      then enqueue the destinations.
 *   3. Any transit not reachable from the entry (orphan / pure cycle) is appended at the end.
 */
function orderTransitsByFlow(transits) {
  if (!transits.length) return transits;
  const adj = new Map();
  transits.forEach(t => {
    if (!adj.has(t.from)) adj.set(t.from, []);
    adj.get(t.from).push(t);
  });

  const froms = new Set(transits.map(t => t.from));
  const tos = new Set(transits.map(t => t.to));
  const sources = Array.from(froms).filter(n => !tos.has(n));
  let entry;
  if (sources.includes("startNode")) entry = "startNode";
  else if (sources.length) entry = sources[0];
  else entry = transits[0].from;

  const ordered = [];
  const seenTransit = new Set();
  const seenNode = new Set();
  const queue = [entry];

  const key = (t) => `${t.from}>>${t.to}#${t.name}`;

  while (queue.length) {
    const node = queue.shift();
    if (seenNode.has(node)) continue;
    seenNode.add(node);
    for (const t of adj.get(node) || []) {
      const k = key(t);
      if (seenTransit.has(k)) continue;
      seenTransit.add(k);
      ordered.push(t);
      if (!seenNode.has(t.to)) queue.push(t.to);
    }
  }
  // append unreachable (cycle-only / orphan) transits last
  transits.forEach(t => {
    const k = key(t);
    if (!seenTransit.has(k)) { seenTransit.add(k); ordered.push(t); }
  });
  return ordered;
}

function parsePlanBlock(planAst, parentName) {
  const planName = planAst.plan_name || "";

  // `config` is the plan-level root info (rootNode metadata), keep as a single entry.
  const rootConfig = planAst.config ? {
    node_name: planAst.config.node_name || "",
    pt_name: planAst.config.pt_name || "",
    pt_type: planAst.config.pt_type || "",
    raw: planAst.config,
  } : null;

  // The actual flow nodes live in `node_list`.
  const nodes = asArray(planAst.node_list).map(n => {
    const assignments = asArray(n.param_assignment).map(parseAssignment);
    // GOTO target: find the assignment where lhs.name === "nodeName"
    const gotoTarget = (n.pt_type === "GOTO")
      ? assignments.find(a => a.lhs.name === "nodeName")?.rhs.data || ""
      : "";
    return {
      node_name: n.node_name || "",
      pt_name: n.pt_name || "",
      pt_type: n.pt_type || "",
      tool_name: n.switch_tcp_param?.tool_name || "",
      assignments,
      goto_target: gotoTarget,
      refs: refsToObject(extractRefs(n)),
      raw: n,
    };
  });

  // Variable-assignment edges (between two nodes).
  const expressions = asArray(planAst.expression_set_list).map(e => {
    const assigns = [];
    asArray(e.param_expression).forEach(pe => {
      asArray(pe.param_assignment).forEach(pa => assigns.push(parseAssignment(pa)));
    });
    return {
      name: e.expression_set_name || "",
      desc: e.expression_set_desc || "",
      from: e.start_node_name || "",
      to: e.end_node_name || "",
      assignments: assigns,
    };
  });

  // GPIO output commands attached to a node (with their own trigger condition).
  const gpioCmds = asArray(planAst.gpio_commands).map(g => ({
    device: g.device_name || "",
    node_name: g.node_name || "",
    one_time_only: !!g.one_time_only,
    condition: formatCondition(g.trigger_condition),
    assignments: asArray(g.param_assignment).map(parseAssignment),
    desc: g.command_description || "",
  }));

  const transits = asArray(planAst.transit_list).map(t => {
    const expr = expressions.find(e => e.from === t.start_node_name && e.to === t.end_node_name) || null;
    return {
      from: t.start_node_name || "",
      to: t.end_node_name || "",
      name: t.transit_name || "",
      condition: formatCondition(t.trigger_condition),
      refs: refsToObject(extractRefs(t.trigger_condition)),
      expressionSet: expr,
    };
  });

  const projVars = asArray(planAst.proj_var_list).map(v => ({ ...v, plan: planName, category: v.category || "PROJ_VAR" }));
  const planVars = asArray(planAst.plan_var_list).map(v => ({ ...v, plan: planName, category: v.category || "PLAN_VAR" }));
  const children = asArray(planAst.child_plans).map(c => parsePlanBlock(c, planName));

  return {
    plan_name: planName,
    parent: parentName,
    rootConfig,
    nodes,                  // real nodes from node_list
    transits,
    expressions,
    gpioCmds,
    projVars, planVars,
    children,
    desc: planAst.plan_desc || "",
  };
}

function buildModel(projAst, planAst) {
  const root = parsePlanBlock(planAst, null);
  const allPlans = [];
  (function walk(p) { allPlans.push(p); p.children.forEach(walk); })(root);

  // collect all referenced params across the tree (nodes + transits + expressions + gpio cmds)
  const allRefs = {};
  const collect = (subtree, p, ctxNode) => {
    Object.entries(refsToObject(extractRefs(subtree))).forEach(([cat, items]) => {
      if (!allRefs[cat]) allRefs[cat] = new Map();
      items.forEach(it => {
        if (!allRefs[cat].has(it.name)) {
          allRefs[cat].set(it.name, { ...it, modules: new Set(), plans: new Set(), nodes: new Set() });
        }
        const r = allRefs[cat].get(it.name);
        if (it.module_name) r.modules.add(it.module_name);
        r.plans.add(p.plan_name);
        if (ctxNode) r.nodes.add(`${p.plan_name}/${ctxNode}`);
      });
    });
  };
  allPlans.forEach(p => {
    p.nodes.forEach(n => collect(n.raw, p, n.node_name));
    p.transits.forEach(t => collect(t, p));
    p.expressions.forEach(e => collect(e, p));
    p.gpioCmds.forEach(g => collect(g, p, g.node_name));
  });

  // declared vars
  const declared = new Map();
  allPlans.forEach(p => {
    [...p.projVars, ...p.planVars].forEach(v => {
      if (!declared.has(v.name)) declared.set(v.name, v);
    });
  });

  // unified variable list (one row per name)
  const variables = [];
  Object.entries(allRefs).forEach(([cat, m]) => {
    m.forEach((r) => {
      const d = declared.get(r.name);
      variables.push({
        name: r.name,
        category: cat,
        type: r.type || d?.type || "",
        defaultValue: d?.data ?? "",
        unit: d?.robotUnit && d.robotUnit !== "none" ? d.robotUnit : "",
        modules: Array.from(r.modules).sort(),
        plans: Array.from(r.plans).sort(),
        declaredIn: d?.plan || "",
        unused: false,
      });
    });
  });
  // add declared-but-never-referenced
  declared.forEach((d) => {
    if (!variables.some(v => v.name === d.name && v.category === (d.category || "PROJ_VAR"))) {
      variables.push({
        name: d.name,
        category: d.category || "PROJ_VAR",
        type: d.type || "",
        defaultValue: d.data ?? "",
        unit: d.robotUnit && d.robotUnit !== "none" ? d.robotUnit : "",
        modules: [],
        plans: [d.plan].filter(Boolean),
        declaredIn: d.plan || "",
        unused: true,
      });
    }
  });
  variables.sort((a, b) => a.name.localeCompare(b.name));

  // node type counts (from node_list across all plans + child sub-plan headers)
  const nodeTypeCounts = {};
  allPlans.forEach(p => {
    p.nodes.forEach(n => {
      if (n.pt_type) nodeTypeCounts[n.pt_type] = (nodeTypeCounts[n.pt_type] || 0) + 1;
    });
    // each child plan also counts as a PLAN node in its parent
    if (p.rootConfig?.pt_type === "PLAN" && p.parent) {
      nodeTypeCounts.PLAN = (nodeTypeCounts.PLAN || 0) + 1;
    }
  });

  const overview = {
    project_name: projAst.project_name || planAst.plan_name || "",
    version: projAst.version || "",
    plan_file_name: projAst.plan_file_name || "",
    scene_width: projAst.scene_width,
    scene_height: projAst.scene_height,
    arm_serial_number: projAst.robot_info?.arm_serial_number || "",
    desc: projAst.project_desc?.intr || "",
    sw_ver: planAst.sw_ver || "",
  };

  return { overview, root, allPlans, variables, nodeTypeCounts };
}

/* ============================================================
   FILE INTAKE
   ============================================================ */

async function readFilesFromZip(zipFile) {
  const zip = await JSZip.loadAsync(zipFile);
  const result = { projText: null, planText: null, projName: "", planName: "" };
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const lower = entry.name.toLowerCase();
    if (lower.endsWith(".proj")) {
      result.projText = await entry.async("string");
      result.projName = entry.name.split("/").pop();
    } else if (lower.endsWith(".plan")) {
      result.planText = await entry.async("string");
      result.planName = entry.name.split("/").pop();
    }
  }
  return result;
}

async function walkEntry(entry, files) {
  return new Promise((resolve) => {
    if (entry.isFile) entry.file((f) => { files.push(f); resolve(); });
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readAll = () => reader.readEntries(async (sub) => {
        if (!sub.length) return resolve();
        await Promise.all(sub.map(s => walkEntry(s, files)));
        readAll();
      });
      readAll();
    } else resolve();
  });
}

async function intakeFromDataTransfer(dt) {
  const files = [];
  const items = Array.from(dt.items || []);
  if (items.length && items[0].webkitGetAsEntry) {
    const entries = items.map(it => it.webkitGetAsEntry()).filter(Boolean);
    await Promise.all(entries.map(e => walkEntry(e, files)));
  } else {
    files.push(...Array.from(dt.files));
  }
  return files;
}

/* ============================================================
   UI
   ============================================================ */

export default function PlanParserTool() {
  const [model, setModel] = useState(null);
  const [files, setFiles] = useState(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeNav, setActiveNav] = useState("overview");
  const folderInputRef = useRef(null);
  const zipInputRef = useRef(null);
  const filesInputRef = useRef(null);

  const handleFiles = useCallback(async (fileList) => {
    setError(""); setLoading(true);
    try {
      const arr = Array.from(fileList);
      const zip = arr.find(f => f.name.toLowerCase().endsWith(".zip"));
      let projText, planText, projName, planName;
      if (zip && arr.length === 1) {
        const r = await readFilesFromZip(zip);
        projText = r.projText; planText = r.planText; projName = r.projName; planName = r.planName;
      } else {
        const projFile = arr.find(f => f.name.toLowerCase().endsWith(".proj"));
        const planFile = arr.find(f => f.name.toLowerCase().endsWith(".plan"));
        if (!projFile || !planFile) throw new Error("未找到 .proj 或 .plan 文件");
        projText = await projFile.text();
        planText = await planFile.text();
        projName = projFile.name; planName = planFile.name;
      }
      if (!projText || !planText) throw new Error("未找到 .proj 或 .plan 文件");
      const m = buildModel(parseProtoText(projText), parseProtoText(planText));
      setModel(m);
      setFiles({ projName, planName });
      setActiveNav("overview");
    } catch (e) { setError("解析失败：" + e.message); }
    finally { setLoading(false); }
  }, []);

  const onDrop = useCallback(async (e) => {
    e.preventDefault(); setDragOver(false);
    const files = await intakeFromDataTransfer(e.dataTransfer);
    if (files.length) handleFiles(files);
  }, [handleFiles]);

  if (!model) {
    return <Intake
      onDrop={onDrop}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      dragOver={dragOver}
      loading={loading} error={error}
      folderInputRef={folderInputRef} zipInputRef={zipInputRef} filesInputRef={filesInputRef}
      handleFiles={handleFiles}
    />;
  }

  return <Workspace
    model={model} files={files}
    activeNav={activeNav} setActiveNav={setActiveNav}
    onReset={() => { setModel(null); setFiles(null); }}
  />;
}

/* ---------- Intake ---------- */

function Intake({ onDrop, onDragOver, onDragLeave, dragOver, loading, error, folderInputRef, zipInputRef, filesInputRef, handleFiles }) {
  const pick = (ref) => () => ref.current?.click();
  const onChange = (e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ""; };
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-6 sm:px-6 lg:px-8">
      <div className="w-full max-w-2xl">
        <div
          onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
          className={`rounded-[28px] border-2 border-dashed px-8 py-12 text-center transition-all ${dragOver ? "border-amber-500 bg-amber-50 scale-[1.01]" : "border-slate-300 bg-white/92"}`}
        >
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[22px] border border-amber-100 bg-gradient-to-br from-amber-50 to-slate-100 text-amber-600 shadow-[0_16px_32px_-24px_rgba(217,119,6,0.45)]">
            <FolderOpen className="h-8 w-8" />
          </div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{loading ? "解析中…" : "导入 PLAN 工程"}</h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-slate-500">
            拖入<strong>工程文件夹</strong>、<strong>.zip 压缩包</strong>，或<strong>同时选择 .proj 和 .plan 文件</strong>
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button onClick={pick(folderInputRef)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-50">
              <Folder className="h-4 w-4" /> 选择文件夹
            </button>
            <button onClick={pick(zipInputRef)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-50">
              <FileArchive className="h-4 w-4" /> 选择 .zip
            </button>
            <button onClick={pick(filesInputRef)} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:-translate-y-0.5">
              <Upload className="h-4 w-4" /> 选择 .proj 与 .plan 文件
            </button>
          </div>
          <input ref={folderInputRef} type="file" webkitdirectory="" directory="" multiple onChange={onChange} className="hidden" />
          <input ref={zipInputRef} type="file" accept=".zip" onChange={onChange} className="hidden" />
          <input ref={filesInputRef} type="file" multiple accept=".proj,.plan,.project" onChange={onChange} className="hidden" />
          {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-700">{error}</div>}
        </div>
        <div className="mt-5 rounded-xl border border-slate-200 bg-white/70 p-4 text-xs leading-6 text-slate-500">
          <div className="mb-1 font-bold text-slate-700">支持格式</div>
          • Flexiv Elements Studio 工程文件夹（含 <code className="rounded bg-slate-100 px-1">.proj</code> + <code className="rounded bg-slate-100 px-1">.plan</code>）<br />
          • 工程文件夹的 .zip 压缩包<br />
          • 直接拖入两个文件
        </div>
      </div>
    </div>
  );
}

/* ---------- Workspace ---------- */

const NAV_ITEMS = [
  { id: "overview", label: "工程总览", icon: Info },
  { id: "variables", label: "变量",   icon: Variable },
  { id: "flow",     label: "流程",    icon: Workflow },
];

function Workspace({ model, files, activeNav, setActiveNav, onReset }) {
  const { overview, root, allPlans, variables, nodeTypeCounts } = model;
  return (
    <div className="flex h-full w-full overflow-hidden bg-[#f1f5f9] font-sans text-slate-800">
      {/* SIDEBAR */}
      <aside className="my-2 ml-2 flex w-56 flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-md">
              <FolderOpen className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-bold text-slate-900" title={overview.project_name}>{overview.project_name || "未命名工程"}</div>
              <div className="truncate font-mono text-[10px] text-slate-400">{overview.version}{overview.sw_ver ? ` · ${overview.sw_ver}` : ""}</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          {NAV_ITEMS.map(it => {
            const Icon = it.icon;
            const active = activeNav === it.id;
            return (
              <button key={it.id} onClick={() => setActiveNav(it.id)}
                className={`mb-1.5 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition-all ${active ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200" : "text-slate-600 hover:bg-slate-50"}`}>
                <Icon className={`h-4 w-4 ${active ? "text-amber-500" : "text-slate-400"}`} />
                {it.label}
                {it.id === "variables" && <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{variables.length}</span>}
                {it.id === "flow" && <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{1 + root.children.length}</span>}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <button onClick={onReset} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50">
            <X className="h-3.5 w-3.5" /> 重新导入
          </button>
          <div className="mt-2 truncate font-mono text-[10px] text-slate-400" title={`${files?.projName} · ${files?.planName}`}>
            {files?.projName}<br />{files?.planName}
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 overflow-y-auto p-4">
        {activeNav === "overview" && <OverviewPane overview={overview} variables={variables} root={root} nodeTypeCounts={nodeTypeCounts} />}
        {activeNav === "variables" && <VariablesPane variables={variables} />}
        {activeNav === "flow" && <FlowPane root={root} allPlans={allPlans} />}
      </main>
    </div>
  );
}

/* ---------- Overview ---------- */

function OverviewPane({ overview, variables, root, nodeTypeCounts }) {
  const catCounts = useMemo(() => {
    const m = {};
    variables.forEach(v => { m[v.category] = (m[v.category] || 0) + 1; });
    return m;
  }, [variables]);
  const totalNodes = Object.values(nodeTypeCounts).reduce((a, b) => a + b, 0);
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Card>
        <SectionTitle icon={Info}>基本信息</SectionTitle>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Row k="工程名称" v={overview.project_name} mono />
          <Row k="Plan 文件" v={overview.plan_file_name} mono />
          <Row k="机械臂序列号" v={overview.arm_serial_number} mono />
          <Row k="工程版本" v={overview.version} mono />
          <Row k="软件版本 (sw_ver)" v={overview.sw_ver} mono />
          <Row k="画布尺寸" v={overview.scene_width && overview.scene_height ? `${overview.scene_width} × ${overview.scene_height} px` : ""} />
        </dl>
        {overview.desc && (
          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-slate-700">
            <strong className="text-blue-600">工程描述：</strong>{overview.desc}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="子计划" value={root.children.length} accent="violet" />
        <StatCard label="主流程跳转" value={root.transits.length} accent="blue" />
        <StatCard label="节点总数" value={totalNodes} accent="amber" />
        <StatCard label="变量总数" value={variables.length} accent="emerald" />
      </div>

      <Card>
        <SectionTitle icon={Variable}>变量分布</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {Object.entries(CATEGORY_META).map(([cat, meta]) => {
            const n = catCounts[cat] || 0;
            if (!n) return null;
            return (
              <span key={cat} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${COLOR_CHIP[meta.color]}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${COLOR_DOT[meta.color]}`} />
                <strong>{meta.label}</strong>
                <span className="font-mono">{n}</span>
              </span>
            );
          })}
        </div>
      </Card>

      <Card>
        <SectionTitle icon={Boxes}>节点类型分布</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Object.entries(nodeTypeCounts).sort(([, a], [, b]) => b - a).map(([type, n]) => {
            const meta = NODE_TYPE_META[type] || { label: type, color: "slate" };
            const pct = totalNodes > 0 ? Math.round((n / totalNodes) * 100) : 0;
            return (
              <div key={type} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-baseline justify-between">
                  <span className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold ${COLOR_CHIP[meta.color]}`}>{type}</span>
                  <span className="font-mono text-[11px] text-slate-400">{pct}%</span>
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-xs text-slate-500">{meta.label}</span>
                  <span className="text-lg font-black tabular-nums text-slate-800">{n}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/* ---------- Variables ---------- */

function VariablesPane({ variables }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [type, setType] = useState("");
  const types = useMemo(() => Array.from(new Set(variables.map(v => v.type).filter(Boolean))).sort(), [variables]);
  const cats = useMemo(() => Array.from(new Set(variables.map(v => v.category))).sort(), [variables]);
  const filtered = useMemo(() => variables.filter(v => {
    if (q && !v.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (cat && v.category !== cat) return false;
    if (type && v.type !== type) return false;
    return true;
  }), [variables, q, cat, type]);

  // group by category for display
  const groups = useMemo(() => {
    const byCat = {};
    filtered.forEach(v => {
      if (!byCat[v.category]) byCat[v.category] = [];
      byCat[v.category].push(v);
    });
    return Object.entries(byCat).sort(([a], [b]) => {
      const order = ["PROJ_VAR", "GLOBAL_VAR", "PLAN_VAR", "GPIO_CMD", "GPIO_STATE", "DEVICE_CMD", "DEVICE_STATE"];
      return (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b));
    });
  }, [filtered]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索变量名…"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm outline-none placeholder:text-slate-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20" />
          </div>
          <select value={cat} onChange={e => setCat(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-amber-500">
            <option value="">全部分类</option>
            {cats.map(c => <option key={c} value={c}>{CATEGORY_META[c]?.label || c}</option>)}
          </select>
          <select value={type} onChange={e => setType(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-amber-500">
            <option value="">全部类型</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="text-xs text-slate-500">共 {filtered.length} / {variables.length}</div>
        </div>
      </Card>

      {groups.map(([category, rows]) => (
        <VarGroupTable key={category} category={category} rows={rows} />
      ))}
      {!groups.length && <Card><div className="py-10 text-center text-sm text-slate-400">无匹配变量</div></Card>}
    </div>
  );
}

function VarGroupTable({ category, rows }) {
  const meta = CATEGORY_META[category] || { label: category, color: "slate" };
  return (
    <Card padding="p-0">
      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
        <span className={`h-2 w-2 rounded-full ${COLOR_DOT[meta.color]}`} />
        <div className="font-bold text-slate-800">{meta.label}</div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-500">{category}</span>
        <span className="ml-auto text-xs text-slate-500">{rows.length} 项</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/40 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-5 py-2.5">名称</th>
              <th className="px-3 py-2.5">类型</th>
              <th className="px-3 py-2.5">默认值</th>
              <th className="px-3 py-2.5">单位</th>
              <th className="px-3 py-2.5">引用模块</th>
              <th className="px-3 py-2.5">出现于子计划</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/40">
                <td className="px-5 py-2 font-mono text-xs font-bold text-slate-800 break-all">
                  {v.name}
                  {v.unused && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">未引用</span>}
                </td>
                <td className="px-3 py-2"><TypeChip type={v.type} /></td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500 break-all">{String(v.defaultValue ?? "") || <span className="text-slate-300">—</span>}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{v.unit || <span className="text-slate-300">—</span>}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500" title={v.modules?.join("\n") || ""}>
                  {v.modules?.length ? v.modules.slice(0, 3).join(", ") + (v.modules.length > 3 ? ` 等 ${v.modules.length} 个` : "") : "—"}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500" title={v.plans?.join("\n") || ""}>
                  {v.plans?.length ? v.plans.slice(0, 3).join(", ") + (v.plans.length > 3 ? ` 等 ${v.plans.length} 个` : "") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------- Flow ---------- */

function FlowPane({ root, allPlans }) {
  const [selectedPlan, setSelectedPlan] = useState(root.plan_name);
  const plan = allPlans.find(p => p.plan_name === selectedPlan) || root;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* Plan picker */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500">流程选择</span>
          <button onClick={() => setSelectedPlan(root.plan_name)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${selectedPlan === root.plan_name ? "bg-amber-500 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-700 hover:border-amber-300"}`}>
            ★ 主流程
          </button>
          {root.children.map(c => (
            <button key={c.plan_name} onClick={() => setSelectedPlan(c.plan_name)}
              className={`rounded-lg px-3 py-1.5 font-mono text-xs font-bold transition-all ${selectedPlan === c.plan_name ? "bg-blue-500 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-700 hover:border-blue-300"}`}>
              {c.plan_name}
            </button>
          ))}
        </div>
      </Card>

      <PlanFlowDetail plan={plan} isRoot={plan.plan_name === root.plan_name} />
    </div>
  );
}

function PlanFlowDetail({ plan, isRoot }) {
  const nodeByName = useMemo(() => {
    const m = new Map();
    plan.nodes.forEach(n => m.set(n.node_name, n));
    if (plan.rootConfig) m.set(plan.rootConfig.node_name, plan.rootConfig);
    return m;
  }, [plan]);

  // Order transits by actual execution flow (BFS from startNode),
  // not by file declaration order.
  const orderedTransits = useMemo(() => orderTransitsByFlow(plan.transits), [plan.transits]);

  // GPIO commands grouped by their host node
  const gpioByNode = useMemo(() => {
    const m = {};
    plan.gpioCmds.forEach(g => {
      if (!m[g.node_name]) m[g.node_name] = [];
      m[g.node_name].push(g);
    });
    return m;
  }, [plan]);

  // Count signals/assignments for header stats
  const totalAssigns = plan.expressions.reduce((a, e) => a + e.assignments.length, 0);
  const totalGpioOps = plan.gpioCmds.reduce((a, g) => a + g.assignments.length, 0);

  return (
    <>
      <Card>
        <div className="flex items-start gap-4">
          <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-white shadow-md ${isRoot ? "bg-amber-500" : "bg-blue-500"}`}>
            {isRoot ? <Workflow className="h-5 w-5" /> : <SubPlanIcon />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-lg font-bold text-slate-900">{plan.plan_name}</span>
              <span className="text-xs text-slate-500">{isRoot ? "主流程" : `子计划 · 父: ${plan.parent}`}</span>
            </div>
            {plan.desc && <div className="mt-1 text-sm text-slate-600">{plan.desc}</div>}
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
              <Stat label="节点" value={plan.nodes.length} />
              <Stat label="跳转" value={plan.transits.length} />
              <Stat label="变量赋值" value={totalAssigns} accent="violet" />
              <Stat label="GPIO 指令" value={plan.gpioCmds.length} accent="amber" />
              <Stat label="GPIO 写入项" value={totalGpioOps} accent="amber" />
              {plan.children.length > 0 && <Stat label="子计划" value={plan.children.length} accent="blue" />}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle icon={Workflow}>跳转流程</SectionTitle>
        {orderedTransits.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">此计划无跳转</div>
        ) : (
          <div className="space-y-2">
            {orderedTransits.map((t, i) => (
              <TransitRow key={`${t.from}->${t.to}-${t.name}`} step={i + 1} transit={t}
                fromNode={nodeByName.get(t.from)} toNode={nodeByName.get(t.to)}
                gpioAtTo={gpioByNode[t.to] || []}
              />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle icon={Boxes}>节点详情</SectionTitle>
        {plan.nodes.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">此计划无节点</div>
        ) : (
          <div className="space-y-2">
            {plan.nodes.map(n => (
              <NodeCard key={n.node_name} node={n} gpioCmds={gpioByNode[n.node_name] || []} />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value, accent = "slate" }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1">
      <span className={`h-1.5 w-1.5 rounded-full ${COLOR_DOT[accent]}`} />
      <span className="font-mono font-bold text-slate-800">{value}</span>
      <span className="text-[11px]">{label}</span>
    </span>
  );
}

function SubPlanIcon() {
  return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>;
}

function TransitRow({ step, transit, fromNode, toNode, gpioAtTo }) {
  const [open, setOpen] = useState(false);
  const hasAssign = transit.expressionSet && transit.expressionSet.assignments.length > 0;
  const hasGpio = gpioAtTo.length > 0;
  const hasCond = transit.condition && transit.condition !== "无条件";
  const expandable = hasAssign || hasGpio || hasCond;

  return (
    <div className={`rounded-xl border ${hasAssign || hasGpio ? "border-violet-200/70" : "border-slate-200"} bg-white overflow-hidden`}>
      <button onClick={() => expandable && setOpen(o => !o)}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left ${expandable ? "hover:bg-slate-50/60" : "cursor-default"}`}>
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 font-mono text-[11px] font-bold text-slate-600">{step}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-slate-800">{transit.from}</span>
            {fromNode?.pt_type && <NodeTypeChip type={fromNode.pt_type} />}
            <ArrowRight className="h-4 w-4 text-violet-500" />
            <span className="font-mono text-sm font-bold text-violet-700">{transit.to}</span>
            {toNode?.pt_type && <NodeTypeChip type={toNode.pt_type} />}
            {toNode?.goto_target && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0 font-mono text-[10px] font-bold text-amber-700">
                <ArrowRight className="h-3 w-3" />{toNode.goto_target}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {transit.condition && (
              <span className="inline-flex items-baseline gap-1 rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700">
                <span className="text-slate-400">条件</span>
                <span className="break-all">{transit.condition}</span>
              </span>
            )}
            {hasAssign && (
              <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-2 py-0.5 font-mono text-[10px] font-bold text-violet-700">
                ✎ {transit.expressionSet.assignments.length} 项赋值
              </span>
            )}
            {hasGpio && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-700">
                ⚡ {gpioAtTo.length} GPIO 指令
              </span>
            )}
            {transit.name && <span className="font-mono text-[10px] text-slate-400">{transit.name}</span>}
          </div>
        </div>
        {expandable && (open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />)}
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50/40 px-4 py-3">
          {hasCond && (
            <DetailSection title="触发条件" tone="slate">
              <code className="block whitespace-pre-wrap break-all rounded bg-white px-3 py-2 font-mono text-[12px] text-slate-700">{transit.condition}</code>
            </DetailSection>
          )}
          {hasAssign && (
            <DetailSection title="变量赋值（边操作）" tone="violet">
              <AssignmentList assignments={transit.expressionSet.assignments} />
            </DetailSection>
          )}
          {hasGpio && (
            <DetailSection title={`目标节点 ${transit.to} 的 GPIO 指令`} tone="amber">
              {gpioAtTo.map((g, i) => <GpioBlock key={i} cmd={g} />)}
            </DetailSection>
          )}
        </div>
      )}
    </div>
  );
}

function NodeCard({ node, gpioCmds }) {
  const [open, setOpen] = useState(false);
  const refsByCategory = node.refs || {};
  const totalRefs = Object.values(refsByCategory).reduce((a, b) => a + b.length, 0);
  const hasAssignments = node.assignments && node.assignments.length > 0;
  const hasGpio = gpioCmds.length > 0;
  const expandable = totalRefs > 0 || hasAssignments || hasGpio;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <button onClick={() => expandable && setOpen(o => !o)}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left ${expandable ? "hover:bg-slate-50/60" : "cursor-default"}`}>
        <NodeTypeChip type={node.pt_type} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-slate-800">{node.node_name}</span>
            {node.pt_name && node.pt_name !== node.node_name && (
              <span className="font-mono text-[11px] text-slate-400">"{node.pt_name}"</span>
            )}
            {node.goto_target && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-700">
                <ArrowRight className="h-3 w-3" /> {node.goto_target}
              </span>
            )}
            {node.tool_name && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">tool: {node.tool_name}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            {hasAssignments && (
              <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0 font-mono text-[10px] font-bold text-violet-700">
                ✎ {node.assignments.length} 项参数
              </span>
            )}
            {hasGpio && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0 font-mono text-[10px] font-bold text-amber-700">
                ⚡ {gpioCmds.length} GPIO
              </span>
            )}
            {totalRefs > 0 && <span>引用 {totalRefs} 项</span>}
            {Object.entries(refsByCategory).map(([cat, items]) => {
              const meta = CATEGORY_META[cat];
              if (!meta || !items.length) return null;
              return (
                <span key={cat} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0 font-mono text-[10px] ${COLOR_CHIP[meta.color]}`}>
                  <span className={`h-1 w-1 rounded-full ${COLOR_DOT[meta.color]}`} />
                  {meta.short} {items.length}
                </span>
              );
            })}
          </div>
        </div>
        {expandable && (open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />)}
      </button>

      {open && expandable && (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50/40 px-4 py-3">
          {hasAssignments && (
            <DetailSection title="节点参数赋值" tone="violet">
              <AssignmentList assignments={node.assignments} />
            </DetailSection>
          )}
          {hasGpio && (
            <DetailSection title="GPIO 信号输出" tone="amber">
              {gpioCmds.map((g, i) => <GpioBlock key={i} cmd={g} />)}
            </DetailSection>
          )}
          {totalRefs > 0 && (
            <DetailSection title="引用变量" tone="slate">
              <RefsBlock refs={refsByCategory} />
            </DetailSection>
          )}
        </div>
      )}
    </div>
  );
}

function DetailSection({ title, tone, children }) {
  const tones = {
    violet: "border-violet-200 bg-violet-50/40",
    amber:  "border-amber-200 bg-amber-50/40",
    slate:  "border-slate-200 bg-white",
  };
  return (
    <div className={`rounded-lg border ${tones[tone] || tones.slate} p-3`}>
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ParamPill({ param }) {
  if (!param) return <span className="font-mono text-xs text-slate-400">?</span>;
  const meta = CATEGORY_META[param.category];
  const color = meta?.color || "slate";
  const isConst = param.category === "CONST";
  return (
    <span className={`inline-flex items-baseline gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${isConst ? "border-slate-200 bg-white text-slate-700" : COLOR_CHIP[color]}`}>
      {!isConst && param.module_name && param.module_name !== "rootNode" && (
        <span className="opacity-60">{param.module_name}.</span>
      )}
      <span>{param.text || param.name || param.data || "?"}</span>
      {param.type && <span className="rounded bg-white/60 px-1 text-[9px] text-slate-500">{param.type}</span>}
    </span>
  );
}

function AssignmentList({ assignments }) {
  return (
    <div className="space-y-1.5">
      {assignments.map((a, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 font-mono text-[12px]">
          <ParamPill param={a.lhs} />
          <span className="font-bold text-violet-600">←</span>
          <ParamPill param={a.rhs} />
        </div>
      ))}
    </div>
  );
}

function GpioBlock({ cmd }) {
  return (
    <div className="rounded-md border border-amber-200/60 bg-white p-2">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2 text-[11px]">
        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-800">{cmd.device}</span>
        {cmd.one_time_only && <span className="rounded bg-slate-100 px-1.5 py-0 font-mono text-[10px] text-slate-600">单次触发</span>}
        {cmd.condition && cmd.condition !== "无条件" && (
          <span className="font-mono text-[11px] text-slate-500">
            当 <code className="rounded bg-slate-100 px-1 text-slate-700">{cmd.condition}</code>
          </span>
        )}
      </div>
      <AssignmentList assignments={cmd.assignments} />
      {cmd.desc && <div className="mt-1 text-[10px] text-slate-500">{cmd.desc}</div>}
    </div>
  );
}

function RefsBlock({ refs }) {
  // group categories: variables / IO / device / others
  const order = ["PROJ_VAR", "GLOBAL_VAR", "PLAN_VAR", "GPIO_CMD", "GPIO_STATE", "DEVICE_CMD", "DEVICE_STATE", "PT_INPUT", "PT_STATE", "SYS_STATE"];
  const cats = Object.keys(refs).sort((a, b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return (
    <div className="space-y-2">
      {cats.map(cat => {
        const meta = CATEGORY_META[cat] || { label: cat, color: "slate" };
        const items = refs[cat];
        return (
          <div key={cat} className="flex flex-wrap items-baseline gap-2">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${COLOR_DOT[meta.color]}`} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{meta.label}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {items.map((it, i) => (
                <span key={i} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] ${COLOR_CHIP[meta.color]}`}>
                  {it.module_name && it.module_name !== "rootNode" && <span className="opacity-60">{it.module_name}.</span>}
                  {it.name}
                  {it.type && <span className="rounded bg-white/60 px-1 text-[9px] text-slate-500">{it.type}</span>}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- shared atoms ---------- */

function Card({ children, padding = "p-5" }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${padding}`}>{children}</div>;
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-700">
      <span className="h-5 w-1 rounded-full bg-amber-500" />
      {Icon && <Icon className="h-4 w-4 text-amber-500" />}
      {children}
    </h3>
  );
}

function Row({ k, v, mono }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-slate-100 pb-2">
      <dt className="w-32 flex-shrink-0 text-xs font-bold text-slate-500">{k}</dt>
      <dd className={`min-w-0 break-all text-sm text-slate-800 ${mono ? "font-mono" : ""}`}>{v || <span className="text-slate-300">—</span>}</dd>
    </div>
  );
}

function StatCard({ label, value, accent = "blue" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${COLOR_DOT[accent]}`} />
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      </div>
      <div className="mt-2 text-2xl font-black tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

function TypeChip({ type }) {
  if (!type) return null;
  const colorByType = {
    BOOL: "emerald", INT: "blue", DOUBLE: "amber",
    STRING: "violet", COORD: "violet", JPOS: "rose", VEC_3d: "slate", VEC_2d: "slate",
  };
  const color = colorByType[type] || "slate";
  return <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10px] ${COLOR_CHIP[color]}`}>{type}</span>;
}

function NodeTypeChip({ type }) {
  if (!type) return null;
  const meta = NODE_TYPE_META[type] || { label: type, color: "slate" };
  return <span className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold ${COLOR_CHIP[meta.color]}`}>{type}</span>;
}
