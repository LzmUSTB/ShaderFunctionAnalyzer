<template>
  <PanelFrame title="Graph">

    <!-- Scrubber bar (Mode B / thread tracker) -->
    <div v-if="selectedLoop?.watchVar" class="scrubber-bar">
      <div class="scrubber-top-row">
        <span class="scrubber-label">
          step {{ Math.round(iterN) }} / {{ maxIter }}
          &nbsp;·&nbsp;
          <strong>{{ selectedLoop.watchVar.type }} {{ selectedLoop.watchVar.name }}</strong>
          <span v-if="selectedLoop.isPreLoop" class="preloop-badge">pre-loop</span>
        </span>
        <label class="maxiter-label">
          steps
          <input class="maxiter-input" type="number" min="1" max="500" step="1" v-model.number="maxIter" />
        </label>
      </div>
      <input class="scrubber-slider" type="range"
             :min="0" :max="maxIter" :step="1" :value="Math.round(iterN)" @input="onScrub" />
    </div>

    <!-- Value range controls -->
    <div class="range-bar">
      <span class="range-label">range</span>
      <input class="range-input" type="number" step="0.1" v-model.number="heatMin" title="min value" />
      <span class="range-sep">→</span>
      <input class="range-input" type="number" step="0.1" v-model.number="heatMax" title="max value" />
      <button class="range-reset" @click="heatMin = -1; heatMax = 1" title="reset to ±1">↺</button>
    </div>

    <!-- Graph area: heatmap on top, SVG line chart below -->
    <div class="graph-area">

      <!-- ── Heatmap ── -->
      <div class="heatmap-wrap" :class="{ 'has-chart': selectedLoop?.watchVar }">
        <canvas ref="canvasEl" class="graph-canvas"
                :class="{ 'pick-cursor': selectedLoop?.watchVar }"
                @mousemove="onHover" @mouseleave="tooltip.visible = false"
                @click="onCanvasClick" />

        <!-- Crosshair on tracked pixel -->
        <div v-if="trackedPixel" class="crosshair"
             :style="{ left: trackedPixel.pct.x + '%', top: trackedPixel.pct.y + '%' }" />

        <!-- Hints and errors -->
        <div v-if="!selectedFunction && !selectedLoop?.watchVar" class="overlay-hint">
          Select a function to plot, or select a variable chip to track
        </div>
        <div v-if="selectedLoop?.watchVar && !trackedPixel" class="overlay-click-hint">
          Click to pick a pixel and see its thread chart
        </div>
        <div v-if="errorMsg" class="overlay-error">{{ errorMsg }}</div>

        <!-- Hover tooltip -->
        <div v-if="tooltip.visible" class="tooltip"
             :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }">{{ tooltip.text }}</div>
      </div>

      <!-- ── Thread chart (SVG) ── -->
      <div v-if="selectedLoop?.watchVar" class="chart-wrap"
           @mousemove="onChartHover" @mouseleave="chartHover.visible = false">

        <!-- SVG chart — scales automatically, no canvas stretching -->
        <svg v-if="chartData.length"
             class="chart-svg"
             :viewBox="`0 0 ${C.W} ${C.H}`"
             preserveAspectRatio="none">

          <!-- Grid lines -->
          <line v-for="g in svgGrid" :key="g.y"
                :x1="C.PL" :y1="g.y" :x2="C.W - C.PR" :y2="g.y" class="cg-grid" />

          <!-- Zero line -->
          <line v-if="cRange.hasZero"
                :x1="C.PL" :y1="cY(0)" :x2="C.W - C.PR" :y2="cY(0)" class="cg-zero" />

          <!-- Lines and dots, one group per channel -->
          <g v-for="ch in activeChannels" :key="ch">
            <polyline :points="polylines[ch]" :class="`cg-line cg-line-${ch}`" fill="none" />
            <circle v-for="(d, i) in chartData" :key="i"
                    :cx="cX(i)" :cy="cY(d[ch])"
                    :r="chartHover.visible && chartHover.step === i ? 3.5 : 2"
                    :class="`cg-dot cg-dot-${ch}`"
                    :style="chartHover.visible && chartHover.step === i
                      ? 'stroke:#fff;stroke-width:1.5' : ''" />
          </g>

          <!-- Current scrubber step marker (dashed) -->
          <line v-if="chartData.length > 1"
                :x1="cX(Math.min(Math.round(iterN), chartData.length - 1))" :y1="C.PT"
                :x2="cX(Math.min(Math.round(iterN), chartData.length - 1))" :y2="C.PT + C.CH"
                class="cg-step" />

          <!-- Hover step marker -->
          <line v-if="chartHover.visible"
                :x1="cX(chartHover.step)" :y1="C.PT"
                :x2="cX(chartHover.step)" :y2="C.PT + C.CH"
                class="cg-hover-line" />

          <!-- Y-axis labels -->
          <text v-for="g in svgGrid" :key="`l${g.y}`"
                :x="C.PL - 2" :y="g.y" class="cg-label"
                text-anchor="end" dominant-baseline="middle">{{ g.label }}</text>

          <!-- X-axis labels -->
          <text :x="C.PL" :y="C.H - 2" class="cg-label" text-anchor="middle">0</text>
          <text v-if="chartData.length > 1"
                :x="C.W - C.PR" :y="C.H - 2" class="cg-label" text-anchor="end">
            {{ chartData.length - 1 }}
          </text>

          <!-- Legend -->
          <g v-for="(ch, ci) in activeChannels" :key="`leg${ch}`"
             :transform="`translate(${C.PL + ci * 28}, ${C.PT})`">
            <rect width="6" height="6" :class="`cg-dot-${ch}`" />
            <text x="8" y="5.5" class="cg-label">{{ chLabel(ch) }}</text>
          </g>
        </svg>

        <!-- Hover tooltip (HTML — easier to style than SVG text) -->
        <div v-if="chartHover.visible && chartData.length" class="chart-tooltip"
             :style="{ left: chartHover.tooltipX + 'px' }">
          <div class="ct-step">step {{ chartHover.step }}</div>
          <div v-for="ch in activeChannels" :key="ch" class="ct-val"
               :style="{ color: CH_COLOR[ch] }">
            {{ chLabel(ch) }}: {{ chartHover.values[ch]?.toFixed(4) }}
          </div>
        </div>

        <div v-if="!trackedPixel && !collecting" class="chart-hint">
          ↑ Click the heatmap to track a pixel
        </div>
        <div v-if="collecting" class="chart-hint">collecting…</div>
      </div>

    </div>
  </PanelFrame>
</template>

<script setup>
import { ref, watch, onMounted, reactive, computed } from 'vue'
import PanelFrame from './PanelFrame.vue'
import { WebGLRenderer } from '../utils/webglRenderer'
import { wrapFunction, wrapMain } from '../utils/shaderWrapper'
import { instrumentLoop } from '../utils/loopInstrumenter'

const props = defineProps({
  selectedFunction: { type: Object, default: null },
  selectedLoop:     { type: Object, default: null },
  shaderSource:     { type: String, default: '' },
  uniformValues:    { type: Object, default: () => ({}) },
})

const canvasEl = ref(null)
const errorMsg = ref(null)
const tooltip  = reactive({ visible: false, x: 0, y: 0, text: '' })

// Heatmap range
const heatMin = ref(-1)
const heatMax = ref(1)

// Scrubber
const iterN   = ref(0)
const maxIter = ref(30)

// Thread tracker
const trackedPixel = ref(null)   // { cx, cy, pct: {x,y} }
const chartData    = ref([])     // [{ step, r, g, b }, …]
const collecting   = ref(false)
const isDirectMode = ref(false)

// Chart hover (SVG is reactive, no redraw needed)
const chartHover = reactive({ visible: false, step: 0, tooltipX: 0, values: {} })

let renderer = null

// ── SVG chart constants ───────────────────────────────────────────────────────
// Edit these to control the chart layout in SVG coordinate space.
const C = { W: 300, H: 80, PL: 45, PR: 8, PT: 8, PB: 20 }
C.CW = C.W - C.PL - C.PR   // chart plot width
C.CH = C.H - C.PT - C.PB   // chart plot height

// Channel colors — edit here to restyle the chart lines
const CH_COLOR = { r: '#5dade2', g: '#5dbb5d', b: '#e8a838' }

// ── SVG chart computed helpers ────────────────────────────────────────────────
const activeChannels = computed(() => {
  const t = props.selectedLoop?.watchVar?.type
  return !t || t === 'float' ? ['r'] : t === 'vec2' ? ['r', 'g'] : ['r', 'g', 'b']
})

function chLabel(ch) {
  const t = props.selectedLoop?.watchVar?.type
  if (ch === 'r') return !t || t === 'float' ? 'val' : t === 'vec2' ? 'x' : 'r'
  if (ch === 'g') return t === 'vec2' ? 'y' : 'g'
  return 'b'
}

const cRange = computed(() => {
  if (!chartData.value.length) return { min: 0, max: 1, range: 1, hasZero: false }
  const vals = chartData.value.flatMap(d => activeChannels.value.map(c => d[c]))
  let min = Math.min(...vals), max = Math.max(...vals)
  if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1 }
  if (Math.abs(max - min) < 1e-6) { min -= 0.5; max += 0.5 }
  return { min, max, range: max - min, hasZero: min < 0 && max > 0 }
})

function cX(i) {
  const N = chartData.value.length
  return C.PL + (N > 1 ? i / (N - 1) : 0.5) * C.CW
}
function cY(val) {
  const { min, range } = cRange.value
  return C.PT + C.CH - ((val - min) / range) * C.CH
}

const polylines = computed(() => {
  if (!chartData.value.length) return {}
  const result = {}
  for (const ch of activeChannels.value) {
    result[ch] = chartData.value
      .map((d, i) => `${cX(i).toFixed(1)},${cY(d[ch]).toFixed(1)}`)
      .join(' ')
  }
  return result
})

const svgGrid = computed(() => {
  const { min, range } = cRange.value
  return Array.from({ length: 5 }, (_, k) => ({
    y:     C.PT + k * C.CH / 4,
    label: (min + (1 - k / 4) * range).toFixed(2),
  }))
})

// ── Init WebGL via ResizeObserver ─────────────────────────────────────────────
onMounted(() => {
  const observer = new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect
    if (width === 0 || height === 0) return

    canvasEl.value.width  = Math.round(width)
    canvasEl.value.height = Math.round(height)

    // Canvas pixel coords are invalid after resize — clear tracker
    trackedPixel.value = null
    chartData.value    = []

    if (!renderer) {
      try {
        renderer = new WebGLRenderer(canvasEl.value)
      } catch (e) {
        errorMsg.value = e.message
        observer.disconnect()
        return
      }
    }

    if (props.selectedFunction)            plotFunction(props.selectedFunction)
    else if (props.selectedLoop?.watchVar) plotLoop()
  })
  observer.observe(canvasEl.value.parentElement)
})

// ── Watches ───────────────────────────────────────────────────────────────────
watch(() => props.selectedFunction, (fn) => {
  if (!renderer) return
  if (!fn) { clearCanvas(); errorMsg.value = null }
  else plotFunction(fn)
})

watch(() => props.uniformValues, () => {
  if (!renderer) return
  if (props.selectedFunction)            plotFunction(props.selectedFunction)
  else if (props.selectedLoop?.watchVar) {
    plotLoop()
    if (trackedPixel.value) collectThreadData()
  }
}, { deep: true })

watch(() => props.selectedLoop, (sl) => {
  if (!renderer) return
  // Clear the thread chart whenever the watched variable changes
  trackedPixel.value    = null
  chartData.value       = []
  chartHover.visible    = false
  if (!sl?.watchVar) { clearCanvas(); errorMsg.value = null; return }
  iterN.value = 0
  plotLoop()
}, { deep: true })

watch([heatMin, heatMax], () => {
  if (!renderer) return
  if (props.selectedFunction)            plotFunction(props.selectedFunction)
  else if (props.selectedLoop?.watchVar) plotLoop()
})

// ── Scrubber ──────────────────────────────────────────────────────────────────
function onScrub(e) {
  iterN.value = Number(e.target.value)
  plotLoop()
}

// ── Mode A: heatmap of a pure function ───────────────────────────────────────
function plotFunction(fn) {
  errorMsg.value = null

  if (fn.returnType === 'void') {
    if (fn.name === 'main') {
      isDirectMode.value = true
      const fragSrc = wrapMain(props.shaderSource)
      const result  = renderer.compile(fragSrc)
      if (!result.ok) { errorMsg.value = result.error; return }
      renderer.renderDirect(props.uniformValues)
    } else {
      errorMsg.value = `"${fn.name}" returns void — select a variable chip beneath it to track it.`
    }
    return
  }

  isDirectMode.value = false
  const fragSrc = wrapFunction(props.shaderSource, fn, { xMin:-1, xMax:1, yMin:-1, yMax:1 })
  const result  = renderer.compile(fragSrc)
  if (!result.ok) { errorMsg.value = result.error; return }
  renderer.minVal = heatMin.value
  renderer.maxVal = heatMax.value
  renderer.render(props.uniformValues)
}

// ── Mode B / Thread Tracker: instrumented shader ──────────────────────────────
function plotLoop() {
  isDirectMode.value = false
  if (!props.selectedLoop?.watchVar) return
  errorMsg.value = null

  const fragSrc = instrumentLoop(props.shaderSource, props.selectedLoop)
  const result  = renderer.compile(fragSrc)
  if (!result.ok) { errorMsg.value = result.error; return }

  renderer.minVal = heatMin.value
  renderer.maxVal = heatMax.value
  renderer.render({ ...props.uniformValues, u_debug_N: iterN.value })
}

// ── Pixel picker ──────────────────────────────────────────────────────────────
function onCanvasClick(e) {
  if (!renderer || !props.selectedLoop?.watchVar) return

  const rect   = canvasEl.value.getBoundingClientRect()
  const scaleX = canvasEl.value.width  / rect.width
  const scaleY = canvasEl.value.height / rect.height
  const cx = Math.round((e.clientX - rect.left) * scaleX)
  const cy = Math.round((e.clientY - rect.top)  * scaleY)
  const pct = {
    x: (e.clientX - rect.left) / rect.width  * 100,
    y: (e.clientY - rect.top)  / rect.height * 100,
  }

  trackedPixel.value = { cx, cy, pct }
  collectThreadData()
}

// ── Thread data collection ────────────────────────────────────────────────────
function collectThreadData() {
  if (!trackedPixel.value || !props.selectedLoop?.watchVar || !renderer) return

  collecting.value = true

  const fragSrc = instrumentLoop(props.shaderSource, props.selectedLoop)
  const result  = renderer.compile(fragSrc)
  if (!result.ok) { errorMsg.value = result.error; collecting.value = false; return }

  const { cx, cy } = trackedPixel.value
  const data = []

  for (let step = 0; step <= maxIter.value; step++) {
    renderer.minVal = heatMin.value
    renderer.maxVal = heatMax.value
    renderer.render({ ...props.uniformValues, u_debug_N: step })
    const px = renderer.readPixel(cx, cy)
    data.push({ step, r: px[0], g: px[1], b: px[2] })
  }

  chartData.value  = data
  collecting.value = false

  // Restore heatmap at current scrubber position
  renderer.minVal = heatMin.value
  renderer.maxVal = heatMax.value
  renderer.render({ ...props.uniformValues, u_debug_N: iterN.value })
  // SVG updates reactively — no explicit redraw needed
}

// ── Chart hover (SVG coord conversion) ───────────────────────────────────────
function onChartHover(e) {
  if (!chartData.value.length) return
  const rect    = e.currentTarget.getBoundingClientRect()
  const svgRelX = (e.clientX - rect.left) / rect.width * C.W
  const N       = chartData.value.length
  const rawStep = (svgRelX - C.PL) / C.CW * (N - 1)
  const step    = Math.max(0, Math.min(N - 1, Math.round(rawStep)))

  const TTIP_W   = 110
  const relX     = e.clientX - rect.left
  const tooltipX = relX + 12 + TTIP_W > rect.width ? relX - TTIP_W - 6 : relX + 12

  chartHover.visible  = true
  chartHover.step     = step
  chartHover.tooltipX = tooltipX
  chartHover.values   = { ...chartData.value[step] }
}

// ── Heatmap hover tooltip ─────────────────────────────────────────────────────
function onHover(e) {
  if (!renderer) return
  if (!props.selectedFunction && !props.selectedLoop?.watchVar) return

  const rect   = canvasEl.value.getBoundingClientRect()
  const scaleX = canvasEl.value.width  / rect.width
  const scaleY = canvasEl.value.height / rect.height
  const cx     = (e.clientX - rect.left) * scaleX
  const cy     = (e.clientY - rect.top)  * scaleY

  const [r, g, b] = renderer.readPixel(cx, cy)
  const plotX = (cx / canvasEl.value.width)  * 2 - 1
  const plotY = (cy / canvasEl.value.height) * 2 - 1

  let valueText
  if (isDirectMode.value) {
    valueText = `rgb(${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)})`
  } else {
    const wv = props.selectedLoop?.watchVar
    valueText = wv?.type === 'vec2' ? `(${r.toFixed(3)}, ${g.toFixed(3)})` : r.toFixed(4)
  }

  const TOOLTIP_W = 200, TOOLTIP_H = 28, gap = 14
  const x = e.offsetX + gap + TOOLTIP_W > canvasEl.value.offsetWidth
    ? e.offsetX - gap - TOOLTIP_W : e.offsetX + gap
  const y = e.offsetY + gap + TOOLTIP_H > canvasEl.value.offsetHeight
    ? e.offsetY - gap - TOOLTIP_H : e.offsetY + gap

  tooltip.visible = true
  tooltip.x = x
  tooltip.y = y
  tooltip.text = `(${plotX.toFixed(2)}, ${plotY.toFixed(2)}) = ${valueText}`
}

function clearCanvas() {
  const gl = renderer?.gl
  if (!gl) return
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  trackedPixel.value = null
  chartData.value    = []
}
</script>

<style scoped>
/* ── Scrubber ── */
.scrubber-bar { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; border-bottom: 1px solid #3a3a3a; flex-shrink: 0; }
.scrubber-top-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.scrubber-label { font-size: 11px; color: #aaa; }
.scrubber-label strong { color: #e8a838; }
.preloop-badge { font-size: 9px; background: #7a4ab8; color: #fff; border-radius: 3px; padding: 1px 4px; margin-left: 4px; vertical-align: middle; }
.scrubber-slider { width: 100%; accent-color: #e8a838; }
.maxiter-label { font-size: 10px; color: #555; display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.maxiter-input { width: 48px; background: #1e1e1e; border: 1px solid #444; border-radius: 3px; color: #aaa; font-size: 10px; padding: 1px 4px; text-align: center; -moz-appearance: textfield; }
.maxiter-input::-webkit-inner-spin-button, .maxiter-input::-webkit-outer-spin-button { display: none; }

/* ── Range bar ── */
.range-bar { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-bottom: 1px solid #3a3a3a; flex-shrink: 0; }
.range-label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.08em; flex-shrink: 0; }
.range-input { width: 52px; background: #1e1e1e; border: 1px solid #444; border-radius: 3px; color: #e0e0e0; font-size: 11px; font-family: monospace; padding: 2px 4px; text-align: center; -moz-appearance: textfield; }
.range-input::-webkit-inner-spin-button, .range-input::-webkit-outer-spin-button { display: none; }
.range-input:focus { outline: none; border-color: #5dade2; }
.range-sep { font-size: 11px; color: #555; }
.range-reset { background: none; border: 1px solid #444; border-radius: 3px; color: #888; font-size: 12px; padding: 1px 5px; cursor: pointer; line-height: 1; }
.range-reset:hover { color: #fff; border-color: #888; }

/* ── Graph area ── */
.graph-area { flex: 1; display: flex; flex-direction: column; margin: 0.5em; gap: 4px; min-height: 0; }

/* Heatmap */
.heatmap-wrap { flex: 1; position: relative; overflow: hidden; background-color: #fff; min-height: 0; }
.heatmap-wrap.has-chart { flex: 3; }
.graph-canvas { width: 100%; height: 100%; display: block; }
.pick-cursor  { cursor: crosshair; }
.crosshair { position: absolute; width: 14px; height: 14px; border: 2px solid #e8a838; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none; box-shadow: 0 0 0 1px rgba(0,0,0,0.5); }

/* ── SVG chart ── */
.chart-wrap { flex: 2; position: relative; background: #161616; border-radius: 3px; overflow: hidden; min-height: 80px; cursor: crosshair; }

/* SVG element styles — edit to restyle the chart */
.chart-svg { width: 100%; height: 100%; display: block; }
.cg-grid      { stroke: #2a2a2a; stroke-width: 0.4; }
.cg-zero      { stroke: #3a3a3a; stroke-width: 0.4; stroke-dasharray: 3 3; }
.cg-line      { stroke-width: 1.5; }
.cg-line-r    { stroke: #5dade2; }
.cg-line-g    { stroke: #5dbb5d; }
.cg-line-b    { stroke: #e8a838; }
.cg-dot-r     { fill: #5dade2; }
.cg-dot-g     { fill: #5dbb5d; }
.cg-dot-b     { fill: #e8a838; }
.cg-step      { stroke: rgba(255,255,255,0.2); stroke-width: 0.5; stroke-dasharray: 2.5 2.5; }
.cg-hover-line{ stroke: rgba(255,255,255,0.55); stroke-width: 0.6; }
.cg-label     { fill: #555; font-size: 5px; font-family: monospace; }

/* Chart tooltip */
.chart-tooltip { position: absolute; top: 6px; background: rgba(0,0,0,0.82); border: 1px solid #3a3a3a; border-radius: 4px; padding: 4px 8px; pointer-events: none; min-width: 100px; }
.ct-step { font-size: 9px; color: #555; margin-bottom: 2px; font-family: monospace; }
.ct-val  { font-size: 10px; font-family: monospace; line-height: 1.6; }

.chart-hint { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #444; pointer-events: none; }

/* ── Overlays ── */
.overlay-hint, .overlay-error, .overlay-click-hint { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; padding: 16px; text-align: center; pointer-events: none; }
.overlay-hint        { color: #444; }
.overlay-click-hint  { color: #555; font-size: 11px; align-items: flex-end; padding-bottom: 10px; }
.overlay-error { background: rgba(60,0,0,0.85); color: #ff6b6b; white-space: pre-wrap; align-items: flex-start; font-family: monospace; font-size: 11px; }

/* ── Tooltip ── */
.tooltip { position: absolute; width: 200px; background: rgba(0,0,0,0.75); color: #fff; font-size: 11px; padding: 4px 8px; border-radius: 4px; pointer-events: none; white-space: nowrap; box-sizing: border-box; }
</style>
