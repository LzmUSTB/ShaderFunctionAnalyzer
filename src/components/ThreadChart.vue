<template>
  <div class="thread-chart" ref="containerEl" @mousemove="onHover" @mouseleave="hover.visible = false">

    <svg v-if="props.chartData.length" class="chart-svg" :viewBox="`0 0 ${svgW} ${svgH}`" preserveAspectRatio="none">

      <!-- Grid lines -->
      <line v-for="g in svgGrid" :key="g.y" :x1="PL" :y1="g.y" :x2="svgW - PR" :y2="g.y" class="cg-grid" />

      <!-- Zero line -->
      <line v-if="cRange.hasZero" :x1="PL" :y1="cY(0)" :x2="svgW - PR" :y2="cY(0)" class="cg-zero" />

      <!-- Lines and square dots, one group per channel -->
      <g v-for="ch in activeChannels" :key="ch">
        <polyline :points="polylines[ch]" :class="`cg-line cg-line-${ch}`" fill="none" />
        <rect v-for="(d, i) in props.chartData" :key="i" :x="cX(i) - dotSz(i) / 2" :y="cY(d[ch]) - dotSz(i) / 2"
          :width="dotSz(i)" :height="dotSz(i)" :class="`cg-dot cg-dot-${ch}`"
          :style="hover.visible && hover.step === i ? 'stroke:#fff;stroke-width:1.5' : ''" />
      </g>

      <!-- Current scrubber step marker (dashed) -->
      <line v-if="props.chartData.length > 1" :x1="cX(clampStep)" :y1="PT" :x2="cX(clampStep)" :y2="PT + CH"
        class="cg-step" />

      <!-- Hover step marker -->
      <line v-if="hover.visible" :x1="cX(hover.step)" :y1="PT" :x2="cX(hover.step)" :y2="PT + CH"
        class="cg-hover-line" />

      <!-- Y-axis labels -->
      <text v-for="g in svgGrid" :key="`l${g.y}`" :x="PL - 4" :y="g.y" class="cg-label" text-anchor="end"
        dominant-baseline="middle">
        {{ g.label }}
      </text>

      <!-- X-axis labels -->
      <text :x="PL" :y="svgH - 3" class="cg-label" text-anchor="middle">0</text>
      <text v-if="props.chartData.length > 1" :x="svgW - PR" :y="svgH - 3" class="cg-label" text-anchor="end">
        {{ props.chartData.length - 1 }}
      </text>

      <!-- Legend -->
      <g v-for="(ch, ci) in activeChannels" :key="`leg${ch}`" :transform="`translate(${PL + ci * 34}, 2)`">
        <rect width="7" height="7" :class="`cg-dot-${ch}`" />
        <text x="10" y="7" class="cg-label">{{ chLabel(ch) }}</text>
      </g>
    </svg>

    <!-- Hover tooltip -->
    <div v-if="hover.visible && props.chartData.length" class="chart-tooltip" :style="{ left: hover.tooltipX + 'px' }">
      <div class="ct-step">step {{ hover.step }}</div>
      <div v-for="ch in activeChannels" :key="ch" class="ct-val" :style="{ color: CH_COLOR[ch] }">
        {{ chLabel(ch) }}: {{ hover.values[ch]?.toFixed(4) }}
      </div>
    </div>

    <!-- State hints -->
    <div v-if="!props.hasWatchVar" class="chart-hint">
      Select a variable chip to track
    </div>
    <div v-else-if="!props.chartData.length && !props.collecting" class="chart-hint">
      ↑ Click the graph to track a pixel
    </div>
    <div v-if="props.collecting" class="chart-hint">collecting…</div>

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  chartData: { type: Array, default: () => [] },
  iterN: { type: Number, default: 0 },
  watchVarType: { type: String, default: null },
  collecting: { type: Boolean, default: false },
  hasWatchVar: { type: Boolean, default: false },
})

// ── Container sizing — ResizeObserver keeps viewBox matched to the real box ───
const containerEl = ref(null)
const svgW = ref(300)
const svgH = ref(80)

let _ro = null
onMounted(() => {
  _ro = new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect
    if (width > 0) svgW.value = Math.round(width)
    if (height > 0) svgH.value = Math.round(height)
  })
  _ro.observe(containerEl.value)
})
onUnmounted(() => _ro?.disconnect())

// ── Layout constants (SVG units = container px, so these are real pixels) ────
const PL = 38   // left   — room for y-axis labels
const PR = 6    // right
const PT = 14   // top    — room for legend
const PB = 16   // bottom — room for x-axis labels

const CW = computed(() => svgW.value - PL - PR)
const CH = computed(() => svgH.value - PT - PB)

// ── Channel config ────────────────────────────────────────────────────────────
const CH_COLOR = { r: '#5dade2', g: '#5dbb5d', b: '#e8a838' }

const activeChannels = computed(() => {
  const t = props.watchVarType
  return !t || t === 'float' ? ['r'] : t === 'vec2' ? ['r', 'g'] : ['r', 'g', 'b']
})

function chLabel(ch) {
  const t = props.watchVarType
  if (ch === 'r') return !t || t === 'float' ? 'val' : t === 'vec2' ? 'x' : 'r'
  if (ch === 'g') return t === 'vec2' ? 'y' : 'g'
  return 'b'
}

// ── Data range ────────────────────────────────────────────────────────────────
const cRange = computed(() => {
  if (!props.chartData.length) return { min: 0, max: 1, range: 1, hasZero: false }
  const vals = props.chartData.flatMap(d => activeChannels.value.map(c => d[c]))
  let min = Math.min(...vals), max = Math.max(...vals)
  if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1 }
  if (Math.abs(max - min) < 1e-6) { min -= 0.5; max += 0.5 }
  return { min, max, range: max - min, hasZero: min < 0 && max > 0 }
})

// ── Coordinate helpers ────────────────────────────────────────────────────────
function cX(i) {
  const N = props.chartData.length
  return PL + (N > 1 ? i / (N - 1) : 0.5) * CW.value
}
function cY(val) {
  const { min, range } = cRange.value
  return PT + CH.value - ((val - min) / range) * CH.value
}
function dotSz(i) {
  return hover.visible && hover.step === i ? 7 : 4
}

const clampStep = computed(() =>
  Math.min(props.iterN, props.chartData.length - 1)
)

// ── Precomputed SVG geometry ──────────────────────────────────────────────────
const polylines = computed(() => {
  if (!props.chartData.length) return {}
  const result = {}
  for (const ch of activeChannels.value) {
    result[ch] = props.chartData
      .map((d, i) => `${cX(i).toFixed(1)},${cY(d[ch]).toFixed(1)}`)
      .join(' ')
  }
  return result
})

const svgGrid = computed(() => {
  const { min, range } = cRange.value
  return Array.from({ length: 5 }, (_, k) => ({
    y: PT + k * CH.value / 4,
    label: (min + (1 - k / 4) * range).toFixed(2),
  }))
})

// ── Hover interaction ─────────────────────────────────────────────────────────
const hover = reactive({ visible: false, step: 0, tooltipX: 0, values: {} })

function onHover(e) {
  if (!props.chartData.length) return
  const rect = e.currentTarget.getBoundingClientRect()
  const svgRelX = (e.clientX - rect.left) / rect.width * svgW.value
  const N = props.chartData.length
  const step = Math.max(0, Math.min(N - 1, Math.round((svgRelX - PL) / CW.value * (N - 1))))

  const TTIP_W = 110
  const relX = e.clientX - rect.left
  const tooltipX = relX + 12 + TTIP_W > rect.width ? relX - TTIP_W - 6 : relX + 12

  hover.visible = true
  hover.step = step
  hover.tooltipX = tooltipX
  hover.values = { ...props.chartData[step] }
}
</script>

<style scoped>
.thread-chart {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.chart-svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* ── Lines ── */
.cg-grid {
  stroke: #2a2a2a;
  stroke-width: 0.5;
}

.cg-zero {
  stroke: #3a3a3a;
  stroke-width: 0.5;
  stroke-dasharray: 3 3;
}

.cg-line {
  stroke-width: 1.5;
}

.cg-line-r {
  stroke: #5dade2;
}

.cg-line-g {
  stroke: #5dbb5d;
}

.cg-line-b {
  stroke: #e8a838;
}

.cg-step {
  stroke: rgba(255, 255, 255, .2);
  stroke-width: 0.5;
  stroke-dasharray: 2.5 2.5;
}

.cg-hover-line {
  stroke: rgba(255, 255, 255, .55);
  stroke-width: 0.7;
}

/* ── Square dots ── */
.cg-dot-r {
  fill: #5dade2;
}

.cg-dot-g {
  fill: #5dbb5d;
}

.cg-dot-b {
  fill: #e8a838;
}

/* ── Labels — 10 px in real pixels since viewBox === container px ── */
.cg-label {
  fill: #666;
  font-size: 10px;
}

/* ── Tooltip ── */
.chart-tooltip {
  position: absolute;
  top: 6px;
  background: rgba(0, 0, 0, .82);
  border: 1px solid #3a3a3a;
  border-radius: 1px;
  padding: 4px 8px;
  pointer-events: none;
  min-width: 100px;
}

.ct-step {
  font-size: 9px;
  color: #c2c2c2;
  margin-bottom: 2px;
}

.ct-val {
  font-size: 10px;
  line-height: 1.6;
}

/* ── Hints ── */
.chart-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #444;
  pointer-events: none;
}
</style>
