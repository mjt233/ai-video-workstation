/**
 * zip 压缩包「原始项目名」探测工具。
 *
 * 用于导入项目对话框：用户在首页选择 zip 后，在浏览器端轻量解析
 * zip 中央目录（只读文件尾部与目录元数据，不解压、不读取文件内容，
 * 几百 MB 的大包也只读取几十 KB），探测出压缩包内的顶层目录名
 * （即本项目导出格式中的项目名外壳），预填到「项目名称」输入框。
 */

/** EOCD（End of Central Directory）签名 PK\x05\x06 */
const EOCD_SIGNATURE = 0x06054b50
/** 中央目录条目（Central Directory File Header）签名 PK\x01\x02 */
const CD_SIGNATURE = 0x02014b50
/** 中央目录条目固定头长度（46 字节，其后依次为文件名/扩展字段/注释） */
const CD_HEADER_LEN = 46
/** EOCD 记录 22 字节 + 最大注释 65535 字节：EOCD 必位于文件末尾 65557 字节内 */
const MAX_EOCD_SCAN = 22 + 65535

/**
 * 校验项目名是否合法（与新建/导入接口规则一致）：
 * 去除首尾空白后非空、不含 / 或 \、非 . 或 ..、长度不超过 64。
 *
 * @param name 待校验的名称
 * @returns 合法返回 true，否则 false
 */
export function isValidProjectName(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  if (trimmed === '.' || trimmed === '..' || /[\\/]/.test(trimmed)) return false
  return trimmed.length <= 64
}

/**
 * 从 zip 中央目录字节中探测「原始项目名」（即所有条目的共同顶层段）：
 * 忽略 macOS 打包器生成的 __MACOSX 杂项段；所有条目共享同一顶层段时
 * 返回该段（对应本项目导出格式的项目名外壳目录），
 * 扁平结构（存在多个顶层条目）或空包返回 null。
 *
 * @param cdBytes 中央目录区字节（从 EOCD 记录的 cdOffset 起、cdSize 长）
 * @param entryCount 中央目录条目总数（取自 EOCD）
 * @returns 顶层目录名；无法确定时返回 null
 */
export function detectZipWrapperName(cdBytes: Uint8Array, entryCount: number): string | null {
  const view = new DataView(cdBytes.buffer, cdBytes.byteOffset, cdBytes.byteLength)
  const segments = new Set<string>()
  let pos = 0
  for (let n = 0; n < entryCount; n++) {
    if (pos + CD_HEADER_LEN > cdBytes.byteLength) break
    if (view.getUint32(pos, true) !== CD_SIGNATURE) break
    const nameLen = view.getUint16(pos + 28, true)
    const extraLen = view.getUint16(pos + 30, true)
    const commentLen = view.getUint16(pos + 32, true)
    const nameBytes = cdBytes.subarray(pos + CD_HEADER_LEN, pos + CD_HEADER_LEN + nameLen)
    const name = new TextDecoder('utf-8').decode(nameBytes).replace(/\\/g, '/')
    const firstSegment = name.split('/')[0]
    if (firstSegment && firstSegment !== '__MACOSX') segments.add(firstSegment)
    pos += CD_HEADER_LEN + nameLen + extraLen + commentLen
  }
  if (segments.size === 1) {
    return segments.values().next().value as string
  }
  return null
}

/**
 * 在 zip 文件末尾字节中定位 EOCD 记录。
 * 从后向前扫描，优先匹配「记录结束位置恰为文件末尾」的精确项
 * （即 i + 22 + 注释长度 === 文件长度），避免误命中数据区中的签名；
 * 无精确匹配时退回最后一个签名位置（宽容处理）。
 *
 * @param tail 文件末尾字节（长度不超过 65557）
 * @returns EOCD 在 tail 中的起始偏移；未找到返回 -1
 */
function findEocd(tail: Uint8Array): number {
  if (tail.length < 22) return -1
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  for (let i = tail.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) !== EOCD_SIGNATURE) continue
    const commentLen = view.getUint16(i + 20, true)
    if (i + 22 + commentLen === tail.length) return i
  }
  for (let i = tail.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i
  }
  return -1
}

/**
 * 探测 zip 文件内的原始项目名（用于导入对话框预填）：
 * 1. 只读取文件末尾 ≤65557 字节定位 EOCD，取得中央目录偏移与条目数；
 * 2. 只读取中央目录区（纯元数据，几百 MB 大包也仅几十 KB）；
 * 3. 所有条目共享同一顶层段 → 该段即原始项目名；
 * 4. 否则（扁平包/空包/解析失败）回退为文件名去掉 .zip 后缀；
 * 5. 结果经合法性校验，非法时返回空字符串（导入时由服务端自动识别兜底）。
 *
 * @param file 用户选择的 zip 文件
 * @returns 原始项目名；无法确定合法名称时返回空字符串
 */
export async function detectZipProjectName(file: File): Promise<string> {
  if (file.size === 0) return ''
  const tailLen = Math.min(file.size, MAX_EOCD_SCAN)
  let tail: Uint8Array
  try {
    tail = new Uint8Array(await file.slice(file.size - tailLen, file.size).arrayBuffer())
  } catch {
    tail = new Uint8Array(0)
  }
  const eocd = findEocd(tail)
  let wrapper: string | null = null
  if (eocd !== -1) {
    const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
    const entryCount = view.getUint16(eocd + 10, true)
    const cdSize = view.getUint32(eocd + 12, true)
    const cdOffset = view.getUint32(eocd + 16, true)
    if (cdOffset + cdSize <= file.size) {
      try {
        const cd = new Uint8Array(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer())
        wrapper = detectZipWrapperName(cd, entryCount)
      } catch {
        // 中央目录读取失败：走文件名回退
      }
    }
  }
  if (wrapper && isValidProjectName(wrapper)) return wrapper.trim()
  // 回退：文件名取 basename 后去掉 .zip 后缀（与服务端推导规则一致）
  const baseName = file.name.replace(/\\/g, '/').split('/').pop() ?? ''
  const stripped = baseName.replace(/\.zip$/i, '')
  return isValidProjectName(stripped) ? stripped.trim() : ''
}
