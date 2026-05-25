import React, { useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const STATE_COLORS = {
  WORKING_EXTERNAL_AUTO: '#10b981', // green
  STOPPED_EXTERNAL_AUTO: '#f59e0b', // yellow
  STOPPED_MANUAL: '#f59e0b',
  FAULT_EXTERNAL_AUTO: '#ef4444',   // red
  FAULT_MANUAL: '#ef4444',
  INIT: '#3b82f6',                  // blue
  FREEDRIVE_MANUAL: '#8b5cf6',      // purple
  UNKNOWN: '#94a3b8'
};

function getColor(state) {
  if (STATE_COLORS[state]) return STATE_COLORS[state];
  if (state.startsWith('STOPPED')) return '#f59e0b';
  if (state.startsWith('FAULT')) return '#ef4444';
  if (state.startsWith('FREEDRIVE')) return '#8b5cf6';
  return '#94a3b8';
}

const CustomRect = (props) => {
  const { cx, cy, xAxis, yAxis, payload, height = 20 } = props;
  const startX = xAxis.scale(payload.start);
  const endX = xAxis.scale(payload.end);
  const y = cy - height / 2;
  const width = Math.max(endX - startX, 2); // At least 2px wide

  return (
    <rect 
      x={startX} 
      y={y} 
      width={width} 
      height={height} 
      fill={getColor(payload.state)} 
      rx={2}
      ry={2}
    />
  );
};

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const duration = ((data.end - data.start) / 1000).toFixed(2);
    return (
      <div className="bg-[#1e222d] border border-[#334155] p-3 rounded shadow-lg text-sm text-slate-200">
        <p className="font-bold mb-1" style={{ color: getColor(data.state) }}>{data.state}</p>
        <p><span className="text-[#94a3b8]">开始:</span> {data.timeStr}</p>
        <p><span className="text-[#94a3b8]">时长:</span> {duration} s</p>
      </div>
    );
  }
  return null;
};

export default function StateTimeline({ data, timeRange }) {
  const states = useMemo(() => Array.from(new Set(data.map(d => d.state))), [data]);
  
  // Need to map data so Scatter knows where to place them on Y axis
  const mappedData = useMemo(() => {
    return data.map(d => ({
      ...d,
      yIndex: states.indexOf(d.state)
    }));
  }, [data, states]);

  if (!data || data.length === 0) {
    return <div className="flex items-center justify-center h-full text-[#94a3b8]">暂无状态切换数据</div>;
  }

  return (
    <div className="flex flex-col h-full bg-[#1e222d] border border-[#334155] rounded-xl p-4">
      <h3 className="text-lg font-bold text-slate-200 mb-4">系统状态机时间线 (State Machine)</h3>
      <div className="flex-1 min-h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 180 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis 
              type="number" 
              dataKey="start" 
              domain={timeRange} 
              tickFormatter={(t) => {
                const d = new Date(t);
                return d.getHours().toString().padStart(2,'0') + ":" + d.getMinutes().toString().padStart(2,'0') + ":" + d.getSeconds().toString().padStart(2,'0');
              }} 
              stroke="#94a3b8"
            />
            <YAxis 
              type="category" 
              dataKey="state" 
              allowDuplicatedCategory={false}
              stroke="#94a3b8"
              tick={{ fontSize: 11 }}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3', stroke: '#64748b' }} />
            <Scatter data={mappedData} shape={<CustomRect />} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
