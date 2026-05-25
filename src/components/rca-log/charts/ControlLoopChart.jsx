import React, { useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';

export default function ControlLoopChart({ data, timeRange }) {
  const stats = useMemo(() => {
    if (!data.length) return { max: 0, avg: 0, count: 0, timeoutCount: 0 };
    let max = 0;
    let sum = 0;
    let timeoutCount = 0;
    data.forEach(d => {
      if (d.cost > max) max = d.cost;
      sum += d.cost;
      if (d.cost > 1.0) timeoutCount++;
    });
    return {
      max: max.toFixed(2),
      avg: (sum / data.length).toFixed(3),
      count: data.length,
      timeoutCount
    };
  }, [data]);

  const getColor = (cost) => {
    if (cost > 1.0) return '#ef4444'; // Red
    if (cost >= 0.8) return '#f59e0b'; // Orange
    return '#3b82f6'; // Blue
  };

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-[#1e222d] border border-[#334155] p-3 rounded shadow-lg text-sm text-slate-200">
          <p className="mb-1"><span className="text-[#94a3b8]">时间:</span> {data.timeStr}</p>
          <p><span className="text-[#94a3b8]">耗时:</span> <span style={{ color: getColor(data.cost) }} className="font-bold">{data.cost} ms</span></p>
        </div>
      );
    }
    return null;
  };

  if (!data || data.length === 0) {
    return <div className="flex items-center justify-center h-full text-[#94a3b8]">暂无 PrimitiveLoop 耗时数据</div>;
  }

  return (
    <div className="flex flex-col h-full bg-[#1e222d] border border-[#334155] rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-slate-200">控制循环耗时监控 (Primitive Loop)</h3>
        <div className="flex gap-4 text-sm">
          <div className="text-slate-400">总计: <span className="text-slate-200 font-mono">{stats.count}</span></div>
          <div className="text-slate-400">平均: <span className="text-blue-400 font-mono">{stats.avg} ms</span></div>
          <div className="text-slate-400">最大: <span className="text-red-400 font-mono">{stats.max} ms</span></div>
          <div className="text-slate-400">超时(&gt;1ms): <span className="text-red-400 font-mono font-bold">{stats.timeoutCount}</span></div>
        </div>
      </div>
      
      <div className="flex-1 min-h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis 
              type="number" 
              dataKey="time" 
              domain={timeRange} 
              tickFormatter={(t) => {
                const d = new Date(t);
                return d.getHours().toString().padStart(2,'0') + ":" + d.getMinutes().toString().padStart(2,'0') + ":" + d.getSeconds().toString().padStart(2,'0');
              }} 
              stroke="#94a3b8"
            />
            <YAxis 
              type="number" 
              dataKey="cost" 
              name="耗时 (ms)"
              stroke="#94a3b8"
              domain={[0, 'dataMax + 0.5']}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3', stroke: '#64748b' }} />
            <ReferenceLine y={1.0} stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: '1.0ms 超时线', fill: '#ef4444', fontSize: 12 }} />
            <ReferenceLine y={0.8} stroke="#f59e0b" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: '0.8ms 警告线', fill: '#f59e0b', fontSize: 12 }} />
            <Scatter data={data} name="Time Cost">
              {data.map((entry, index) => (
                <Cell key={"cell-" + index} fill={getColor(entry.cost)} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
