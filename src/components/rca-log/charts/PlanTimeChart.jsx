import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// Simple color generator for dynamic nodes
const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', 
  '#ec4899', '#06b6d4', '#14b8a6', '#84cc16', '#a855f7'
];

export default function PlanTimeChart({ data }) {
  const { chartData, nodeKeys } = useMemo(() => {
    const nodeSet = new Set();
    const formatted = data.map((exec, idx) => {
      const row = {
        name: exec.plan,
        time: exec.time,
        timeStr: new Date(exec.time).toLocaleTimeString(),
        _idx: idx
      };
      exec.nodes.forEach(n => {
        row[n.node] = n.time;
        nodeSet.add(n.node);
      });
      return row;
    });
    return { chartData: formatted, nodeKeys: Array.from(nodeSet) };
  }, [data]);

  if (!data || data.length === 0) {
    return <div className="flex items-center justify-center h-full text-[#94a3b8]">暂无 Plan 执行耗时数据</div>;
  }

  return (
    <div className="flex flex-col h-full bg-[#1e222d] border border-[#334155] rounded-xl p-4">
      <h3 className="text-lg font-bold text-slate-200 mb-4">计划执行时间 (Plan Execution Time)</h3>
      <div className="flex-1 min-h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="timeStr" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" label={{ value: '耗时 (s)', angle: -90, position: 'insideLeft', fill: '#94a3b8' }} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f1117', borderColor: '#334155', color: '#e2e8f0' }}
              itemStyle={{ color: '#e2e8f0' }}
            />
            <Legend wrapperStyle={{ paddingTop: '20px' }} />
            {nodeKeys.map((key, index) => (
              <Bar key={key} dataKey={key} stackId="a" fill={COLORS[index % COLORS.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
