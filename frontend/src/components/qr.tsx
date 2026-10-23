/**
 * Minimal QR Code generator (byte mode, error correction level M, versions 1-40, automatic mask),
 * following the ISO/IEC 18004 procedure as in Project Nayuki's reference implementation (MIT).
 * Used to draw the MoMo payment QR from the qrCodeUrl text that POST /api/invoices/{id}/checkout/momo returns.
 */

// Error correction level M: codewords per block and number of blocks, indexed by version.
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
const FORMAT_BITS_M = 0 // level M is 00 in the format information

function rawModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2
    result -= (25 * align - 10) * align - 55
    if (ver >= 7) result -= 36
  }
  return result
}
const dataCodewords = (ver: number) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver]

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMul(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = rsMul(root, 0x02)
  }
  return result
}
function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    divisor.forEach((coef, i) => { result[i] ^= rsMul(coef, factor) })
  }
  return result
}
function rsMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

/** Encodes text as a QR Code and returns its modules (true = dark), size × size. */
export function encodeQr(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text))
  let ver = 1
  for (; ver <= 40; ver++) {
    const countBits = ver <= 9 ? 8 : 16
    if (4 + countBits + bytes.length * 8 <= dataCodewords(ver) * 8) break
  }
  if (ver > 40) throw new Error('Nội dung quá dài để tạo mã QR')

  // Data bit stream: byte mode, length, data, terminator and padding.
  const bits: number[] = []
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  put(0b0100, 4)
  put(bytes.length, ver <= 9 ? 8 : 16)
  bytes.forEach((b) => put(b, 8))
  const capacity = dataCodewords(ver) * 8
  put(0, Math.min(4, capacity - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))

  // Split into blocks, add error correction, interleave.
  const numBlocks = NUM_BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver]
  const raw = Math.floor(rawModules(ver) / 8)
  const shortBlocks = numBlocks - (raw % numBlocks)
  const shortLen = Math.floor(raw / numBlocks)
  const divisor = rsDivisor(eccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, divisor)
    if (i < shortBlocks) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const codewords: number[] = []
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= shortBlocks) codewords.push(b[i]) })

  const size = ver * 4 + 17
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const isFn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; isFn[y][x] = true }

  // Function patterns: timing, finders, alignment, version.
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4)
    }
  }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4)
  const alignPos: number[] = []
  if (ver > 1) {
    const n = Math.floor(ver / 7) + 2
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2
    alignPos.push(6)
    for (let pos = size - 7; alignPos.length < n; pos -= step) alignPos.splice(1, 0, pos)
  }
  alignPos.forEach((ay, i) => alignPos.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === alignPos.length - 1) || (i === alignPos.length - 1 && j === 0)) return
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }))
  const drawFormat = (mask: number) => {
    const fdata = (FORMAT_BITS_M << 3) | mask
    let rem = fdata
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const b = ((fdata << 10) | rem) ^ 0x5412
    const bit = (i: number) => ((b >>> i) & 1) !== 0
    for (let i = 0; i <= 5; i++) set(8, i, bit(i))
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
    set(8, size - 8, true)
  }
  drawFormat(0)
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const b = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const dark = ((b >>> i) & 1) !== 0, a = size - 11 + (i % 3), c = Math.floor(i / 3)
      set(a, c, dark); set(c, a, dark)
    }
  }

  // Data modules in the zigzag order.
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert
      if (!isFn[y][x] && i < codewords.length * 8) { modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++ }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (isFn[y][x]) continue
      const invert = [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
        ((x * y) % 2) + ((x * y) % 3) === 0, (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][mask]
      if (invert) modules[y][x] = !modules[y][x]
    }
  }
  let best = 0, bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask); drawFormat(mask)
    const score = penalty(modules)
    if (score < bestScore) { best = mask; bestScore = score }
    applyMask(mask)
  }
  applyMask(best); drawFormat(best)
  return modules
}

/** Penalty score used to choose the mask (rules N1-N4). */
function penalty(m: boolean[][]): number {
  const size = m.length
  let result = 0
  const line = (get: (i: number) => boolean) => {
    let runColor = false, runLen = 0
    const history = [0, 0, 0, 0, 0, 0, 0]
    const addHistory = (len: number) => { if (history[0] === 0) len += size; history.pop(); history.unshift(len) }
    const finderLike = () => {
      const n = history[1]
      const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n
      return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
    }
    for (let i = 0; i < size; i++) {
      if (get(i) === runColor) {
        runLen++
        if (runLen === 5) result += 3
        else if (runLen > 5) result++
      } else {
        addHistory(runLen)
        if (!runColor) result += finderLike() * 40
        runColor = get(i)
        runLen = 1
      }
    }
    if (runColor) { addHistory(runLen); runLen = 0 }
    runLen += size
    addHistory(runLen)
    result += finderLike() * 40
  }
  for (let y = 0; y < size; y++) line((x) => m[y][x])
  for (let x = 0; x < size; x++) line((y) => m[y][x])
  let dark = 0
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (m[y][x]) dark++
    if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) result += 3
  }
  const total = size * size
  result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  return result
}

/** The QR Code as an SVG with a 4-module quiet zone. */
export function QrCode({ text, size = 220, label }: { text: string; size?: number; label?: string }) {
  let modules: boolean[][]
  try { modules = encodeQr(text) } catch { return null }
  const n = modules.length + 8
  let d = ''
  modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + 4},${y + 4}h1v1h-1z` }))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} role="img" aria-label={label ?? 'Mã QR'} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  )
}
