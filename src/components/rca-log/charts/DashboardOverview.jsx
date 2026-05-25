import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Activity, AlertTriangle, FileText, Clock, Zap } from 'lucide-react';

const COLORS = {
  ERROR: '#ef4444',
  WARN: '#f97316',
  WARNING: '#f97316',
  INFO: '#3b82f6',
  DEBUG: '#64748b',
  TRACE: '#8b5cf6'
};

export default function DashboardOverview({ summaryData, totalLines, timeRange }) {
  const pieData = useMemo(() => {
    if (!summaryData?.levelCounts) return [];
    return Object.entries(summaryData.levelCounts)
      .map(([name, value]) => ({ name, value }))
      .filter(d => d.value > 0);
  }, [summaryData]);

  if (!summaryData) return null;

  return (
    <div className="flex flex-col gap-6 p-6 h-full overflow-y-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#1e222d] border border-[#334155] rounded-xl p-5 flex items-center gap-4">
          <div className="p-3 bg-blue-500/20 text-blue-400 rounded-lg"><FileText size={24} /></div>
          <div>
            <div className="text-[#94a3b8] text-sm font-medium">总日志行数</div>
            <div className="text-2xl font-bold text-slate-100">{totalLines.toLocaleString()}</div>
          </div>
        </div>
        <div className="bg-[#1e222d] border border-[#334155] rounded-xl p-5 flex items-center gap-4">
          <div className="p-3 bg-red-500/20 text-red-400 rounded-lg"><AlertTriangle size={24} /></div>
          <div>
            <div className="text-[#94a3b8] text-sm font-medium">错误/警告</div>
            <div className="text-2xl font-bold text-slate-100">
              {((summaryData.levelCounts.ERROR || 0) + (summaryData.levelCounts.WARN || 0) + (summaryData.levelCounts.WARNING || 0)).toLocaleString()}
            </div>
          </div>
        </div>
        <div className="bg-[#1e222d] border border-[#334155] rounded-xl p-5 flex items-center gap-4">
          <div className="p-3 bg-emerald-500/20 text-emerald-400 rounded-lg"><Activity size={24} /></div>
          <div>
            <div className="text-[#94a3b8] text-sm font-medium">状态切换次数</div>
            <div className="text-2xl font-bold text-slate-100">{summaryData.stateTimeline.length.toLocaleString()}</div>
          </div>
        </div>
        <div className="bg-[#1e222d] border border-[#334155] rounded-xl p-5 flex items-center gap-4">
          <div className="p-3 bg-purple-500/20 text-purple-400 rounded-lg"><Zap size={24} /></div>
          <div>
            <div className="text-[#94a3b8] text-sm font-medium">计划执行批次</div>
            <div className="text-2xl font-bold text-slate-100">{summaryData.planExecutions.length.toLocaleString()}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[400px]">
        <div className="bg-[#1e222d] border border-[#334155] rounded-xl p-6 flex flex-col">
          <h3 className="text-lg font-bold text-slate-200 mb-4">日志级别分布</h3>
          <div className="flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={120}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) => name + " " + (percent * 100).toFixed(1) + "%"}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={"cell-" + index} fill={COLORS[entry.name] || COLORS.DEBUG} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f1117', borderColor: '#334155', color: '#e2e8f0' }}
                  itemStyle={{ color: '#e2e8f0' }}
                />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        <div className="bg-[#1e222d] border border-[#334155] rounded-xl p-6 flex flex-col">
          <h3 className="text-lg font-bold text-slate-200 mb-4">时间跨度</h3>
          <div className="flex-1 flex flex-col justify-center gap-6">
            <div className="flex items-center gap-4 bg-[#0f1117] p-4 rounded-lg border border-[#334155]">
              <Clock className="text-blue-400" size={32} />
              <div>
                <div className="text-sm text-[#94a3b8]">开始时间</div>
                <div className="text-xl font-mono text-slate-200">{timeRange[0] ? new Date(timeRange[0]).toLocaleString() : '-'}</div>
              </div>
            </div>
            <div className="flex items-center gap-4 bg-[#0f1117] p-4 rounded-lg border border-[#334155]">
              <Clock className="text-blue-400" size={32} />
              <div>
                <div className="text-sm text-[#94a3b8]">结束时间</div>
                <div className="text-xl font-mono text-slate-200">{timeRange[1] ? new Date(timeRange[1]).toLocaleString() : '-'}</div>
              </div>
            </div>
            <div className="flex items-center gap-4 bg-[#0f1117] p-4 rounded-lg border border-[#334155]">
              <Activity className="text-emerald-400" size={32} />
              <div>
                <div className="text-sm text-[#94a3b8]">总时长</div>
                <div className="text-xl font-mono text-slate-200">
                  {timeRange[0] && timeRange[1] ? 
                    ((timeRange[1] - timeRange[0]) / 1000 / 60 / 60).toFixed(2) + ' 小时' 
                  : '-'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
