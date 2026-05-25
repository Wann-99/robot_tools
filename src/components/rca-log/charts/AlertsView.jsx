import React, { useState } from 'react';
import { AlertTriangle, AlertCircle, ChevronDown, ChevronRight, Eye } from 'lucide-react';

export default function AlertsView({ data, onLogClick }) {
  const [expanded, setExpanded] = useState({});

  const toggleExpand = (type) => {
    setExpanded(prev => ({ ...prev, [type]: !prev[type] }));
  };

  if (!data || data.length === 0) {
    return <div className="flex items-center justify-center h-full text-[#94a3b8]">暂无警告/错误数据</div>;
  }

  return (
    <div className="flex flex-col h-full bg-[#1e222d] border border-[#334155] rounded-xl p-4 overflow-hidden">
      <h3 className="text-lg font-bold text-slate-200 mb-4 flex-shrink-0">异常事件列表 ({data.length})</h3>
      <div className="flex-1 overflow-y-auto pr-2 space-y-3">
        {data.map((alert, idx) => {
          const isError = alert.level === 'ERROR';
          const isWarning = alert.level === 'WARN' || alert.level === 'WARNING';
          
          // Special cases
          const isVisionTimeout = alert.type === 'VisionTriggerTimeout';
          const isGripperStartup = alert.type === 'GripperCommErrStartup';
          
          let bgColor = 'bg-slate-800/50';
          let borderColor = 'border-slate-700';
          let iconColor = 'text-slate-400';
          let badgeColor = 'bg-slate-700 text-slate-300';
          
          if (isGripperStartup) {
            bgColor = 'bg-blue-900/20';
            borderColor = 'border-blue-800/50';
            iconColor = 'text-blue-400';
            badgeColor = 'bg-blue-500/20 text-blue-400';
          } else if (isVisionTimeout) {
            bgColor = 'bg-slate-800/50';
            borderColor = 'border-slate-700';
            iconColor = 'text-slate-500';
            badgeColor = 'bg-slate-700 text-slate-400';
          } else if (isError) {
            bgColor = 'bg-red-900/10';
            borderColor = 'border-red-900/30';
            iconColor = 'text-red-400';
            badgeColor = 'bg-red-500/20 text-red-400';
          } else if (isWarning) {
            bgColor = 'bg-orange-900/10';
            borderColor = 'border-orange-900/30';
            iconColor = 'text-orange-400';
            badgeColor = 'bg-orange-500/20 text-orange-400';
          }

          const isExp = expanded[alert.type];

          return (
            <div key={idx} className={"border rounded-lg " + bgColor + " " + borderColor + " transition-colors"}>
              <div 
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/5"
                onClick={() => toggleExpand(alert.type)}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  {isExp ? <ChevronDown size={16} className="text-slate-500 flex-shrink-0" /> : <ChevronRight size={16} className="text-slate-500 flex-shrink-0" />}
                  {isError ? <AlertTriangle size={18} className={iconColor} /> : <AlertCircle size={18} className={iconColor} />}
                  <div className="truncate font-mono text-sm text-slate-200" title={alert.type}>
                    {alert.type}
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0 pl-4">
                  <div className="text-xs text-slate-500 hidden sm:block">首次出现: {alert.firstTime}</div>
                  <div className={"px-2.5 py-0.5 rounded-full text-xs font-bold " + badgeColor}>
                    {alert.count} 次
                  </div>
                </div>
              </div>
              
              {isExp && (
                <div className="px-4 pb-4 pt-1 border-t border-white/5">
                  <div className="text-xs font-bold text-slate-500 mb-2 mt-2">最近记录 (最多显示5条):</div>
                  <div className="space-y-2">
                    {alert.messages.map((msg, i) => (
                      <div key={i} className="bg-[#0f1117] rounded p-2 text-xs font-mono text-slate-300 break-all flex items-start gap-2 group">
                        <div className="text-slate-500 whitespace-nowrap">[{msg.timeStr}]</div>
                        <div className="flex-1">{msg.message}</div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); onLogClick(msg.logId); }}
                          className="opacity-0 group-hover:opacity-100 p-1 bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/40 transition-all flex-shrink-0"
                          title="在原始日志中查看上下文"
                        >
                          <Eye size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
