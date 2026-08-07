/**
 * 任务取消标记（同步执行 provider 的「延迟生效」取消）纯函数。
 *
 * 同步 provider（如火山方舟）无法中止在途请求：取消请求被接受后把
 * `cancelRequested: true` 写入任务 params，引擎在 execute 完成后检查并
 * 把任务持久化为失败（用户中断），而非完成。
 */

/** 标记任务为「已请求取消」（写入 params.cancelRequested）。 */
export function markCancelRequested(params: object): object {
  return { ...params, cancelRequested: true };
}

/** 剥离任务运行时取消标记（重试复制 params 时使用，避免旧标记影响新任务）。 */
export function stripCancelRequested(params: object): object {
  const out: Record<string, unknown> = { ...params };
  delete out.cancelRequested;
  return out;
}

/** 判断任务 params 是否含取消标记（cancelRequested === true）。 */
export function isCancelRequested(params: object): boolean {
  return (params as Record<string, unknown>).cancelRequested === true;
}
