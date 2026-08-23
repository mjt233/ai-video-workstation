# 自定义工作流服务商支持

## 概述

服务提供商需要新增一个“自定义服务商”功能，允许用户自定义编写TypeScript代码来实现对工作流接口发起调用、查询状态、获取结果。

除了通用字段，用户可以对自定义服务商配置进行配置文件的导入/导出，同时可配置以下内容：

1. baseUrl(字符串，可选)
2. API Key(字符串，可选)
3. 通用代码块（组件，可选）
4. 工作流配置组件（组件，可选）

## 通用代码

显示为一个按钮，点击按钮后打开对话框，在对话框内的monaco editor编辑代码。
代码案例：
```ts
export function getBaseCallConfig(ctx: WorkflowCallContext, model: string) {
  return {
    url: ctx.providerConfig.baseUrl,
    header: {
      Authorization: 'Bearer ' + ctx.providerConfig.apiKey
    },
    method: 'post',
    data: {
      model: model
    }
  }
}
```

## 工作流配置组件

### 布局

```
[ + 新增工作流]

| 工作流名称 | 类型 | 操作 |
| ------- | ---- | ---- |
| gpt-image-2 | 文生图、图片编辑(v-chip) | [编辑按钮] [删除按钮] |
| ... | ... | [编辑按钮] [删除按钮] |
```

点击新增工作流或编辑按钮，弹出新增/编辑工作流表单对话框：

### 新增/编辑工作流表单

功能如下：

1. 填写工作流名称
2. 选择工作流类型，v-select下拉多选，可选择系统支持的所有工作流类型
3. 选择是否异步请求
4. 配置自定义接口调用与结果提取的TypeScript代码

通过v-tab页签切换代码编辑界面
- 调用发起
    代码编写的方式：
    ```ts
    // ctx.session类型为Record<string, any>，ctx在实例化时就默认赋值
    // ctx在整个工作流发起调用、结果轮询与提取中都是同一个实例
    // 通用代码中导出的函数在这里可直接全局调用，且需要有monaco编辑器代码提示
    export default async function(ctx: WorkflowCallContext) {
      // 返回发起工作流调用的http请求配置
      const conf = getBaseCallConfig(ctx, 'gpt-image-2')

      // ctx.params 需要根据工作流支持的类型动态提示ts类型
      conf.data.prompt = ctx.params.prompt

      // 需要返回一个http调用配置
      return conf
    }
    ```
- 结果提取
    代码编写的方式:
    ```ts
    // callResult 为【调用发起】的http请求响应对象
    export default async function(ctx: WorkflowCallContext, callResult: WorkflowCallResult): Promise<WorkflowResult> {
      const taskId = callResult.data.task_id

      const res = await ctx.request({
        url: `${ctx.providerConfig.baseUrl}/v1/tasks/${taskId}`,
        method: 'get',
        header: {
          Authorization: `Bearer ${ctx.providerConfig.apiKey}`
        }
      })

      if (res.data.status == 'in_progress') {
        return {
          // 是否已完成
          isFinish: false,
          // 任务百分比进度，0~100。小于0或undefined或null表示未知
          progress: res.data.progress
        }
      } else {
        return {
          isFinish: true,
          outputs: res.data.data.map(e => )
        }
      }
    }
    ```

类型声明：
```ts
interface WorkflowResult {
  // 工作流是否已执行完成
  isFinish: booelean
  // 工作流执行进度任务百分比进度，0~100。小于0或undefined或null表示未知
  progress?: number | null
  // 工作流执行结果产物，http url。
  outputs?: string[]
}

interface WorkflowCallContext {
  providerConfig: {
    // 工作流提供商配置的baseUrl
    baseUrl?: string

    // 工作流提供商配置
    apiKey?: string

    其他字段
  }

  // 发起http调用
  request(conf: WorkflowCallRequestConfig): Promise<WorkflowCallResult>

  // 本次工作流调用的输入参数，根据支持的工作流类型动态组合
  params: TextToImagesParams & ImageEditParams & ImageToVideoParams & ...

  其他字段
}
```

- 当工作流配置为异步请求时，【结果提取】会被多次调用，直到 `isFinish` 为 true，或报错持续时间达到设定的超时时间
- 当工作流配置为非异步请求时，【结果提取】只会被调用一次。

## 工作流用户配置字段

工作流条目可配置「用户配置字段」列表（key / 显示名 / 类型 / 默认值 / 说明）：

- 类型支持：string（字符串）、integer（整数）、float（小数）、boolean（布尔）
- 运行工作流时，前端按声明渲染输入表单（默认值回填），用户填写后经 vars 注入自定义工作流
- 代码中通过 `ctx.userConfig.字段key` 读取（按声明类型转换为原生值：boolean / number / string；
  未填写时回退声明默认值，保证每个声明字段都存在）
- 编辑器按当前表单中的字段声明生成 `ctx.userConfig` 类型提示（boolean → boolean，
  integer/float → number，string → string），新增/删除/修改字段后实时刷新

## ctx.readFileToBase64

`ctx.readFileToBase64(relPath: string, withDataPrefix?: boolean): Promise<string>`
—— 读取项目内任意文件并转为 Base64 字符串。路径相对 `design/{project}/`，越界抛错。

- `withDataPrefix` 缺省 / false：返回纯 Base64（不含 `data:` 前缀）
- `withDataPrefix` 为 true：自动添加 `data:<mime>;base64,` 前缀（MIME 按文件扩展名推断：
  png → image/png、webp → image/webp、flac → audio/flac、mp4 → video/mp4，其余默认 image/jpeg）

## ctx.workflowType

`ctx.workflowType?: WorkflowTypeId` —— 本次调用的工作流类型，类型约束为系统支持的工作流类型
联合（`'text-to-image' | 'image-edit' | 'tts-voice-design' | 'tts-voice-clone' | 'image-to-video'`，
与 `workflows/types.ts` 的 `WorkflowTypeId` 一致）。由同步器按注册的工作流类型注入；
测试连接等非工作流执行场景不存在该字段。前端 Monaco 声明库同样以联合类型约束
（`CustomWorkflowTypeId`，与 `FALLBACK_WORKFLOW_TYPES` 保持一致），编辑器内赋值/比较
非系统类型会直接报 TS 错误。

## 编辑器类型提示实时刷新

- 修改「通用代码块」后，工作流调用发起 / 结果提取 / 取消调用 / 测试代码编辑器中的
  通用代码导出提示实时更新
- 修复：Monaco 额外类型库改为共享注册表合并（避免多个编辑器互相覆盖全局
  typescriptDefaults 导致提示丢失/不刷新）
