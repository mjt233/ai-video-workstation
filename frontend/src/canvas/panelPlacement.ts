/**
 * 节点配置面板（CanvasEditorPanel）的定位算法。
 *
 * 目标：面板**永不遮挡整个节点**。按「下方 → 上方 → 右侧 → 左侧」顺序寻找一个
 * 「面板完整落在画布可视区内、且不与节点矩形（尤其是标题条）重叠」的位置；
 * 上下都放不下时贴靠到节点左右侧并**自适应收窄宽度**；确实无解时退化为
 * 「收窄高度 → 换方向 → 最小重叠」的位置，并保证节点标题条不被覆盖
 * （用户始终能认出当前配置的是哪个节点）。
 *
 * 本模块是**纯几何计算**（无 Vue / DOM 依赖），便于单元测试；
 * 组件侧只负责测量节点标题条高度、面板实测高度与画布可视区尺寸后传入。
 */

/** 面板与节点之间的间距（屏幕像素，不随画布缩放变化） */
export const PANEL_GAP = 12

/** 面板与画布可视区边缘的留白（屏幕像素） */
export const PANEL_VIEWPORT_MARGIN = 8

/**
 * 面板贴靠节点左右侧时允许的最小宽度（屏幕像素；低于该值放弃左右贴靠）。
 * 取 280px：足以容纳输入预览缩略图（64px）+ 参数行换行，同时避免因差几十像素就
 * 放弃贴靠、把面板塞进上下方很小的空间里（那会压缩成很矮的滚动条）。
 */
export const PANEL_SIDE_MIN_WIDTH = 280

/** 面板贴靠节点左右侧时允许的最小高度（屏幕像素；垂直空间低于该值放弃左右贴靠） */
export const PANEL_SIDE_MIN_HEIGHT = 240

/** 节点标题条高度测量失败时的兜底估算值（流坐标像素） */
export const PANEL_HEADER_FALLBACK_HEIGHT = 24

/**
 * 面板最小可渲染高度（屏幕像素）：无可行候选降级时，上下方向最多收窄到此高度
 * （内容区内部滚动），保证节点标题条仍完整可见。
 */
export const PANEL_MIN_HEIGHT = 120

/** 面板贴靠方向 */
export type PanelPlacementSide = 'below' | 'above' | 'right' | 'left'

/**
 * 面板定位候选位置优先级：下方（默认）→ 上方 → 右侧 → 左侧。
 * 滞回失效时按此顺序取第一个「可行」候选。
 */
const PANEL_SIDE_PRIORITY: PanelPlacementSide[] = ['below', 'above', 'right', 'left']

/** 屏幕坐标矩形（画布容器相对坐标） */
export interface PanelRect {
  /** 左边缘 x（屏幕像素） */
  x: number
  /** 上边缘 y（屏幕像素） */
  y: number
  /** 宽度（屏幕像素） */
  width: number
  /** 高度（屏幕像素） */
  height: number
}

/**
 * 面板定位输入（全部为屏幕像素坐标，已按视口 pan/zoom 换算）。
 */
export interface PanelPlacementInput {
  /**
   * 选中节点在画布容器中的矩形（屏幕像素，已含视口平移与缩放）。
   * 由节点流坐标经 `x * zoom + viewport.x` 换算得到。
   */
  nodeRect: PanelRect
  /**
   * 节点标题条高度（流坐标像素，不含缩放；内部会乘 zoom 换算）。
   * 由组件实测 `.canvas-node__header` 高度得到；测不到时传 `PANEL_HEADER_FALLBACK_HEIGHT`。
   */
  headerHeight: number
  /** 画布可视区宽度（屏幕像素，`flowEl.clientWidth`） */
  viewWidth: number
  /** 画布可视区高度（屏幕像素，`flowEl.clientHeight`） */
  viewHeight: number
  /** 面板设计宽度（屏幕像素；普通节点 440 / 生成图片 560 / 生成视频 720） */
  designWidth: number
  /**
   * 面板实测高度（屏幕像素，`panelEl.offsetHeight`；内容自然高度，不含外部约束）。
   *
   * **必须按设计宽度测量**（组件测量时临时把面板宽度置为设计宽度）：若按面板当前渲染宽度测量，
   * 实测高度会随贴靠方向变化（贴靠左右侧被收窄 → 内容换行变高），与定位结果互为因果，
   * 表现为面板在节点右侧与上方之间以帧级频率闪动。
   *
   * 为 0（首次渲染尚未测量）时按「上方/下方均可放下」处理，等测量完成后再重算。
   */
  panelHeight: number
  /**
   * 面板高度上限（屏幕像素，如 CSS `max-height: 65vh` 对应值）。
   * 实测高度超过它时按它渲染，因此参与可用空间判定。
   */
  maxHeight: number
  /** 画布缩放比例（用于把 headerHeight 换算成屏幕像素；缺省 1） */
  zoom?: number
  /**
   * 其他遮挡物矩形（屏幕像素，通常是除选中节点外的**其余节点**）。
   * 面板与它们的重叠不构成「不可行」，但作为**同级排序的优先项**：
   * 其他条件相同时优先选择不压住其他节点的位置（拖动/缩放时保持画布可读）。
   */
  obstacles?: PanelRect[]
  /**
   * 上一次的贴靠方向（滞回用）。仍可行时保持不变，避免平移/缩放/拖动过程中
   * 面板在多个方向之间来回跳变；传 undefined 表示无历史（按优先级取最优）。
   */
  previousSide?: PanelPlacementSide | null
  /**
   * 面板期望的**宽度下限**（屏幕像素；缺省 `PANEL_SIDE_MIN_WIDTH`）。
   *
   * 贴靠左右侧时宽度只能取「节点侧边到可视区边缘的空白」，可能远小于设计宽度；而组件的
   * 宽度下限保护（`PANEL_MIN_WIDTH`）在放不下时会退回到定位给出的宽度——于是出现
   * 「配置面板本可以放下 560px，却因为选了只剩 350px 的右侧贴靠而缩水」。传入本值后，
   * 宽度是否达标会成为**同级排序的一项**（排在「不收窄高度」之后）：达标的方向优先。
   * **不作为可行性门槛**（仍以 `PANEL_SIDE_MIN_WIDTH` 判定）——否则纵向空间紧张时连
   * 「挤一挤还能用」的贴靠候选都会被丢掉，退化成更矮的滚动面板。
   */
  sideMinWidth?: number
}

/**
 * 面板定位结果。
 */
export interface PanelPlacementResult {
  /** 面板左边缘 x（画布容器相对屏幕坐标，已钳制在可视区内） */
  left: number
  /** 面板上边缘 y（画布容器相对屏幕坐标，已钳制在可视区内） */
  top: number
  /** 面板实际渲染宽度（屏幕像素；左右贴靠时可能小于 designWidth，下限 PANEL_SIDE_MIN_WIDTH） */
  width: number
  /**
   * 面板高度上限（屏幕像素）。左右贴靠且垂直空间不足时小于 maxHeight，
   * 组件据此收窄内容区并内部滚动，保证面板不越出可视区。
   */
  maxHeight: number
  /** 本次采用的贴靠方向（供下次计算作滞回依据） */
  side: PanelPlacementSide
  /** 是否与节点矩形发生了重叠（正常定位下为 false；无解降级时为 true） */
  overlapsNode: boolean
  /** 是否覆盖到节点标题条（正常定位下恒为 false；极端场景降级时可能为 true） */
  overlapsHeader: boolean
  /** 面板高度是否尚未测量（为 true 时组件应先隐藏面板，避免用乐观估计闪现错误位置） */
  unmeasured: boolean
}

/**
 * 单个候选位置的计算结果。
 */
interface PlacementCandidate {
  /** 贴靠方向 */
  side: PanelPlacementSide
  /** 面板宽度（屏幕像素） */
  width: number
  /** 面板高度上限（屏幕像素） */
  maxHeight: number
  /** 面板左边缘 x（钳制前） */
  left: number
  /** 面板上边缘 y（钳制前） */
  top: number
  /** 实际渲染高度（屏幕像素，= min(实测高度, maxHeight)） */
  height: number
  /** 面板高度是否被收窄（低于实测高度；收窄后内容区内部滚动，仅作降级选项） */
  shrunk: boolean
  /** 被可视区裁切掉的面积（像素²；0 = 完整可见） */
  clippedArea: number
  /** 与节点矩形重叠的面积（像素²；0 = 不遮挡节点） */
  nodeOverlapArea: number
  /** 与节点标题条重叠的面积（像素²；0 = 标题条完整可见） */
  headerOverlapArea: number
  /** 与其他节点（obstacles）重叠的面积之和（像素²；同级排序用，0 = 不压住其他节点） */
  obstacleOverlapArea: number
  /** 宽度是否达到期望下限（`sideMinWidth`）：贴靠左右侧被收窄到下限以下时为 false */
  meetsWidthFloor: boolean
}

/**
 * 计算两个矩形相交区域的面积。
 *
 * @param a 矩形 A
 * @param b 矩形 B
 * @returns 相交面积（像素²；不相交或相切时为 0）
 */
function intersectionArea(a: PanelRect, b: PanelRect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * 把数值钳制到 `[min, max]` 区间。
 *
 * @param value 原始值
 * @param min 下限
 * @param max 上限（小于 min 时以 min 为准）
 * @returns 钳制后的值
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(max, min))
}

/**
 * 构造某个方向的候选位置（未做可视区钳制，便于统计裁切/重叠面积）。
 *
 * 可用空间规则：
 * - 下方：节点底边到可视区底边（减去间距与留白），可用高度不足时仍生成候选，
 *   由可行性与降级排序决定是否采用；
 * - 上方：可视区顶边到节点顶边（减去间距与留白）；
 * - 右侧/左侧：节点侧边到可视区对应边（减去间距与留白），宽度钳制在
 *   `[PANEL_SIDE_MIN_WIDTH, designWidth]`；垂直方向**不居中于节点**——默认顶边对齐节点顶边、
 *   高度延伸到可视区底部，下方空间不足时改为底边对齐节点底边（两种锚定取可用高度更大者）。
 *
 * @param side 贴靠方向
 * @param input 定位输入
 * @param panelHeight 实际渲染高度（屏幕像素，= min(实测高度, maxHeight)）
 * @returns 候选位置；该方向空间不足以放下面板（宽度 < 320 或高度 < 240）时返回 null
 */
function buildCandidate(
  side: PanelPlacementSide,
  input: PanelPlacementInput,
  panelHeight: number,
): PlacementCandidate | null {
  const { nodeRect, viewWidth, viewHeight } = input
  const margin = PANEL_VIEWPORT_MARGIN
  const gap = PANEL_GAP
  const maxHeight = Math.max(input.maxHeight, 0)

  if (side === 'below' || side === 'above') {
    // 上下方向保持设计宽度，仅受可视区宽度限制（保证与节点水平居中的视觉语言不变）
    const width = Math.min(input.designWidth, Math.max(viewWidth - margin * 2, 1))
    // 该方向可用高度：不足时收窄面板（内容区内部滚动）以避免覆盖节点标题条。
    // 上限 = clamp(可用高度, 最小可渲染高度, 面板高度上限)：
    // 可用高度充足时保持面板原始上限；不足时收窄但至少留 PANEL_MIN_HEIGHT（可用高度更小时以其为准）。
    const available = side === 'below'
      ? viewHeight - margin - (nodeRect.y + nodeRect.height) - gap
      : nodeRect.y - gap - margin
    const heightLimit = Math.max(
      Math.min(Math.min(available, maxHeight), Math.max(available, PANEL_MIN_HEIGHT)),
      0,
    )
    const height = Math.min(panelHeight, heightLimit)
    const left = nodeRect.x + nodeRect.width / 2 - width / 2
    const top = side === 'below'
      ? nodeRect.y + nodeRect.height + gap
      : nodeRect.y - gap - height
    return {
      side,
      width,
      maxHeight: heightLimit,
      left,
      top,
      height,
      shrunk: height < panelHeight,
      clippedArea: 0,
      nodeOverlapArea: 0,
      headerOverlapArea: 0,
      obstacleOverlapArea: 0,
      meetsWidthFloor: width >= widthFloorOf(input),
    }
  }

  // 左右贴靠：宽度取「节点侧边到可视区边缘」的可用空白，钳制在 [PANEL_SIDE_MIN_WIDTH, 设计宽度]
  const sideSpace = side === 'right'
    ? viewWidth - (nodeRect.x + nodeRect.width) - gap - margin
    : nodeRect.x - gap - margin
  if (sideSpace < PANEL_SIDE_MIN_WIDTH) return null
  const width = Math.min(input.designWidth, sideSpace)
  const left = side === 'right'
    ? nodeRect.x + nodeRect.width + gap
    : nodeRect.x - gap - width
  // 垂直方向：**不与节点垂直居中**（居中会白白压缩面板高度）。
  // 默认顶边与节点顶边对齐，可用高度一直延伸到可视区底部；若下方空间不足以容纳面板，
  // 则改用「底边与节点底边对齐」以占用上方空间——两种锚定方式取可用高度更大者。
  const topAnchor = Math.max(nodeRect.y, margin)
  const topSpace = Math.max(viewHeight - margin - topAnchor, 0)
  const bottomAnchor = Math.min(nodeRect.y + nodeRect.height, viewHeight - margin)
  const bottomSpace = Math.max(bottomAnchor - margin, 0)
  const topAnchored = topSpace >= Math.min(panelHeight, maxHeight) || topSpace >= bottomSpace
  const sideMaxHeight = Math.min(maxHeight, topAnchored ? topSpace : bottomSpace)
  const height = Math.min(panelHeight, sideMaxHeight)
  const top = topAnchored ? topAnchor : bottomAnchor - height
  return {
    side,
    width,
    maxHeight: sideMaxHeight,
    left,
    top,
    height,
    shrunk: height < panelHeight,
    clippedArea: 0,
    nodeOverlapArea: 0,
    headerOverlapArea: 0,
    obstacleOverlapArea: 0,
    meetsWidthFloor: width >= widthFloorOf(input),
  }
}

/**
 * 读取期望宽度下限（缺省 `PANEL_SIDE_MIN_WIDTH`，非法值同样回退缺省）。
 *
 * @param input 定位输入
 * @returns 期望宽度下限（屏幕像素）
 */
function widthFloorOf(input: PanelPlacementInput): number {
  const v = input.sideMinWidth
  return Number.isFinite(v) && (v as number) > 0 ? (v as number) : PANEL_SIDE_MIN_WIDTH
}

/**
 * 统计候选位置的裁切面积、与节点/标题条的重叠面积，以及与其他节点（obstacles）的重叠面积。
 *
 * @param candidate 候选位置（就地写入面积字段）
 * @param input 定位输入
 * @returns 写入后的同一候选对象
 */
function measureCandidate(candidate: PlacementCandidate, input: PanelPlacementInput): PlacementCandidate {
  const { nodeRect, headerHeight, viewWidth, viewHeight } = input
  const zoom = input.zoom && input.zoom > 0 ? input.zoom : 1
  const rect: PanelRect = {
    x: candidate.left,
    y: candidate.top,
    width: candidate.width,
    height: candidate.height,
  }
  const headerRect: PanelRect = {
    x: nodeRect.x,
    y: nodeRect.y,
    width: nodeRect.width,
    height: Math.min(headerHeight * zoom, nodeRect.height),
  }
  // 裁切面积 = 面板矩形在可视区外的部分（宽/高方向外溢的并集）
  const outsideWidth = Math.max(rect.x + rect.width - (viewWidth - PANEL_VIEWPORT_MARGIN), 0)
    + Math.max(PANEL_VIEWPORT_MARGIN - rect.x, 0)
  const outsideHeight = Math.max(rect.y + rect.height - (viewHeight - PANEL_VIEWPORT_MARGIN), 0)
    + Math.max(PANEL_VIEWPORT_MARGIN - rect.y, 0)
  candidate.clippedArea = Math.max(
    outsideWidth * rect.height + outsideHeight * rect.width - outsideWidth * outsideHeight,
    0,
  )
  candidate.nodeOverlapArea = intersectionArea(rect, nodeRect)
  candidate.headerOverlapArea = intersectionArea(rect, headerRect)
  candidate.obstacleOverlapArea = (input.obstacles ?? [])
    .reduce((sum, obstacle) => sum + intersectionArea(rect, obstacle), 0)
  return candidate
}

/**
 * 候选是否「可行」：面板**按原始高度**完整落在可视区内、且不遮挡节点矩形（含标题条）。
 *
 * 需要收窄高度（内部滚动）或贴靠高度不足 240px 的候选不算可行，
 * 它们只在降级排序中参与比较——保证「能不收窄就不收窄，能换方向就不收窄」。
 *
 * @param candidate 候选位置
 * @returns 可行返回 true
 */
function isCandidateViable(candidate: PlacementCandidate): boolean {
  if (candidate.clippedArea > 0) return false
  if (candidate.nodeOverlapArea > 0) return false
  if (candidate.headerOverlapArea > 0) return false
  if (candidate.shrunk) return false
  // 左右贴靠高度不足最小可用高度时不算「可行」（改由降级排序决定）
  if (candidate.side === 'right' || candidate.side === 'left') {
    return candidate.height >= PANEL_SIDE_MIN_HEIGHT
  }
  return true
}

/**
 * 同级排序（可行性相同的一组候选之间择优）：
 * 「不遮标题条」→「不裁切」→「不收窄面板高度（都只能收窄时取可见高度更大者）」→
 * 「宽度达到期望下限（`sideMinWidth`）」→「压住其他节点最少」→ 方向优先级 →「与选中节点重叠最小」。
 *
 * 四条关键约定：
 * - **标题条优先级最高**：即使用户把节点放大到面板无法完整放下的程度，也要保证节点标题条可见
 *   （用户始终能认出当前配置的是哪个节点）；
 * - **不收窄优先于方向优先级**：下方只需收窄高度就能放下、而左右侧能保持完整高度时，
 *   选左右侧（贴靠只换行不压缩内容，比挤成很矮的滚动条更可用）；上下与左右同为完整高度时，
 *   仍按 下→上→右→左 的顺序保持既有视觉语言；
 * - **宽度达标优先于方向优先级**：贴靠左右侧的宽度只能是「节点侧边到可视区边缘」的空白，
 *   可能远小于设计宽度；此时若上下方能按设计宽度完整放下，就选上下方（面板不缩水）。
 *   该比较仅在「都不收窄」时才有意义，故排在收窄比较之后；
 * - **不收窄也优先于「不压住其他节点」**：都只能收窄时，先比可见高度（滚动更少），再比障碍物重叠。
 *   否则会出现「为了不压住别的节点，把面板塞进一个只有 200 多像素高的位置」——
 *   而那个位置恰好在下一帧把实测高度推向另一个方向，引发方向抖动。
 *
 * @param a 候选 A
 * @param b 候选 B
 * @returns 排序差值
 */
function compareCandidates(a: PlacementCandidate, b: PlacementCandidate): number {
  const headerA = a.headerOverlapArea > 0 ? 1 : 0
  const headerB = b.headerOverlapArea > 0 ? 1 : 0
  if (headerA !== headerB) return headerA - headerB
  if (a.headerOverlapArea !== b.headerOverlapArea) return a.headerOverlapArea - b.headerOverlapArea
  const clippedA = a.clippedArea > 0 ? 1 : 0
  const clippedB = b.clippedArea > 0 ? 1 : 0
  if (clippedA !== clippedB) return clippedA - clippedB
  if (a.clippedArea !== b.clippedArea) return a.clippedArea - b.clippedArea
  if (a.shrunk !== b.shrunk) return a.shrunk ? 1 : -1
  // 宽度达标优先于方向优先级：贴靠左右侧往往只能拿到「节点侧边到可视区边缘」的窄空白，
  // 若面板本来能在下方/上方按设计宽度完整放下，就不该为了贴靠把宽度缩掉一截。
  if (a.meetsWidthFloor !== b.meetsWidthFloor) return a.meetsWidthFloor ? -1 : 1
  // 两者都未收窄时高度恒等于实测高度（相等），此比较仅在「都只能收窄」时生效：
  // 取可见高度更大的方向（滚动更少）
  if (a.height !== b.height) return b.height - a.height
  if (a.obstacleOverlapArea !== b.obstacleOverlapArea) return a.obstacleOverlapArea - b.obstacleOverlapArea
  const priority = PANEL_SIDE_PRIORITY.indexOf(a.side) - PANEL_SIDE_PRIORITY.indexOf(b.side)
  if (priority !== 0) return priority
  if (a.nodeOverlapArea !== b.nodeOverlapArea) return a.nodeOverlapArea - b.nodeOverlapArea
  return 0
}

/**
 * 计算配置面板的定位结果。
 *
 * 算法（按优先级）：
 * 1. 生成四个方向的候选位置（左右方向需同时满足宽度 ≥ 320px、高度 ≥ 240px）；
 * 2. 取「可行」候选（按原始高度完整可见且完全不遮挡节点），按「压住其他节点最少 → 方向优先级」
 *    择优；上一次的方向仍可行且完全同分时保持不变（滞回，避免平移/缩放时来回跳位）；
 * 3. 无可行候选时按同级排序取最优（不遮标题条 → 不裁切 → 不收窄（都需收窄时取可见高度更大者）→
 *    压住其他节点最少 → 方向优先级）；
 * 4. 最终把位置钳制进可视区，保证面板不会跑出画布。
 *
 * 面板高度尚未测量（`panelHeight === 0`）时返回 `unmeasured: true`，组件应隐藏面板等待测量，
 * 避免用乐观估计闪现错误位置。
 *
 * @param input 定位输入（屏幕坐标，见 PanelPlacementInput）
 * @returns 定位结果（left/top/width/maxHeight 与命中的贴靠方向）
 */
export function computePanelPlacement(input: PanelPlacementInput): PanelPlacementResult {
  const { viewWidth, viewHeight, designWidth } = input
  const margin = PANEL_VIEWPORT_MARGIN
  const panelHeight = Math.max(input.panelHeight, 0)
  const maxHeight = Math.max(input.maxHeight, 0)

  // 高度未知：不做定位（组件隐藏面板），等 ResizeObserver 测出高度后重算
  if (panelHeight <= 0) {
    return {
      left: input.nodeRect.x,
      top: input.nodeRect.y + input.nodeRect.height + PANEL_GAP,
      width: designWidth,
      maxHeight,
      side: 'below',
      overlapsNode: false,
      overlapsHeader: false,
      unmeasured: true,
    }
  }

  const effectiveHeight = Math.min(panelHeight, maxHeight)
  const candidates: PlacementCandidate[] = []
  // 可视区尚未测量（画布 Tab 隐藏）：退化为「节点下方」，不做钳制
  if (viewWidth > 0 && viewHeight > 0) {
    for (const side of PANEL_SIDE_PRIORITY) {
      const candidate = buildCandidate(side, input, effectiveHeight)
      if (candidate) candidates.push(measureCandidate(candidate, input))
    }
  }

  const previous = input.previousSide
  const viable = candidates.filter((c) => isCandidateViable(c))
  let chosen: PlacementCandidate | undefined
  if (viable.length > 0) {
    const best = [...viable].sort(compareCandidates)[0]
    // 滞回：上一次的方向仍可行、且与最优候选完全同分（含障碍物重叠）时保持不动，
    // 避免平移/缩放时来回跳位；一旦有更优位置（如避开其他节点）则立即改向。
    const keep = viable.find((c) => c.side === previous)
    chosen = keep && compareCandidates(keep, best) === 0 ? keep : best
  } else if (candidates.length > 0) {
    chosen = [...candidates].sort(compareCandidates)[0]
  }
  if (!chosen) {
    // 四个方向都不可用（视口极小）：退化为「节点下方 + 最小宽度」，由最终钳制保证可见
    const fallbackWidth = viewWidth > 0
      ? clamp(designWidth, 1, Math.max(viewWidth - margin * 2, 1))
      : designWidth
    chosen = {
      side: 'below',
      width: fallbackWidth,
      maxHeight,
      left: input.nodeRect.x,
      top: input.nodeRect.y + input.nodeRect.height + PANEL_GAP,
      height: effectiveHeight,
      shrunk: false,
      clippedArea: 0,
      nodeOverlapArea: 0,
      headerOverlapArea: 0,
      obstacleOverlapArea: 0,
      meetsWidthFloor: false,
    }
    if (viewWidth > 0 && viewHeight > 0) measureCandidate(chosen, input)
  }

  const clampedLeft = viewWidth > 0
    ? clamp(chosen.left, margin, Math.max(viewWidth - chosen.width - margin, margin))
    : chosen.left
  const clampedTop = viewHeight > 0
    ? clamp(chosen.top, margin, Math.max(viewHeight - chosen.height - margin, margin))
    : chosen.top
  const rect: PanelRect = { x: clampedLeft, y: clampedTop, width: chosen.width, height: chosen.height }
  return {
    left: clampedLeft,
    top: clampedTop,
    width: chosen.width,
    maxHeight: chosen.maxHeight,
    side: chosen.side,
    overlapsNode: intersectionArea(rect, input.nodeRect) > 0,
    overlapsHeader: chosen.headerOverlapArea > 0,
    unmeasured: false,
  }
}


