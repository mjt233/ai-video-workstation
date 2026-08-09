import express from 'express';
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
const PORT = process.env.PORT || 3001;

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

discoverProviders().then(() =>
  discoverWorkflows().then(() => {
    startEngine();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
    // Bridge 工作流动态注册（失败不阻塞服务启动）
    syncBridgeWorkflows().catch((e) => {
      console.error(`[bridge-sync] 启动同步失败: ${e instanceof Error ? e.message : String(e)}`);
    });
  }),
);
