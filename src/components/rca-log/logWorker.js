// Web Worker for parsing robot log files.
// Output model:
//   - logs (streamed): { id, t, t_ms, l, m, module, content, sessionId, ruleId? }
//   - summary: { sessions[], rules[], totals, anomalyClusters[] }
//
// Each input file == one session (per user spec: robot restart -> new file).

import { RULES, applyRules } from "./rules";

const LOG_REGEX = /^\[(20\d\d-\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\]\s*\[([a-zA-Z]+)\]\s*(.*)$/;
const STREAM_BATCH_SIZE = 30000;
const CHUNK_SIZE = 100000;

function parseModule(message) {
  const match = message.match(/^(?:\[(.*?)\]\s*)?(.*)$/);
  if (match && match[1]) return { module: match[1], content: match[2] };
  return { module: "Unknown", content: message };
}

function safeMs(timeStr) {
  // Log timestamps have no timezone suffix — they are LOCAL wall-clock time
  // (machine on-site clock). Parse manually so we don't depend on JS's
  // implementation-defined "ISO without TZ" handling.
  const m = timeStr.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)$/);
  if (!m) return 0;
  const ms = Math.floor(parseInt(m[7].padEnd(6, "0").substring(0, 6), 10) / 1000);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms).getTime();
}

function extractPlanTimeLog(rawMessage) {
  const headerMatch = rawMessage.match(/====== Plan \[(.*?)\] Time Log/);
  if (!headerMatch) return null;
  const nodeRegex = /node \[(.*?)\] time\s*:\s*([\d.]+)\s*\[s\]/g;
  const nodes = [];
  let m;
  while ((m = nodeRegex.exec(rawMessage)) !== null) {
    nodes.push({ node: m[1], time: parseFloat(m[2]) });
  }
  const totalMatch = rawMessage.match(/Total Time = ([\d.]+)/);
  const total = totalMatch ? parseFloat(totalMatch[1]) : nodes.reduce((a, b) => a + b.time, 0);
  return { plan: headerMatch[1], nodes, total };
}

function buildSessionMetrics(session, logs) {
  // aggregate within this session's slice of logs
  const stateTimeline = [];
  const primitiveLoops = [];
  const trajectoryPlans = [];
  const planExecutions = [];
  const planEntries = [];
  const anomalyByRule = {};

  for (let i = session.startIdx; i <= session.endIdx; i++) {
    const log = logs[i];
    const raw = log.m || "";

    // State transitions: distinguish node-level (PT_TRANSITION inside a plan) from system-level
    const sysMatch = raw.match(/Transit system state from \[(.*?)\] to \[(.*?)\]/);
    if (sysMatch) {
      stateTimeline.push({ kind: "system", from: sysMatch[1], to: sysMatch[2], time: log.t_ms, timeStr: log.t, logId: log.id });
    } else if (raw.includes("PT_TRANSITION")) {
      const nodeMatch = raw.match(/from \[(.*?)\] to \[(.*?)\]/);
      if (nodeMatch) {
        stateTimeline.push({ kind: "node", from: nodeMatch[1], to: nodeMatch[2], time: log.t_ms, timeStr: log.t, logId: log.id });
      }
    }

    // Entered plan markers
    const enteredMatch = raw.match(/Entered plan\s*[-:]\s*(\S+)/);
    if (enteredMatch) {
      planEntries.push({ plan: enteredMatch[1], time: log.t_ms, timeStr: log.t, logId: log.id });
    }

    // Primitive loop time cost (control loop)
    if (raw.includes("PrimitiveLoop") && raw.includes("time cost")) {
      const m = raw.match(/time cost:\s*([\d.]+)\s*ms/);
      if (m) {
        const idx = raw.match(/Index:\s*(\d+)/);
        primitiveLoops.push({
          time: log.t_ms, timeStr: log.t,
          cost: parseFloat(m[1]),
          index: idx ? parseInt(idx[1], 10) : null,
          logId: log.id,
        });
      }
    }

    // Trajectory planning
    if (raw.includes("[TP] time for")) {
      const m = raw.match(/time for (.*?):\s*([\d.]+)\s*ms;\s*Path:\s*([\d.]+)\s*ms;\s*Ready:\s*([\d.]+)\s*ms/);
      if (m) {
        trajectoryPlans.push({
          time: log.t_ms, timeStr: log.t,
          target: m[1], total: parseFloat(m[2]), path: parseFloat(m[3]), ready: parseFloat(m[4]),
          logId: log.id,
        });
      }
    }

    // Plan Time Log block
    if (raw.includes("====== Plan")) {
      const pt = extractPlanTimeLog(raw);
      if (pt && pt.nodes.length) {
        planExecutions.push({ ...pt, time: log.t_ms, timeStr: log.t, logId: log.id });
      }
    }

    // Rule-based anomaly clustering
    if (log.ruleId) {
      const bucket = anomalyByRule[log.ruleId] || (anomalyByRule[log.ruleId] = {
        ruleId: log.ruleId, count: 0, firstTime: log.t_ms, lastTime: log.t_ms, samples: [], levels: {},
      });
      bucket.count++;
      bucket.lastTime = log.t_ms;
      bucket.levels[log.l] = (bucket.levels[log.l] || 0) + 1;
      if (bucket.samples.length < 5) {
        bucket.samples.push({ timeStr: log.t, message: raw, logId: log.id, level: log.l });
      }
    }
  }

  // build cycle list: time between consecutive "Entered plan" of same plan name
  const cyclesByPlan = {};
  for (let i = 0; i < planEntries.length; i++) {
    const e = planEntries[i];
    if (!cyclesByPlan[e.plan]) cyclesByPlan[e.plan] = [];
    cyclesByPlan[e.plan].push(e.time);
  }

  return {
    stateTimeline, planExecutions, planEntries,
    primitiveLoops, trajectoryPlans,
    anomalyByRule, cyclesByPlan,
  };
}

self.onmessage = async (e) => {
  const files = e.data;
  const allLogs = [];
  const sessions = [];

  try {
    let infoFound = null;

    for (let fIdx = 0; fIdx < files.length; fIdx++) {
      const file = files[fIdx];
      self.postMessage({ type: "progress", percent: Math.round((fIdx / files.length) * 80), status: `读取文件 ${file.name}` });

      const text = await file.text();
      const lines = text.split(/\r?\n/);
      const totalLines = lines.length;

      const sessionStart = allLogs.length;
      let sessionMinT = Infinity, sessionMaxT = -Infinity;
      let currentLog = null;

      for (let i = 0; i < totalLines; i += CHUNK_SIZE) {
        if (i % (CHUNK_SIZE * 5) === 0) {
          self.postMessage({
            type: "progress",
            percent: Math.round(((fIdx + i / totalLines) / files.length) * 80),
            status: `解析 ${file.name} ${Math.round((i / totalLines) * 100)}%`,
          });
        }
        const end = Math.min(i + CHUNK_SIZE, totalLines);
        for (let j = i; j < end; j++) {
          const line = lines[j];
          if (!line || !line.trim()) continue;
          const match = line.match(LOG_REGEX);
          if (match) {
            const t_ms = safeMs(match[1]);
            const level = match[2].toUpperCase();
            const parsed = parseModule(match[3]);
            currentLog = {
              t: match[1], t_ms, l: level,
              m: match[3], module: parsed.module, content: parsed.content,
              sessionId: fIdx,
            };
            // apply rules
            const ruleHit = applyRules(match[3], level);
            if (ruleHit) {
              currentLog.ruleId = ruleHit.rule.id;
              if (ruleHit.extra) Object.assign(currentLog, ruleHit.extra);
            }
            allLogs.push(currentLog);
            if (t_ms < sessionMinT) sessionMinT = t_ms;
            if (t_ms > sessionMaxT) sessionMaxT = t_ms;
            if (!infoFound && match[3].includes("sw ver")) infoFound = match[3];
          } else if (currentLog) {
            // continuation of multi-line entry (e.g. Plan Time Log block)
            currentLog.m += "\n" + line;
            currentLog.content += "\n" + line;
          }
        }
      }
      const sessionEnd = allLogs.length - 1;
      if (sessionEnd >= sessionStart) {
        sessions.push({
          id: fIdx,
          fileName: file.name,
          fileSize: file.size,
          startTime: sessionMinT === Infinity ? 0 : sessionMinT,
          endTime: sessionMaxT === -Infinity ? 0 : sessionMaxT,
          startIdx: sessionStart,
          endIdx: sessionEnd,
          logCount: sessionEnd - sessionStart + 1,
        });
      }
    }

    self.postMessage({ type: "progress", percent: 85, status: "按时间排序…" });
    // sort by time but stable across sessions (single file is already sorted; just merge sort by stable sort)
    allLogs.sort((a, b) => a.t_ms - b.t_ms || a.sessionId - b.sessionId);
    allLogs.forEach((log, idx) => { log.id = idx; });

    // recompute session idx ranges after sort
    sessions.forEach(s => { s.startIdx = -1; s.endIdx = -1; });
    for (let i = 0; i < allLogs.length; i++) {
      const s = sessions[allLogs[i].sessionId];
      if (s.startIdx === -1) s.startIdx = i;
      s.endIdx = i;
    }

    self.postMessage({ type: "progress", percent: 90, status: "聚合指标…" });

    // Per-session metrics
    const sessionMetrics = sessions.map(s => buildSessionMetrics(s, allLogs));
    sessions.forEach((s, i) => {
      const m = sessionMetrics[i];
      s.levelCounts = { DEBUG: 0, INFO: 0, WARNING: 0, ERROR: 0 };
      for (let k = s.startIdx; k <= s.endIdx; k++) {
        const lev = allLogs[k].l;
        if (s.levelCounts[lev] !== undefined) s.levelCounts[lev]++;
        else s.levelCounts[lev] = 1;
      }
      s.anomalyByRule = m.anomalyByRule;
      s.anomalyCount = Object.values(m.anomalyByRule).reduce((a, b) => a + b.count, 0);
      s.planExecCount = m.planExecutions.length;
      s.primitiveLoopWarnCount = m.primitiveLoops.length;
      s.trajectoryPlanCount = m.trajectoryPlans.length;
      // average / max cycle (Total Time of each plan exec)
      const totals = m.planExecutions.map(p => p.total).filter(t => Number.isFinite(t));
      s.cycleAvg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
      s.cycleMax = totals.length ? Math.max(...totals) : 0;
      s.cycleMin = totals.length ? Math.min(...totals) : 0;
      // detail arrays kept separate (streamed below as `metrics`)
      s._metrics = m;
    });

    // Stream raw logs in batches
    self.postMessage({
      type: "hydrate-start",
      payload: { total: allLogs.length, deviceInfo: infoFound || "Unknown Version" },
    });
    for (let i = 0; i < allLogs.length; i += STREAM_BATCH_SIZE) {
      const loaded = Math.min(i + STREAM_BATCH_SIZE, allLogs.length);
      self.postMessage({
        type: "log-batch",
        payload: {
          logs: allLogs.slice(i, loaded),
          loaded,
          total: allLogs.length,
          isLast: loaded >= allLogs.length,
        },
      });
      await new Promise(r => setTimeout(r, 5));
    }

    // Cross-session anomaly aggregation (for dashboard view)
    const globalAnomaly = {};
    sessions.forEach(s => {
      Object.values(s.anomalyByRule).forEach(b => {
        if (!globalAnomaly[b.ruleId]) {
          globalAnomaly[b.ruleId] = {
            ruleId: b.ruleId, count: 0,
            firstTime: b.firstTime, lastTime: b.lastTime,
            samples: [], sessions: [], levels: {},
          };
        }
        const g = globalAnomaly[b.ruleId];
        g.count += b.count;
        if (b.firstTime < g.firstTime) g.firstTime = b.firstTime;
        if (b.lastTime > g.lastTime) g.lastTime = b.lastTime;
        g.sessions.push(s.id);
        Object.entries(b.levels || {}).forEach(([lev, n]) => { g.levels[lev] = (g.levels[lev] || 0) + n; });
        if (g.samples.length < 5) g.samples.push(...b.samples.slice(0, 5 - g.samples.length));
      });
    });
    const anomalyClusters = Object.values(globalAnomaly).sort((a, b) => b.count - a.count);

    // Strip _metrics into a separate sessionDetails map to avoid bloating the summary
    const sessionDetails = sessions.map((s) => s._metrics);
    sessions.forEach(s => delete s._metrics);

    self.postMessage({
      type: "hydrate-complete",
      payload: {
        sessions,
        sessionDetails,
        anomalyClusters,
        rules: RULES.map(r => ({ id: r.id, name: r.name, category: r.category, severity: r.severity, description: r.description })),
        totals: {
          logs: allLogs.length,
          sessions: sessions.length,
          anomalies: anomalyClusters.reduce((a, b) => a + b.count, 0),
        },
        deviceInfo: infoFound || "Unknown Version",
      },
    });
  } catch (err) {
    self.postMessage({ type: "error", message: err.message + "\n" + (err.stack || "") });
  }
};
