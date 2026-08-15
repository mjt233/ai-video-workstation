import express from 'express';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { fsRouter } from './routes/fs.js';
import { assetsRouter } from './routes/assets.js';
import { workflowRouter } from './routes/workflow.js';
import { canvasRouter } from './routes/canvas.js';
import { discoverProviders } from './providers/index.js';
import { discoverWorkflows, startEngine } from './workflow-engine.js';
import { syncBridgeWorkflows } from './workflows/bridge-sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
/** 服务监听端口，可通过环境变量 PORT 覆盖 */
const PORT = process.env.PORT || 3001;
/** 监听所有网络接口（0.0.0.0），允许局域网内其他设备访问 */
const HOST = '0.0.0.0';

app.use(express.json());

app.use('/api', fsRouter);
app.use('/api', assetsRouter);
app.use('/api', workflowRouter);
app.use('/api', canvasRouter);

const distPath = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

/**
 * 获取本机所有对外可访问的 IPv4 地址
 * @returns 非回环（internal=false）网卡的 IPv4 地址数组；无可用地址时返回空数组
 * @example ['192.168.1.100', '10.0.0.8']
 */
function getLanIPv4Addresses(): string[] {
  const addresses: string[] = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    if (!infos) continue;
    for (const info of infos) {
      if (info.family === 'IPv4' && !info.internal) {
        addresses.push(info.address);
      }
    }
  }
  return addresses;
}

/**
 * 在控制台打印服务访问地址（本机 + 局域网各网卡 IP）
 * @param port 服务监听端口，用于拼接访问 URL
 */
function printAccessUrls(port: string | number): void {
  console.log('');
  console.log('服务已启动，监听所有网络接口，访问地址：');
  console.log(`  本机:    http://localhost:${port}`);
  for (const ip of getLanIPv4Addresses()) {
    console.log(`  局域网:  http://${ip}:${port}`);
  }
  console.log('');
}

discoverProviders().then(() =>
  discoverWorkflows().then(() => {
    startEngine();
    app.listen(Number(PORT), HOST, () => {
      printAccessUrls(PORT);
    });
    // Bridge 工作流动态注册（失败不阻塞服务启动）
    syncBridgeWorkflows().catch((e) => {
      console.error(`[bridge-sync] 启动同步失败: ${e instanceof Error ? e.message : String(e)}`);
    });
  }),
);
