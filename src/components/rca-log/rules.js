// Rule table for log pattern detection.
// To add a new pattern, append an entry. Each rule must produce stable `id`.
//
// Fields:
//   id        - unique key, used for grouping
//   name      - Chinese display name
//   category  - one of: vision, gripper, performance, system, communication, flow, other
//   severity  - "error" | "warn" | "info"
//   match(m, level) - return true if message line matches; receives raw content and level (uppercased)
//   extract(m) - optional, returns extra fields merged into the anomaly record (e.g. { cost: 0.82 })
//   description - one-line plain-Chinese explanation shown next to occurrences

export const RULES = [
  // --- Vision ---
  {
    id: "vision_tcp_timeout",
    name: "视觉触发超时",
    category: "vision",
    severity: "warn",
    description: "ConvVisionTrigger TCP 读取超时，视觉系统未在预期时间内响应触发请求",
    match: (m) => m.includes("TCP recv timeout") && m.includes("ConvVisionTrigger"),
  },
  {
    id: "vision_pose_error",
    name: "视觉位姿异常",
    category: "vision",
    severity: "info",
    description: "errorPoseCheck 节点检测到位姿不合法（error_pose==1）",
    match: (m) => m.includes("[error_pose]") && m.includes("== [1]"),
  },

  // --- Gripper / Devices ---
  {
    id: "gripper_comm_err",
    name: "夹爪通信异常",
    category: "gripper",
    severity: "warn",
    description: "Flexiv-GN01 夹爪通信失败，常见于启动握手或断线",
    match: (m) => m.includes("CommErr") && /Flexiv-GN0\d/.test(m),
  },
  {
    id: "gripper_recv_state_failed",
    name: "夹爪状态接收失败",
    category: "gripper",
    severity: "warn",
    description: "GripperFlexivComDevWib 无法接收夹爪状态反馈",
    match: (m) => m.includes("GripperFlexivComDevWib") && m.includes("recvState failed"),
  },

  // --- Performance ---
  {
    id: "primitive_loop_slow",
    name: "控制循环超时",
    category: "performance",
    severity: "warn",
    description: "[PrimitiveLoop] 单次循环耗时超过控制周期阈值（一般 1ms）",
    match: (m, level) => level === "WARNING" && m.includes("[PrimitiveLoop]") && m.includes("time cost"),
    extract: (m) => {
      const t = m.match(/time cost:\s*([\d.]+)\s*ms/);
      const idx = m.match(/Index:\s*(\d+)/);
      return { cost: t ? +t[1] : null, index: idx ? +idx[1] : null };
    },
  },
  {
    id: "tp_planning_slow",
    name: "轨迹规划耗时偏高",
    category: "performance",
    severity: "info",
    description: "[TP] 单次规划总耗时 > 50ms",
    match: (m) => {
      if (!m.includes("[TP] time for")) return false;
      const t = m.match(/:\s*([\d.]+)\s*ms;\s*Path/);
      return t && parseFloat(t[1]) > 50;
    },
    extract: (m) => {
      const t = m.match(/time for (.*?):\s*([\d.]+)\s*ms;\s*Path:\s*([\d.]+)\s*ms;\s*Ready:\s*([\d.]+)\s*ms/);
      return t ? { target: t[1], total: +t[2], path: +t[3], ready: +t[4] } : {};
    },
  },

  // --- System ---
  {
    id: "system_state_error",
    name: "系统进入 ERROR 状态",
    category: "system",
    severity: "error",
    description: "currentState 被置为 ERROR（非 != ERROR 判断）",
    match: (m) => /\[currentState\]\s*==\s*\[ERROR\]/.test(m),
  },
  {
    id: "exception_thrown",
    name: "异常抛出",
    category: "system",
    severity: "error",
    description: "捕获到 exception 关键字",
    match: (m) => /\bexception\b/i.test(m) && !/\b(no |without |handle|caught)\b/i.test(m),
  },

  // --- Catch-all (must be last) ---
  {
    id: "level_error",
    name: "错误日志",
    category: "other",
    severity: "error",
    description: "日志 level 为 ERROR/CRITICAL/FATAL 且未匹配上面任何专项规则",
    match: (m, level) => level === "ERROR" || level === "CRITICAL" || level === "FATAL",
  },
  {
    id: "level_warning_misc",
    name: "其他警告",
    category: "other",
    severity: "warn",
    description: "日志 level 为 WARNING 且未匹配上面任何专项规则",
    match: (m, level) => level === "WARNING" || level === "WARN",
  },
];

export const RULE_BY_ID = Object.fromEntries(RULES.map(r => [r.id, r]));

export const CATEGORY_META = {
  vision:        { label: "视觉",       color: "violet"  },
  gripper:       { label: "末端执行器", color: "amber"   },
  performance:   { label: "性能",       color: "blue"    },
  system:        { label: "系统",       color: "rose"    },
  communication: { label: "通信",       color: "emerald" },
  flow:          { label: "流程",       color: "slate"   },
  other:         { label: "其他",       color: "slate"   },
};

export const SEVERITY_META = {
  error: { label: "错误", color: "rose"   },
  warn:  { label: "警告", color: "amber"  },
  info:  { label: "信息", color: "blue"   },
};

// Apply rules to one log entry. First-match wins.
// Returns { rule, extra } or null.
export function applyRules(rawContent, level) {
  for (const r of RULES) {
    if (r.match(rawContent, level)) {
      const extra = r.extract ? r.extract(rawContent) : {};
      return { rule: r, extra };
    }
  }
  return null;
}
