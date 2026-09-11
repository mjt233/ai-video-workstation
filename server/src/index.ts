import express from 'express';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { fsRouter } from './routes/fs.js';
import { projectPortRouter } from './routes/project-port.js';
import { assetsRouter } from './routes/assets.js';
import { workflowRouter } from './routes/workflow.js';
import { canvasRouter } from './routes/canvas.js';
import { llmRouter } from './routes/llm.js';
import { presetsRouter } from './routes/presets.js';
import { blueprintsRouter } from './routes/blueprints.js';
import { cleanupRouter } from './routes/cleanup.js';
import { systemRouter } from './routes/system.js';
import { startTrashAutoCleanScheduler } from './system/trash-scheduler.js';
import { startTaskLogCleanScheduler } from './system/log-scheduler.js';
import { discoverProviders } from './providers/index.js';
import { discoverWorkflows, startEngine } from './workflow-engine.js';
import { syncAllInstances } from './providers/instance-sync.js';
import { migrateLegacyConfig } from './providers/config-store.js';
import { apiNotFoundHandler, errorHandler, installProcessErrorHandlers } from './error-handler.js';
import { wsHub } from './tasks/task-ws.js';
import { taskRouter } from './tasks/routes.js';

// 进程级兜底：未处理的 Promise 拒绝 / 未捕获同步异常全部打印到控制台，杜绝静默丢失
installProcessErrorHandlers();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
/** HTTP 服务器（WS 枢纽挂在同一个服务器上：/llm-ws 由 ws 库自行处理 upgrade） */
const server = http.createServer(app);
/** 统一任务 WebSocket 枢纽挂载（连接即推全部活跃任务；见 /llm-ws） */
wsHub.attach(server);
/** 服务监听端口，可通过环境变量 PORT 覆盖 */
const PORT = process.env.PORT || 3001;
/** 监听所有网络接口（0.0.0.0），允许局域网内其他设备访问 */
const HOST = '0.0.0.0';

/**
 * JSON body 解析。
 * 默认 limit 仅 100kb，资产画布 canvas.json（节点/连线/长提示词/导演台配置）
 * 经 POST /api/fs 以 `{ content }` 写入时很容易超限并抛 PayloadTooLargeError。
 * 文本写入场景提高到 50mb；大文件二进制仍走 multipart 上传，不受此限制。
 */
app.use(express.json({ limit: '50mb' }));

app.use('/api', fsRouter);
app.use('/api', projectPortRouter);
app.use('/api', assetsRouter);
app.use('/api', workflowRouter);
app.use('/api', canvasRouter);
app.use('/api', taskRouter);
app.use('/api', llmRouter);
app.use('/api', presetsRouter);
app.use('/api', blueprintsRouter);
app.use('/api', cleanupRouter);
app.use('/api', systemRouter);

// /api 未匹配任何路由的请求统一返回 JSON 404（404 属正常业务反馈，不打日志）
app.use('/api', apiNotFoundHandler);

const distPath = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

// 全局统一兜底错误中间件：必须注册在中间件链最末端，
// 收口所有未被路由捕获的错误（同步抛错 / next(err) / body-parser / multer 等），
// 服务端异常完整打印到控制台，客户端统一收到 JSON 错误响应
app.use(errorHandler);

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
  discoverWorkflows().then(async () => {
    startEngine();
    // 回收站自动清理调度器（默认每 7 天一次；配置见 系统设置 → 系统设置 → 回收站）
    startTrashAutoCleanScheduler();
    // 任务日志自动清理调度器（默认每 24 小时一次；配置见 系统设置 → 系统设置 → 日志）
    startTaskLogCleanScheduler();
    server.listen(Number(PORT), HOST, () => {
      printAccessUrls(PORT);
    });
    // 旧格式配置自动迁移为实例数组（幂等；已是新格式则跳过）
    try {
      await migrateLegacyConfig();
    } catch (e) {
      console.error(`[config-store] 旧配置迁移失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    // 实例工作流动态注册（失败不阻塞服务启动）
    syncAllInstances().catch((e) => {
      console.error(`[instance-sync] 启动同步失败: ${e instanceof Error ? e.message : String(e)}`);
    });
  }),
);
