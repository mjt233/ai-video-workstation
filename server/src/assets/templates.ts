export function characterOverviewMd(name: string, gender: string, age: string, personality: string): string {
  return `# ${name} - 角色总览

## 基本信息
- 姓名：${name}
- 性别：${gender || '待定'}
- 年龄：${age || '待定'}
- 性格：${personality || '待补充'}

## 背景
待补充角色背景故事。

## 角色关系
待补充与其他角色的关系说明。
`;
}

export function characterAppearanceMd(gender: string, age: string): string {
  return `生成人物角色正面、侧面、背面三个视角的全身图

要求：纯色背景、自然站立，双臂自然下垂
以下为角色描述

## 基本信息
- 年龄：${age || '待定'}
- 性别：${gender || '待定'}
- 身高：待定
- 体型：待定
- 其他细节

## 风格
待补充

## 面部特征
- 脸型：待定
- 发型发色：待定
- 五官特征：待定
- 其他细节特征

## 衣着风格
- 服装款式：待定
- 颜色搭配：待定
- 材质：待定
- 其他配饰细节

## 气质关键词
待补充
`;
}

export function characterVoiceMd(): string {
  return `待补充声线描述：用 1-3 句自然语言概括音调、语速、咬字与整体听觉印象。
`;
}

export function subsceneMd(opts: {
  label: string;
  description?: string;
}): string {
  return `# ${opts.label}

## 画面描述
${opts.description || '待补充场景画面描述。'}

## 主色调
待补充
`;
}

export interface ShotOverview {
  title: string;
  beat: string;
  visual: string;
  camera: string;
  duration: number;
  mood: string;
}

export function shotOverviewJson(title = '待定标题'): ShotOverview {
  return {
    title,
    beat: '',
    visual: '',
    camera: '',
    duration: 5,
    mood: '',
  };
}

export function shotPromptMd(): string {
  return `待补充图生视频提示词（LTX-2.3）。运镜与动作描述写在此处；不要重复描述已由参考图提供的背景与人物外貌。
`;
}

/**
 * 剧本分集 Markdown 模板（创建分集时写入 prompt/script/episodes/{n}.md）。
 * 首行一级标题「# 第{n}集」被删除重排逻辑识别：分集编号前移时若首行
 * 精确匹配该格式，会自动同步改写为新编号（见 script-episodes.ts）。
 * @param n 分集编号（正整数字符串或数字）
 * @returns 分集 Markdown 初始内容
 */
export function scriptEpisodeMd(n: string | number): string {
  return `# 第${n}集

## 剧情梗概
待补充本集剧情梗概。

## 正文
待补充本集剧本正文。
`;
}
