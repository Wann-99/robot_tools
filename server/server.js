const express = require('express');
const cors = require('cors');
const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

// 健康检查接口
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Log Fetcher Proxy is running', version: '1.1.0' });
});

// FTP 连接及文件获取接口
app.post('/api/connect', async (req, res) => {
  const { protocol, host, port, username, password, path } = req.body;

  if (protocol === 'FTP') {
    const client = new ftp.Client();
    client.ftp.verbose = false; // 关闭底层日志以防刷屏
    try {
      // 连接设备
      await client.access({
        host,
        port: parseInt(port) || 21,
        user: username,
        password,
        secure: false
      });

      // 切换目录
      await client.cd(path || '/');

      // 列出文件
      const list = await client.list();
      
      // 格式化输出
      const files = list.map(item => ({
        name: item.name,
        size: item.size,
        date: item.rawModifiedAt || item.modifiedAt || '未知时间',
        type: item.isDirectory ? 'folder' : 'file'
      }));

      res.json({ success: true, data: files });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.close();
    }
  } else {
    // 对于 Telnet / SFTP 等暂做拦截提示
    res.status(500).json({ 
      success: false, 
      error: `代理服务暂未完全实现 [${protocol}] 协议，请使用 FTP 协议抓取。` 
    });
  }
});

// 文件下载接口
app.post('/api/download', async (req, res) => {
  const { protocol, host, port, username, password, path: remotePath, localPath, fileName } = req.body;

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

      // 验证本地保存路径是否存在，不再自动创建
      const resolvedLocalPath = path.resolve(localPath);
      if (!fs.existsSync(resolvedLocalPath)) {
        return res.status(400).json({ success: false, error: `指定的本地保存路径不存在：${resolvedLocalPath}` });
      }
      
      const stats = fs.statSync(resolvedLocalPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ success: false, error: `指定的本地保存路径不是一个有效的目录：${resolvedLocalPath}` });
      }

      // 拼接本地文件完整路径
      const localFilePath = path.join(resolvedLocalPath, fileName);
      
      // 执行下载
      await client.downloadTo(localFilePath, fileName);

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
  console.log(`=========================================`);
  console.log(`🚀 Log Fetcher 代理服务已启动!`);
  console.log(`📡 监听端口: http://localhost:${PORT}`);
  console.log(`✅ 现在您可以返回浏览器继续抓取日志了`);
  console.log(`=========================================`);
});