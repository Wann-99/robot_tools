import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Network,
  Server,
  FolderOpen,
  Download,
  RefreshCw,
  Folder,
  FileText,
  ChevronRight,
  Terminal,
  Key,
  User,
  Shield,
  AlertCircle,
  CheckCircle2,
  TerminalSquare,
  Search,
  Calendar,
  Clock,
  X,
  Wifi,
  CornerUpLeft
} from "lucide-react";

function DeploymentGuide({ onCheck, onConfigureBackend, currentBackend }) {
  const serverJsCode = `const express = require('express');
const cors = require('cors');
const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Log Fetcher Proxy is running', version: '1.3.2' });
});

app.get('/api/scan', (req, res) => {
  const { exec } = require('child_process');
  exec('arp -a', (err, stdout) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    const ips = new Set();
    const regex = /([0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+)/g;
    let match;
    while ((match = regex.exec(stdout)) !== null) {
      const ip = match[1];
      if (!ip.startsWith('224.') && !ip.startsWith('239.') && !ip.startsWith('255.') && !ip.endsWith('.255') && ip !== '127.0.0.1') {
        ips.add(ip);
      }
    }
    res.json({ success: true, data: Array.from(ips) });
  });
});

app.get('/api/select-folder', (req, res) => {
  const { execFile } = require('child_process');
  const platform = process.platform;
  if (platform === 'win32') {
    const psScript = \`
      Add-Type -AssemblyName System.windows.forms
      \\$owner = New-Object System.Windows.Forms.Form
      \\$owner.TopMost = \\$true
      \\$owner.Opacity = 0
      \\$owner.ShowInTaskbar = \\$false
      \\$owner.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
      \\$owner.Show()
      \\$owner.WindowState = [System.Windows.Forms.FormWindowState]::Normal
      \\$owner.Activate()
      \\$owner.BringToFront()
      \\$f = New-Object System.Windows.Forms.OpenFileDialog
      \\$f.Title = "请选择本地保存路径 (进入目标文件夹后点击打开)"
      \\$f.ValidateNames = \\$false
      \\$f.CheckFileExists = \\$false
      \\$f.CheckPathExists = \\$true
      \\$f.FileName = "选择此文件夹"
      if (\\$f.ShowDialog(\\$owner) -eq [System.Windows.Forms.DialogResult]::OK) {
          Write-Output ([System.IO.Path]::GetDirectoryName(\\$f.FileName))
      }
      \\$owner.Close()
    \`;
    const b64 = Buffer.from(psScript, 'utf16le').toString('base64');
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64], (error, stdout) => {
      const selectedPath = (stdout || '').trim();
      if (selectedPath) {
        res.json({ success: true, path: selectedPath });
      } else if (error) {
        res.status(500).json({ success: false, error: error.message });
      } else {
        res.json({ success: false, error: '未选择路径或发生错误' });
      }
    });
    return;
  }

  if (platform === 'darwin') {
    execFile(
      'osascript',
      [
        '-e',
        'tell application \"Finder\" to activate',
        '-e',
        'POSIX path of (choose folder with prompt \"请选择本地保存路径\")'
      ],
      (error, stdout) => {
        const selectedPath = (stdout || '').trim().replace(/\\/$/, '');
        if (selectedPath) {
          res.json({ success: true, path: selectedPath });
        } else if (error) {
          res.status(500).json({ success: false, error: error.message });
        } else {
          res.json({ success: false, error: '未选择路径或发生错误' });
        }
      }
    );
    return;
  }

  res.status(400).json({ success: false, error: '当前系统暂不支持文件夹选择窗口，请手动输入本地保存路径。' });
});

app.post('/api/connect', async (req, res) => {
  const { protocol, host, port, username, password, path: remotePath } = req.body;
  if (protocol === 'FTP') {
    const client = new ftp.Client();
    client.ftp.verbose = false;
    try {
      await client.access({
        host,
        port: parseInt(port) || 21,
        user: username,
        password,
        secure: false
      });
      await client.cd(remotePath || '/');
      const list = await client.list();
      const files = list.map(item => ({
        name: item.name,
        size: item.size,
        date: item.rawModifiedAt || item.modifiedAt || '未知时间',
        type: item.isDirectory ? 'folder' : 'file'
      }));
      res.json({ success: true, data: files });
    } catch (err) {
      let errorMsg = err.message;
      if (err.code === 'ECONNREFUSED' || errorMsg.includes('ECONNREFUSED')) {
        errorMsg = \`目标设备拒绝连接 (\${host}:\${port})，请检查IP地址和端口是否正确，以及设备是否开启了FTP服务。\`;
      } else if (err.code === 'ETIMEDOUT' || errorMsg.includes('Timeout')) {
        errorMsg = \`连接目标设备 (\${host}:\${port}) 超时，请检查设备是否在线且处于同一局域网。\`;
      }
      if (!res.headersSent) res.status(500).json({ success: false, error: errorMsg });
    } finally {
      client.close();
    }
  } else {
    res.status(500).json({ success: false, error: \`代理服务暂未完全实现 [\${protocol}] 协议，请使用 FTP 协议抓取。\` });
  }
});

app.post('/api/download', async (req, res) => {
  const { protocol, host, port, username, password, path: remotePath, localPath, fileName, type } = req.body;
  if (protocol === 'FTP') {
    const client = new ftp.Client();
    client.ftp.verbose = false;
    try {
      await client.access({
        host,
        port: parseInt(port) || 21,
        user: username,
        password,
        secure: false
      });
      await client.cd(remotePath || '/');
      
      const resolvedLocalPath = path.resolve(localPath);
      if (!fs.existsSync(resolvedLocalPath)) {
        return res.status(400).json({ success: false, error: \`指定的本地保存路径不存在：\${resolvedLocalPath}\` });
      }
      
      const stats = fs.statSync(resolvedLocalPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ success: false, error: \`指定的本地保存路径不是一个有效的目录：\${resolvedLocalPath}\` });
      }
      
      const localFilePath = path.join(resolvedLocalPath, fileName);
      if (type === 'folder') {
        if (!fs.existsSync(localFilePath)) {
          fs.mkdirSync(localFilePath, { recursive: true });
        }
        await client.downloadToDir(localFilePath, fileName);
      } else {
        await client.downloadTo(localFilePath, fileName);
      }
      
      res.json({ success: true, localFilePath });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.close();
    }
  } else {
    res.status(500).json({ success: false, error: '暂仅支持 FTP 协议下载' });
  }
});

app.listen(PORT, () => {
  console.log('=========================================');
  console.log('🚀 Log Fetcher 代理服务已启动!');
  console.log(\`📡 监听端口: http://localhost:\${PORT}\`);
  console.log('✅ 现在您可以返回浏览器继续抓取日志了');
  console.log('=========================================');
});`;

  const downloadScript = () => {
    const blob = new Blob([serverJsCode], { type: "text/javascript;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "server.js";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto bg-slate-50 p-6">
      <div className="w-full max-w-3xl rounded-[24px] border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50">
        <div className="mb-6 flex items-center gap-4 border-b border-slate-100 pb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <Server size={28} />
          </div>
          <div className="flex flex-1 items-end justify-between">
            <h2 className="text-xl font-black text-slate-800">需要启动本地代理服务</h2>
            <span className="text-sm font-medium text-slate-500">（如已有环境直接运行即可）</span>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 text-sm font-bold text-slate-700">步骤 1：下载代理服务脚本</h3>
              <button 
                onClick={downloadScript}
                className="flex items-center gap-2 rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-slate-700"
              >
                <Download size={16} /> 下载 server.js
              </button>
              <p className="mt-2 text-xs text-slate-500">请将下载的文件保存到您电脑上的一个新建文件夹中。</p>
            </div>

            <div>
              <h3 className="mb-2 mt-6 text-sm font-bold text-slate-700">步骤 2：安装依赖并运行</h3>
              <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#1e1e1e] shadow-inner">
                <div className="flex items-center gap-2 border-b border-slate-700 bg-slate-800/50 px-4 py-2 text-xs text-slate-400">
                  <TerminalSquare size={14} /> 进入下载路径，在当前文件夹内打开终端（或 CMD）并运行：
                </div>
                <div className="p-5 font-mono text-sm leading-8 text-slate-300">
                  <div className="flex">
                    <span className="mr-3 select-none text-emerald-400">$</span>
                    <span>npm install express cors basic-ftp</span>
                    <span className="ml-4 select-none text-slate-500"># 安装所需依赖</span>
                  </div>
                  <div className="flex">
                    <span className="mr-3 select-none text-emerald-400">$</span>
                    <span>node server.js</span>
                    <span className="ml-4 select-none text-slate-500"># 启动服务 (监听 3001 端口)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1 text-xs text-slate-500">
            <span>当前后端地址：<code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700">{currentBackend || "http://localhost:3001"}</code></span>
            {onConfigureBackend && (
              <button onClick={onConfigureBackend} className="self-start text-blue-600 hover:underline">
                改用其他后端地址（局域网设备 / Cloudflare Tunnel）→
              </button>
            )}
          </div>
          <button
            onClick={onCheck}
            className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-md shadow-blue-200 transition-all hover:-translate-y-0.5 hover:bg-blue-700"
          >
            <RefreshCw size={18} /> 我已启动服务，重新检测
          </button>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_BACKEND = "http://localhost:3001";
const BACKEND_STORAGE_KEY = "LOG_FETCHER_BACKEND_URL";

// Strip trailing slash so callers can do `${backend}/api/...`
function normalizeBackend(url) {
  return (url || DEFAULT_BACKEND).replace(/\/+$/, "");
}

export default function LogFetcherTool() {
  const [backendUrl, setBackendUrl] = useState(() =>
    normalizeBackend(localStorage.getItem(BACKEND_STORAGE_KEY) || DEFAULT_BACKEND)
  );
  const [backendStatus, setBackendStatus] = useState("checking"); // checking, online, offline
  const [showBackendConfig, setShowBackendConfig] = useState(false);
  const [backendInput, setBackendInput] = useState(backendUrl);

  const saveBackendUrl = (url) => {
    const u = normalizeBackend(url);
    setBackendUrl(u);
    localStorage.setItem(BACKEND_STORAGE_KEY, u);
    setShowBackendConfig(false);
    setBackendStatus("checking");
  };
  const resetBackendUrl = () => saveBackendUrl(DEFAULT_BACKEND);

  const [config, setConfig] = useState({
    protocol: "FTP",
    host: "192.168.1.100",
    port: "21",
    username: "qnxuser",
    password: "",
    path: "/programs/log",
    localPath: ""
  });
  
  const [status, setStatus] = useState("disconnected"); // disconnected, connecting, connected, error
  const [errorMsg, setErrorMsg] = useState("");
  const [fileList, setFileList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectingFolder, setSelectingFolder] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState([]);

  const abortControllerRef = useRef(null);
  const [scannedIPs, setScannedIPs] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [showIpDropdown, setShowIpDropdown] = useState(false);

  // Filters
  const [filterName, setFilterName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [latestOnly, setLatestOnly] = useState(false);

  const processedList = useMemo(() => {
    let list = [...fileList];

    // 1. 按名称过滤
    if (filterName) {
      const lowerName = filterName.toLowerCase();
      list = list.filter(item => item.name.toLowerCase().includes(lowerName));
    }

    // 2. 按日期区间过滤
    if (startDate || endDate) {
      const startT = startDate ? new Date(`${startDate}T00:00:00`).getTime() : 0;
      const endT = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : Infinity;
      
      list = list.filter(item => {
        if (!item.date || item.date === "未知时间") return true;
        const itemT = new Date(item.date).getTime();
        if (isNaN(itemT)) return true;
        return itemT >= startT && itemT <= endT;
      });
    }

    // 3. 最新日期过滤
    if (latestOnly && list.length > 0) {
      let maxDateStr = "";
      let maxT = 0;
      
      // 找出列表中最晚的日期(YYYY-MM-DD)
      list.forEach(item => {
        if (!item.date || item.date === "未知时间") return;
        const itemT = new Date(item.date).getTime();
        if (!isNaN(itemT) && itemT > maxT) {
          maxT = itemT;
          const d = new Date(item.date);
          maxDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
      });
      
      if (maxDateStr) {
        list = list.filter(item => {
          if (!item.date || item.date === "未知时间") return false;
          const itemT = new Date(item.date).getTime();
          if (isNaN(itemT)) return false;
          const d = new Date(item.date);
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          return dateStr === maxDateStr;
        });
      }
    }

    return list;
  }, [fileList, filterName, startDate, endDate, latestOnly]);

  const appendLog = (type, msg) => {
    setTerminalLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), type, msg }]);
  };

  const checkBackend = async () => {
    setBackendStatus("checking");
    try {
      const res = await fetch(`${backendUrl}/api/health`, { timeout: 2000 });
      if (res.ok) {
        setBackendStatus("online");
        appendLog("success", "本地代理服务检测成功，已连接。");
      } else {
        setBackendStatus("offline");
      }
    } catch (e) {
      setBackendStatus("offline");
    }
  };

  useEffect(() => {
    checkBackend();

    const interval = setInterval(() => {
      fetch(`${backendUrl}/api/health`, { timeout: 2000 })
        .then(res => {
          if (!res.ok) {
            setBackendStatus("offline");
            setStatus("disconnected");
          } else {
            setBackendStatus("online");
          }
        })
        .catch(() => {
          setBackendStatus("offline");
          setStatus("disconnected");
        });
    }, 3000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl]);

  useEffect(() => { appendLog("info", "Log Fetcher 界面初始化..."); }, []);

  const handleSelectFolder = async () => {
    setSelectingFolder(true);
    try {
      const res = await fetch(`${backendUrl}/api/select-folder`);
      const data = await res.json();
      if (data.success && data.path) {
        setConfig(prev => ({ ...prev, localPath: data.path }));
        appendLog("success", `已选择本地保存路径: ${data.path}`);
      }
    } catch (err) {
      appendLog("error", "无法打开文件夹选择窗口，请确保已更新并运行最新版的 server.js");
    } finally {
      setSelectingFolder(false);
    }
  };

  const handleConnect = async (eOrPath) => {
    let targetPath = config.path;
    if (typeof eOrPath === 'string') {
      targetPath = eOrPath;
      setConfig(prev => ({ ...prev, path: targetPath }));
    }

    setStatus("connecting");
    setLoading(true);
    setErrorMsg("");
    setFileList([]);
    appendLog("info", `[${config.protocol}] 正在尝试连接 ${config.host}:${config.port}...`);

    abortControllerRef.current = new AbortController();

    try {
      const fetchConfig = { ...config, path: targetPath };
      const res = await fetch(`${backendUrl}/api/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fetchConfig),
        signal: abortControllerRef.current.signal
      });
      const data = await res.json();
      
      if (data.success) {
        setStatus("connected");
        appendLog("success", `连接成功！已获取 ${data.data.length} 个文件/目录`);
        
        // 处理并排序文件列表：文件夹在前，文件在后
        const processed = data.data.map(item => ({
          ...item,
          displaySize: item.type === "folder" ? "-" : (item.size / 1024).toFixed(1) + " KB"
        })).sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === "folder" ? -1 : 1;
        });
        
        setFileList(processed);
      } else {
        setStatus("error");
        setErrorMsg(data.error || "连接被拒绝");
        appendLog("error", `连接失败: ${data.error}`);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      setStatus("error");
      setErrorMsg("请求代理服务失败: " + err.message);
      appendLog("error", `网络请求错误: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setStatus("disconnected");
    setLoading(false);
    appendLog("info", "已手动取消连接。");
  };

  const handleScan = async () => {
    setScanning(true);
    setShowIpDropdown(true);
    try {
      const res = await fetch(`${backendUrl}/api/scan`);
      
      // 检查返回的内容类型，防止因代理未更新导致返回HTML
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("后台服务版本过低，请重新下载并运行最新的 server.js");
      }
      
      const data = await res.json();
      if (data.success) {
        setScannedIPs(data.data);
        appendLog("success", `局域网扫描完成，发现 ${data.data.length} 个可用 IP。`);
      } else {
        appendLog("error", `扫描失败: ${data.error}`);
      }
    } catch (err) {
      appendLog("error", `扫描请求失败: ${err.message}`);
    } finally {
      setScanning(false);
    }
  };

  const handleItemClick = (item) => {
    if (item.type === 'folder') {
      const currentPath = config.path.endsWith('/') ? config.path : config.path + '/';
      const newPath = currentPath + item.name;
      handleConnect(newPath);
    }
  };

  const handleDownload = async (item, e) => {
    e.stopPropagation();
    if (!config.localPath) {
      alert("请先选择或输入本地保存路径");
      setErrorMsg("请先在左侧配置【本地保存路径】");
      appendLog("error", "未配置本地保存路径，无法下载。");
      return;
    }
    appendLog("info", `开始下载${item.type === 'folder' ? '文件夹' : '文件'}: ${item.name} ...`);
    
    try {
      const res = await fetch(`${backendUrl}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...config,
          fileName: item.name,
          type: item.type
        })
      });
      const data = await res.json();
      if (data.success) {
        appendLog("success", `下载成功: ${file.name} 已保存至 ${data.localFilePath}`);
      } else {
        appendLog("error", `下载失败: ${data.error}`);
      }
    } catch (err) {
      appendLog("error", `网络请求错误: ${err.message}`);
    }
  };

  const handleDisconnect = () => {
    setStatus("disconnected");
    setFileList([]);
    setErrorMsg("");
    appendLog("info", "已断开与设备的连接。");
  };

  if (backendStatus === "checking") {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4 text-slate-500">
          <RefreshCw size={32} className="animate-spin text-blue-500" />
          <p className="font-medium">正在检测本地环境...</p>
        </div>
      </div>
    );
  }

  if (backendStatus === "offline") {
    return (
      <>
        <DeploymentGuide onCheck={checkBackend} onConfigureBackend={() => { setBackendInput(backendUrl); setShowBackendConfig(true); }} currentBackend={backendUrl} />
        {showBackendConfig && (
          <BackendConfigModal
            value={backendInput}
            onChange={setBackendInput}
            onSave={() => saveBackendUrl(backendInput)}
            onReset={resetBackendUrl}
            onClose={() => setShowBackendConfig(false)}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden bg-[#f8fbff] p-4 sm:p-6 lg:p-8">
      <header className="z-10 flex flex-shrink-0 flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600">
              <Network size={26} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-800">局域网日志抓取 (Log Fetcher)</h1>
              <p className="text-xs font-medium text-slate-500">通过 FTP / Telnet 协议远程拉取设备日志</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setBackendInput(backendUrl); setShowBackendConfig(true); }}
              className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
              title={`点击切换后端地址（当前：${backendUrl}）`}
            >
              <CheckCircle2 size={14} /> 代理服务已就绪
              <span className="ml-1 max-w-[180px] truncate font-mono text-[10px] font-normal text-emerald-600/80">{backendUrl.replace(/^https?:\/\//, "")}</span>
            </button>
            <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
              status === "connected" ? "bg-blue-50 text-blue-600" :
              status === "connecting" ? "bg-amber-50 text-amber-600" :
              status === "error" ? "bg-red-50 text-red-600" :
              "bg-slate-100 text-slate-500"
            }`}>
              <div className={`h-2 w-2 rounded-full ${
                status === "connected" ? "bg-blue-500" :
                status === "connecting" ? "animate-pulse bg-amber-500" :
                status === "error" ? "bg-red-500" :
                "bg-slate-400"
              }`} />
              {status === "connected" ? "设备已连接" :
               status === "connecting" ? "正在连接设备..." :
               status === "error" ? "设备连接失败" : "设备未连接"}
            </div>
          </div>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-12 min-h-0">
        {/* Left Sidebar: Connection Config */}
        <div className="flex flex-col gap-4 lg:col-span-3 overflow-y-auto pr-1">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-800">
              <Server size={16} className="text-slate-400" /> 连接配置
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600">协议</label>
                <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                  {["FTP", "Telnet", "SFTP"].map(p => (
                    <button
                      key={p}
                      onClick={() => {
                        setConfig({ 
                          ...config, 
                          protocol: p, 
                          port: p === "FTP" ? "21" : p === "Telnet" ? "23" : "22",
                          path: p === "FTP" ? "/programs/log" : p === "Telnet" ? "/root/mnt/programs/log" : config.path,
                          username: p === "FTP" ? "qnxuser" : p === "Telnet" ? "root" : config.username
                        });
                        if (status === "connected") setStatus("disconnected");
                      }}
                      className={`flex-1 rounded-md py-1.5 text-xs font-bold transition-all ${
                        config.protocol === p ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <label className="mb-1.5 block text-xs font-bold text-slate-600">主机 IP</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={config.host}
                      onChange={e => {
                        setConfig({ ...config, host: e.target.value });
                        if (status === "connected") setStatus("disconnected");
                      }}
                      onFocus={() => { if (scannedIPs.length > 0) setShowIpDropdown(true); }}
                      onBlur={() => setTimeout(() => setShowIpDropdown(false), 200)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3 pr-8 text-sm font-mono focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                      placeholder="192.168.x.x"
                    />
                    <button
                      onClick={handleScan}
                      title="扫描局域网IP"
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                    >
                      <Wifi size={14} className={scanning ? "animate-pulse text-emerald-500" : ""} />
                    </button>
                  </div>
                  {showIpDropdown && (
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                      {scanning ? (
                        <div className="py-2 text-center text-xs text-slate-500">正在扫描局域网...</div>
                      ) : scannedIPs.length === 0 ? (
                        <div className="py-2 text-center text-xs text-slate-500">未发现其他设备</div>
                      ) : (
                        scannedIPs.map(ip => (
                          <button
                            key={ip}
                            onClick={() => { 
                              setConfig({...config, host: ip}); 
                              setShowIpDropdown(false);
                              if (status === "connected") setStatus("disconnected");
                            }}
                            className="w-full rounded-md px-3 py-1.5 text-left font-mono text-sm text-slate-700 hover:bg-slate-100"
                          >
                            {ip}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <div className="w-20">
                  <label className="mb-1.5 block text-xs font-bold text-slate-600">端口</label>
                  <input
                    type="text"
                    value={config.port}
                    onChange={e => {
                      setConfig({ ...config, port: e.target.value });
                      if (status === "connected") setStatus("disconnected");
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1 text-xs font-bold text-slate-600">
                  <User size={12} /> 用户名
                </label>
                <input
                  type="text"
                  value={config.username}
                  onChange={e => {
                    setConfig({ ...config, username: e.target.value });
                    if (status === "connected") setStatus("disconnected");
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                />
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1 text-xs font-bold text-slate-600">
                  <Key size={12} /> 密码
                </label>
                <input
                  type="password"
                  value={config.password}
                  onChange={e => {
                    setConfig({ ...config, password: e.target.value });
                    if (status === "connected") setStatus("disconnected");
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                />
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1 text-xs font-bold text-slate-600">
                  <FolderOpen size={12} /> 远程抓取路径
                </label>
                <input
                  type="text"
                  value={config.path}
                  onChange={e => {
                    setConfig({ ...config, path: e.target.value });
                    if (status === "connected") setStatus("disconnected");
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  placeholder="例如: /var/log"
                />
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1 text-xs font-bold text-slate-600">
                  <Download size={12} /> 本地保存路径
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={config.localPath}
                    onChange={e => setConfig({ ...config, localPath: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                    placeholder="例如: D:\DownloadedLogs"
                  />
                  <button
                    onClick={handleSelectFolder}
                    disabled={selectingFolder}
                    className="flex-shrink-0 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[56px]"
                  >
                    {selectingFolder ? (
                      <RefreshCw size={14} className="animate-spin text-slate-500" />
                    ) : "选择"}
                  </button>
                </div>
              </div>

              <div className="pt-2">
                {status === "connected" ? (
                  <button
                    onClick={handleDisconnect}
                    className="w-full rounded-xl bg-slate-100 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-200"
                  >
                    断开连接
                  </button>
                ) : status === "connecting" ? (
                  <button
                    onClick={handleCancel}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-500 py-2.5 text-sm font-bold text-white shadow-sm shadow-red-200 transition-colors hover:bg-red-600"
                  >
                    <X size={16} /> 取消连接
                  </button>
                ) : (
                  <button
                    onClick={handleConnect}
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white shadow-sm shadow-emerald-200 transition-colors hover:bg-emerald-700 disabled:opacity-70"
                  >
                    <Network size={16} /> 连接设备
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Middle Content: File Browser */}
        <div className="flex flex-col gap-4 lg:col-span-6 min-h-0">
          <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div className="flex items-center gap-2 flex-1">
                {config.path && config.path !== '/' ? (
                  <button 
                    onClick={() => {
                      const parts = config.path.split('/').filter(Boolean);
                      parts.pop();
                      const newPath = parts.length > 0 ? '/' + parts.join('/') : '/';
                      handleConnect(newPath);
                    }}
                    title="返回上一级"
                    className="flex-shrink-0 rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  >
                    <CornerUpLeft size={16} />
                  </button>
                ) : (
                  <FolderOpen size={16} className="text-slate-400 flex-shrink-0 ml-1.5" />
                )}
                
                <div className="h-4 w-px bg-slate-200 mx-1"></div>
                
                <div className="flex items-center gap-1 text-sm font-medium text-slate-600 flex-1">
                  <span className="text-slate-400 font-mono flex-shrink-0">{config.host}</span>
                  <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
                  <input 
                    type="text" 
                    value={config.path}
                    onChange={e => {
                      setConfig({ ...config, path: e.target.value });
                      if (status === "connected") setStatus("disconnected");
                    }}
                    className="w-full bg-transparent font-mono text-slate-700 focus:outline-none"
                  />
                </div>
              </div>
              <button 
                disabled={status !== "connected"} 
                onClick={() => handleConnect(config.path)}
                className="flex-shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 ml-2"
              >
                <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              </button>
            </div>

            {status === "connected" && (
              <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50/50 px-5 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
                    <input 
                      type="text" 
                      placeholder="搜索文件..." 
                      value={filterName}
                      onChange={e => setFilterName(e.target.value)}
                      className="w-36 rounded-md border border-slate-200 py-1.5 pl-7 pr-2 text-xs focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
                    />
                  </div>
                </div>
                
                <div className="h-4 w-px bg-slate-200 mx-1"></div>

                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-slate-400" />
                  <div className="flex items-center rounded-md border border-slate-200 bg-white">
                    <input 
                      type="date" 
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      className="w-28 rounded-l-md border-r border-slate-200 px-2 py-1.5 text-xs focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
                    />
                    <input 
                      type="date" 
                      value={endDate}
                      onChange={e => setEndDate(e.target.value)}
                      className="w-28 rounded-r-md px-2 py-1.5 text-xs focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
                    />
                  </div>
                </div>
                
                <div className="ml-auto">
                  <button 
                    onClick={() => setLatestOnly(!latestOnly)}
                    className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-bold transition-all ${
                      latestOnly 
                        ? "border-blue-200 bg-blue-50 text-blue-600 shadow-sm" 
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    <Clock size={14} className={latestOnly ? "text-blue-500" : "text-slate-400"} />
                    最新日期
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto bg-slate-50/30 p-5">
              {status === "error" ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <div className="mb-4 rounded-full bg-red-50 p-4 text-red-500">
                    <AlertCircle size={32} />
                  </div>
                  <h3 className="mb-2 text-lg font-bold text-slate-800">连接失败</h3>
                  <p className="max-w-md text-sm text-slate-500">{errorMsg}</p>
                </div>
              ) : status !== "connected" ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <div className="mb-4 rounded-full bg-slate-50 p-4 text-slate-300">
                    <FolderOpen size={32} />
                  </div>
                  <h3 className="mb-2 text-lg font-bold text-slate-800">等待连接</h3>
                  <p className="text-sm text-slate-500">请在左侧配置目标设备参数并点击连接</p>
                </div>
              ) : fileList.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <p className="text-sm text-slate-500">当前目录为空或无法访问</p>
                </div>
              ) : processedList.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <div className="mb-4 rounded-full bg-slate-50 p-4 text-slate-300">
                    <Search size={32} />
                  </div>
                  <h3 className="mb-2 text-lg font-bold text-slate-800">未找到匹配文件</h3>
                  <p className="text-sm text-slate-500">尝试调整名称过滤或日期范围</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {processedList.map((item, idx) => (
                    <div key={idx} 
                         onClick={() => item.type === 'folder' && handleItemClick(item)}
                         className="group flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white p-3 transition-all hover:border-emerald-200 hover:shadow-sm">
                      <div className="flex items-center gap-3 overflow-hidden">
                        {item.type === "folder" ? (
                          <Folder size={20} className="flex-shrink-0 text-blue-400" />
                        ) : (
                          <FileText size={20} className="flex-shrink-0 text-slate-400" />
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-slate-700" title={item.name}>{item.name}</div>
                          <div className="text-[10px] text-slate-400">{item.date} · {item.displaySize}</div>
                        </div>
                      </div>
                      <button 
                        onClick={(e) => handleDownload(item, e)}
                        title={item.type === 'folder' ? '下载整个文件夹' : '下载文件'}
                        className="hidden flex-shrink-0 rounded-lg bg-emerald-50 p-1.5 text-emerald-600 transition-colors hover:bg-emerald-100 group-hover:block"
                      >
                        <Download size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Content: Terminal */}
        <div className="flex flex-col gap-4 lg:col-span-3 min-h-0">
          <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-[#1e1e1e] font-mono text-sm shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-800/40 px-4 py-2 text-xs font-bold text-slate-400">
              <Terminal size={14} /> 终端输出
            </div>
            <div className="flex-1 overflow-y-auto p-4 pt-2">
              {terminalLogs.map((log, idx) => (
                <div key={idx} className="mb-1 flex">
                  <span className="mr-3 flex-shrink-0 select-none text-slate-500">[{log.time}]</span>
                  <span className={`break-all ${
                    log.type === "error" ? "text-red-400" :
                    log.type === "success" ? "text-emerald-400" :
                    "text-slate-300"
                  }`}>
                    {log.msg}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showBackendConfig && (
        <BackendConfigModal
          value={backendInput}
          onChange={setBackendInput}
          onSave={() => saveBackendUrl(backendInput)}
          onReset={resetBackendUrl}
          onClose={() => setShowBackendConfig(false)}
        />
      )}
    </div>
  );
}

function BackendConfigModal({ value, onChange, onSave, onReset, onClose }) {
  const presets = [
    { label: "本机服务", url: "http://localhost:3001" },
    { label: "局域网设备示例", url: "http://192.168.1.100:3001" },
    { label: "Cloudflare Tunnel 示例", url: "https://logserver.your-tunnel.com" },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-800">配置后端地址</h3>
            <p className="mt-1 text-xs text-slate-500">指定 server.js 代理服务运行的位置</p>
          </div>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-1.5 text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>

        <label className="block text-xs font-bold text-slate-600 mb-1">后端 URL</label>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onSave()}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm outline-none focus:border-blue-400 focus:bg-white"
        />

        <div className="mt-3 space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">快速填入</div>
          {presets.map(p => (
            <button
              key={p.url}
              onClick={() => onChange(p.url)}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-left text-xs transition-all hover:border-blue-300 hover:bg-blue-50/60"
            >
              <span className="font-bold text-slate-700">{p.label}</span>
              <span className="font-mono text-[11px] text-slate-500">{p.url}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-[11px] leading-5 text-amber-800">
          <strong>⚠ 浏览器限制：</strong>
          <br />· 当前页面是 HTTPS → 后端必须是 <strong>HTTPS</strong> 或 <strong>localhost</strong>，否则浏览器会拦截。
          <br />· 想让局域网共享某台机器的后端，推荐用 <strong>Cloudflare Tunnel</strong> 把它暴露为 HTTPS（见下方说明）。
        </div>

        <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2.5 text-[11px] leading-5 text-slate-700">
          <strong className="text-blue-700">Cloudflare Tunnel 5 步快速配置：</strong>
          <ol className="ml-4 mt-1 list-decimal space-y-0.5">
            <li>在那台运行 server.js 的设备上：<code className="rounded bg-slate-100 px-1">winget install --id Cloudflare.cloudflared</code></li>
            <li><code className="rounded bg-slate-100 px-1">cloudflared tunnel login</code>（浏览器选你的域名）</li>
            <li><code className="rounded bg-slate-100 px-1">cloudflared tunnel create log-fetcher</code></li>
            <li><code className="rounded bg-slate-100 px-1">cloudflared tunnel route dns log-fetcher logserver.yourdomain.com</code></li>
            <li><code className="rounded bg-slate-100 px-1">cloudflared tunnel run --url http://localhost:3001 log-fetcher</code></li>
          </ol>
          <div className="mt-1">然后把上面输入框填成 <code className="rounded bg-slate-100 px-1">https://logserver.yourdomain.com</code></div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <button onClick={onReset} className="text-xs font-bold text-slate-500 hover:text-slate-800">
            重置为 localhost
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
              取消
            </button>
            <button onClick={onSave} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700">
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
