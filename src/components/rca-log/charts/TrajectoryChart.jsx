import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function TrajectoryChart({ data, timeRange }) {
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const dataPoint = payload[0].payload;
      return (
        <div className="bg-[#1e222d] border border-[#334155] p-3 rounded shadow-lg text-sm text-slate-200">
          <p className="mb-2 font-bold text-slate-100">{dataPoint.target}</p>
          <p className="mb-1"><span className="text-[#94a3b8]">时间:</span> {dataPoint.timeStr}</p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }}>
              {entry.name}: <span className="font-mono">{entry.value} ms</span>
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  if (!data || data.length === 0) {
    return <div className="flex items-center justify-center h-full text-[#94a3b8]">暂无轨迹规划耗时数据</div>;
  }

  return (
    <div className="flex flex-col h-full bg-[#1e222d] border border-[#334155] rounded-xl p-4">
      <h3 className="text-lg font-bold text-slate-200 mb-4">轨迹规划耗时 (Trajectory Planning)</h3>
      <div className="flex-1 min-h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis 
              dataKey="time" 
              type="number"
              domain={timeRange}
              tickFormatter={(t) => {
                const d = new Date(t);
                return d.getHours().toString().padStart(2,'0') + ":" + d.getMinutes().toString().padStart(2,'0') + ":" + d.getSeconds().toString().padStart(2,'0');
              }}
              stroke="#94a3b8" 
            />
            <YAxis stroke="#94a3b8" label={{ value: '耗时 (ms)', angle: -90, position: 'insideLeft', fill: '#94a3b8' }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ paddingTop: '20px' }} />
            <Line type="monotone" dataKey="total" name="总耗时 (Total)" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="path" name="路径耗时 (Path)" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="ready" name="准备耗时 (Ready)" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
