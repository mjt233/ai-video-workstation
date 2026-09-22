/**
 * 「文本生成」工作流端到端自检脚本（临时项目，用完即删）。
 *
 * 做什么：起一个本地 mock 文本接口 → 在真实服务端上创建一个临时自定义服务商实例
 * （工作流类型 `text-generation`，脚本把响应正文作为产物返回）→ 在临时项目 + 临时分镜画布
 * 上提交一次 `text-generation` 任务 → 校验画布节点 `config.output` / `outputHistory`
 * 与任务 result 是否按约定写入 → 反向清理（删实例、删临时项目）。
 *
 * 用法（需要本地服务端已在 3001 运行）：
 *   npx tsx server/scripts/verify-text-generation.mjs
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESIGN_DIR = path.resolve(__dirname, '../../design');
const API = 'http://127.0.0.1:3001/api';
const MOCK_PORT = 4599;
/** 临时项目名（自检结束后整目录删除） */
const PROJECT = `__tmp-textgen-verify-${Date.now().toString(36)}`;
/** mock 接口返回的正文（含换行与中文，校验 UTF-8 与 BOM 链路） */
const MOCK_TEXT = `文本生成自检产物 ${new Date().toISOString()}\n第二行：中文与换行都应原样保留。`;

let instanceId = '';

/** 启动 mock 文本接口（POST / 返回 text/plain 正文） */
async function startMockServer() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(MOCK_TEXT);
    });
  });
  await new Promise((resolve) => server.listen(MOCK_PORT, '127.0.0.1', resolve));
  return server;
}

/** 发一个 JSON 请求（非 2xx 直接抛错，避免静默失败） */
async function api(method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

/** 写入项目内文本文件（canvas.json） */
async function writeProjectFile(rel, content) {
  const full = path.resolve(DESIGN_DIR, PROJECT, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
}

/** 读取项目内 JSON 文件 */
async function readProjectJson(rel) {
  const full = path.resolve(DESIGN_DIR, PROJECT, rel);
  return JSON.parse(await fs.readFile(full, 'utf-8'));
}

/** 轮询任务直到终态（最多 30 秒） */
async function waitTask(taskId) {
  for (let i = 0; i < 60; i += 1) {
    const task = await api('GET', `/workflow/tasks/${taskId}`);
    if (task.status === 'completed' || task.status === 'failed') return task;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('任务未在 30 秒内收敛');
}

/** 断言 */
function assert(cond, msg) {
  if (!cond) throw new Error('断言失败: ' + msg);
  console.log('  ✓ ' + msg);
}

const mockServer = await startMockServer();
console.log(`mock 文本接口已启动: http://127.0.0.1:${MOCK_PORT}`);

try {
  // ── 1. 临时项目 + 临时分镜画布（含一个 text-generate 节点）───────────────────
  const CANVAS_REL = 'prompt/scene/1/1/canvas.json';
  await writeProjectFile(CANVAS_REL, JSON.stringify({
    version: 1,
    kind: 'scene',
    rev: 0,
    nodes: [{
      id: 'node-text',
      prototypeId: 'text-generate',
      name: '文本生成',
      x: 0,
      y: 0,
      width: 360,
      height: 240,
      config: { workflowId: 'text-generation', prompt: '写一段旁白', output: '', outputHistory: [] },
    }],
    connections: [],
  }, null, 2));
  console.log(`临时项目已创建: ${PROJECT}`);

  // ── 2. 临时自定义服务商实例（text-generation 工作流）─────────────────────────
  const callCode = [
    'export default async function(ctx) {',
    "  return { url: ctx.providerConfig.baseUrl, method: 'post', data: { prompt: ctx.params.prompt } }",
    '}',
  ].join('\n');
  const extractCode = [
    'export default async function(ctx, callResult) {',
    '  // 直接返回接口响应正文作为文本产物（无需先上传成文件）',
    '  return { isFinish: true, text: String(callResult.data) }',
    '}',
  ].join('\n');
  const created = await api('POST', '/providers/instances', {
    type: 'custom',
    name: '[自检] 文本生成临时实例',
    config: {
      baseUrl: `http://127.0.0.1:${MOCK_PORT}`,
      apiKey: 'self-check',
      timeout: 60,
      pollInterval: 1,
      commonCode: '',
      testCode: '',
      workflows: [{
        name: 'text-selfcheck',
        types: ['text-generation'],
        async: false,
        cancelable: false,
        callCode,
        extractCode,
        cancelCode: '',
      }],
    },
  });
  instanceId = created.instance.id;
  console.log(`临时服务商实例已创建: ${instanceId}`);
  const types = await api('GET', '/workflow-types');
  assert(types.types.includes('text-generation'), '/api/workflow-types 含 text-generation');

  // ── 3. 提交文本生成任务（画布节点路径，不带 outputPath）─────────────────────
  const run = await api('POST', '/workflow/run', {
    project: PROJECT,
    workflowId: 'text-generation',
    impl: `custom-text-selfcheck-${instanceId}`,
    params: {
      vars: { prompt: '写一段旁白', imagePaths: '[]', mediaPaths: '[]', purpose: 'canvas-text' },
      nodeId: 'node-text',
      canvas: { kind: 'scene', episode: '1', shot: '1' },
      userParams: {},
    },
  });
  console.log(`任务已提交: ${run.taskId}`);
  const task = await waitTask(run.taskId);
  assert(task.status === 'completed', `任务完成（status=${task.status}${task.errorMsg ? ' err=' + task.errorMsg : ''}）`);

  // ── 4. 校验任务 result 与画布落盘 ──────────────────────────────────────────
  assert(typeof task.result?.text === 'string' && task.result.text.includes('文本生成自检产物'), '任务 result.text 为接口正文');
  assert(typeof task.result?.rev === 'number', `任务 result 携带写入后 rev=${task.result?.rev}`);
  assert(typeof task.result?.prevRev === 'number', `任务 result 携带写入前 prevRev=${task.result?.prevRev}`);
  assert(task.result?.patch?.output === MOCK_TEXT, '任务 result.patch.output 为落盘补丁原文');

  const canvas = await readProjectJson(CANVAS_REL);
  const node = canvas.nodes.find((n) => n.id === 'node-text');
  assert(node.config.output === MOCK_TEXT, '画布节点 config.output 已写入文本（换行/中文原样）');
  assert(Array.isArray(node.config.outputHistory) && node.config.outputHistory.length === 1, '画布节点 outputHistory 追加了 1 条历史');
  assert(node.config.outputHistory[0].output === MOCK_TEXT, '历史条目 output 为本次文本');
  assert(node.config.outputHistory[0].input === '写一段旁白', '历史条目 input 为本次提示词');
  assert(canvas.rev === 1, `画布 rev 推进到 1（实际 ${canvas.rev}）`);
  console.log('\n端到端自检全部通过 ✅');
} finally {
  // ── 5. 清理：删除临时实例与临时项目（不留痕）─────────────────────────────
  if (instanceId) {
    try {
      await api('DELETE', `/providers/instances/${instanceId}`);
      console.log(`临时服务商实例已删除: ${instanceId}`);
    } catch (e) {
      console.error('删除临时实例失败（需手动清理）:', e instanceof Error ? e.message : String(e));
    }
  }
  await fs.rm(path.resolve(DESIGN_DIR, PROJECT), { recursive: true, force: true });
  console.log(`临时项目已删除: ${PROJECT}`);
  mockServer.close();
}
