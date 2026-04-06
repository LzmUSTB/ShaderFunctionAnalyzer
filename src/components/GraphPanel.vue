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
      <input class="scrubber-slider" type="range" :min="0" :max="maxIter" :step="1" :value="Math.round(iterN)"
        @input="onScrub" />
    </div>

    <!-- Value range controls — hidden when displaying true color (vec3/vec4 or void main) -->
    <div v-if="!isDirectMode" class="range-bar">
      <span class="range-label">range</span>
      <input class="range-input" type="number" step="0.1" v-model.number="heatMin" title="min value" />
      <span class="range-sep">→</span>
      <input class="range-input" type="number" step="0.1" v-model.number="heatMax" title="max value" />
      <button class="range-reset" @click="heatMin = -1; heatMax = 1" title="reset to ±1">↺</button>
    </div>

    <!-- Graph area: heatmap on top, SVG line chart below -->
    <div class="graph-area" ref="graphAreaEl" :class="{ dragging: isDragging }">

      <!-- ── Heatmap ── -->
      <div class="heatmap-wrap" :style="{ height: splitPct + '%' }">
        <canvas ref="canvasEl" class="graph-canvas" :class="{ 'pick-cursor': selectedLoop?.watchVar }"
          @mousemove="onHover" @mouseleave="tooltip.visible = false" @click="onCanvasClick" />

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
        <div v-if="tooltip.visible" ref="tooltipEl" class="tooltip"
          :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }">{{
            tooltip.text }}</div>
      </div>

      <!-- ── Resize splitter ── -->
      <div class="splitter" @mousedown="onSplitterMouseDown">
        <div class="splitter-handle"></div>
      </div>

      <!-- ── Thread chart ── -->
      <div class="chart-wrap">
        <ThreadChart :chart-data="chartData" :iter-n="Math.round(iterN)"
          :watch-var-type="selectedLoop?.watchVar?.type ?? null" :collecting="collecting"
          :has-watch-var="!!selectedLoop?.watchVar" />
      </div>
    </div>
  </PanelFrame>
</template>

<script setup>
import { ref, watch, onMounted, reactive } from 'vue'
import ThreadChart from './ThreadChart.vue'
import PanelFrame from './PanelFrame.vue'
import { WebGLRenderer } from '../utils/webglRenderer'
import { wrapFunction, wrapMain } from '../utils/shaderWrapper'
import { instrumentLoop } from '../utils/loopInstrumenter'
import { nextTick } from 'vue'

const props = defineProps({
  selectedFunction: { type: Object, default: null },
  selectedLoop: { type: Object, default: null },
  shaderSource: { type: String, default: '' },
  uniformValues: { type: Object, default: () => ({}) },
})

const canvasEl = ref(null)
const errorMsg = ref(null)
const tooltipEl = ref(null)
const graphAreaEl = ref(null)
const tooltip = reactive({ visible: false, x: 0, y: 0, text: '' })

// ── Resizable splitter ────────────────────────────────────────────────────────
const splitPct = ref(65)   // percentage of graph-area height given to heatmap
const isDragging = ref(false)

function onSplitterMouseDown(e) {
  e.preventDefault()
  isDragging.value = true
  const startY = e.clientY
  const startPct = splitPct.value

  function onMove(ev) {
    const rect = graphAreaEl.value.getBoundingClientRect()
    const deltaPct = (ev.clientY - startY) / rect.height * 100
    splitPct.value = Math.max(15, Math.min(85, startPct + deltaPct))
  }
  function onUp() {
    isDragging.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// Heatmap range
const heatMin = ref(-1)
const heatMax = ref(1)

// Scrubber
const iterN = ref(0)
const maxIter = ref(30)

// Thread tracker
const trackedPixel = ref(null)   // { cx, cy, pct: {x,y} }
const chartData = ref([])     // [{ step, r, g, b }, …]
const collecting = ref(false)
const isDirectMode = ref(false)

let renderer = null

// ── Init WebGL via ResizeObserver ─────────────────────────────────────────────
onMounted(() => {
  const observer = new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect
    if (width === 0 || height === 0) return

    const newW = Math.round(width)
    const newH = Math.round(height)
    canvasEl.value.width = newW
    canvasEl.value.height = newH

    if (!renderer) {
      try {
        renderer = new WebGLRenderer(canvasEl.value)
      } catch (e) {
        errorMsg.value = e.message
        observer.disconnect()
        return
      }
    }

    // Recalculate tracked pixel canvas coords from its stored percentage so
    // the thread chart survives a browser resize without needing to re-pick.
    if (trackedPixel.value) {
      const { pct } = trackedPixel.value
      trackedPixel.value = {
        cx: Math.round(pct.x / 100 * newW),
        cy: Math.round(pct.y / 100 * newH),
        pct,
      }
    } else {
      chartData.value = []
    }

    if (props.selectedFunction) plotFunction(props.selectedFunction)
    else if (props.selectedLoop?.watchVar) {
      plotLoop()
      if (trackedPixel.value) collectThreadData()
    }
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
  if (props.selectedFunction) plotFunction(props.selectedFunction)
  else if (props.selectedLoop?.watchVar) {
    plotLoop()
    if (trackedPixel.value) collectThreadData()
  }
}, { deep: true })

watch(() => props.selectedLoop, (sl) => {
  if (!renderer) return
  // Clear the thread chart whenever the watched variable changes
  trackedPixel.value = null
  chartData.value = []
  if (!sl?.watchVar) { clearCanvas(); errorMsg.value = null; return }
  iterN.value = 0
  plotLoop()
}, { deep: true })

watch([heatMin, heatMax], () => {
  if (!renderer) return
  if (props.selectedFunction) plotFunction(props.selectedFunction)
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
      const result = renderer.compile(fragSrc)
      if (!result.ok) { errorMsg.value = result.error; return }
      renderer.renderDirect(props.uniformValues)
    } else {
      errorMsg.value = `"${fn.name}" returns void — select a variable chip beneath it to track it.`
    }
    return
  }

  // Matrix types cannot be mapped to a single float for the heatmap
  const PLOTTABLE = new Set(['float', 'int', 'vec2', 'vec3', 'vec4'])
  if (!PLOTTABLE.has(fn.returnType)) {
    errorMsg.value = `"${fn.name}" returns ${fn.returnType} — matrix types cannot be plotted as a heatmap.\n\nSelect an individual loop variable chip to use the thread tracker.`
    return
  }

  isDirectMode.value = false
  const fragSrc = wrapFunction(props.shaderSource, fn, { xMin: -1, xMax: 1, yMin: -1, yMax: 1 })
  const result = renderer.compile(fragSrc)
  if (!result.ok) { errorMsg.value = result.error; return }
  renderer.minVal = heatMin.value
  renderer.maxVal = heatMax.value
  renderer.render(props.uniformValues)
}

// ── Mode B / Thread Tracker: instrumented shader ──────────────────────────────
function plotLoop() {
  if (!props.selectedLoop?.watchVar) return
  errorMsg.value = null

  const wvType = props.selectedLoop.watchVar.type
  const isColor = wvType === 'vec3' || wvType === 'vec4'
  isDirectMode.value = isColor

  const fragSrc = instrumentLoop(props.shaderSource, props.selectedLoop)
  const result = renderer.compile(fragSrc)
  if (!result.ok) { errorMsg.value = result.error; return }

  const uniforms = { ...props.uniformValues, u_debug_N: iterN.value }
  if (isColor) {
    renderer.renderDirect(uniforms)
  } else {
    renderer.minVal = heatMin.value
    renderer.maxVal = heatMax.value
    renderer.render(uniforms)
  }
}

// ── Pixel picker ──────────────────────────────────────────────────────────────
function onCanvasClick(e) {
  if (!renderer || !props.selectedLoop?.watchVar) return

  const rect = canvasEl.value.getBoundingClientRect()
  const scaleX = canvasEl.value.width / rect.width
  const scaleY = canvasEl.value.height / rect.height
  const cx = Math.round((e.clientX - rect.left) * scaleX)
  const cy = Math.round((e.clientY - rect.top) * scaleY)
  const pct = {
    x: (e.clientX - rect.left) / rect.width * 100,
    y: (e.clientY - rect.top) / rect.height * 100,
  }

  trackedPixel.value = { cx, cy, pct }
  collectThreadData()
}

// ── Thread data collection ────────────────────────────────────────────────────
function collectThreadData() {
  if (!trackedPixel.value || !props.selectedLoop?.watchVar || !renderer) return

  collecting.value = true

  const fragSrc = instrumentLoop(props.shaderSource, props.selectedLoop)
  const result = renderer.compile(fragSrc)
  if (!result.ok) { errorMsg.value = result.error; collecting.value = false; return }

  const { cx, cy } = trackedPixel.value
  const wvType = props.selectedLoop.watchVar.type
  const isColor = wvType === 'vec3' || wvType === 'vec4'
  const data = []

  for (let step = 0; step <= maxIter.value; step++) {
    const uniforms = { ...props.uniformValues, u_debug_N: step }
    if (isColor) {
      renderer.renderDirect(uniforms)
    } else {
      renderer.minVal = heatMin.value
      renderer.maxVal = heatMax.value
      renderer.render(uniforms)
    }
    const px = renderer.readPixel(cx, cy)
    data.push({ step, r: px[0], g: px[1], b: px[2] })
  }

  chartData.value = data
  collecting.value = false

  // Restore display at current scrubber position
  const restoreUniforms = { ...props.uniformValues, u_debug_N: iterN.value }
  if (isColor) {
    renderer.renderDirect(restoreUniforms)
  } else {
    renderer.minVal = heatMin.value
    renderer.maxVal = heatMax.value
    renderer.render(restoreUniforms)
  }
  // SVG updates reactively — no explicit redraw needed
}

// ── Heatmap hover tooltip ─────────────────────────────────────────────────────
async function onHover(e) {
  if (!renderer) return
  if (!props.selectedFunction && !props.selectedLoop?.watchVar) return

  const rect = canvasEl.value.getBoundingClientRect()
  const scaleX = canvasEl.value.width / rect.width
  const scaleY = canvasEl.value.height / rect.height
  const cx = (e.clientX - rect.left) * scaleX
  const cy = (e.clientY - rect.top) * scaleY

  const [r, g, b] = renderer.readPixel(cx, cy)
  const plotX = (cx / canvasEl.value.width) * 2 - 1
  const plotY = (cy / canvasEl.value.height) * 2 - 1

  let valueText
  if (isDirectMode.value) {
    valueText = `rgb(${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)})`
  } else {
    const wv = props.selectedLoop?.watchVar
    valueText = wv?.type === 'vec2'
      ? `(${r.toFixed(3)}, ${g.toFixed(3)})`
      : r.toFixed(4)
  }

  tooltip.text = `(${plotX.toFixed(2)}, ${plotY.toFixed(2)}) = ${valueText}`
  tooltip.visible = true

  tooltip.x = -9999
  tooltip.y = -9999

  await nextTick()

  const w = tooltipEl.value.offsetWidth
  const h = tooltipEl.value.offsetHeight
  const gap = 14

  let x = e.offsetX + gap
  let y = e.offsetY + gap

  if (x + w > canvasEl.value.offsetWidth) {
    x = e.offsetX - gap - w
  }
  if (y + h > canvasEl.value.offsetHeight) {
    y = e.offsetY - gap - h
  }

  tooltip.x = x
  tooltip.y = y
}


function clearCanvas() {
  const gl = renderer?.gl
  if (!gl) return
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  trackedPixel.value = null
  chartData.value = []
}
</script>

<style scoped>
/* ── Scrubber ── */
.scrubber-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid #3a3a3a;
  flex-shrink: 0;
}

.scrubber-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.scrubber-label {
  font-size: 11px;
  color: #aaa;
}

.scrubber-label strong {
  color: #e8a838;
}

.preloop-badge {
  font-size: 0.9em;
  background: #4d4d4d;
  color: #fff;
  padding: 1px 4px;
  margin-left: 4px;
  vertical-align: middle;
}

.scrubber-slider {
  width: 100%;
  accent-color: #e8a838;
}

.maxiter-label {
  font-size: 10px;
  color: #555;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.maxiter-input {
  width: 48px;
  background: #1e1e1e;
  border: 1px solid #444;
  border-radius: 3px;
  color: #aaa;
  font-size: 10px;
  padding: 1px 4px;
  text-align: center;
  -moz-appearance: textfield;
}

.maxiter-input::-webkit-inner-spin-button,
.maxiter-input::-webkit-outer-spin-button {
  display: none;
}

/* ── Range bar ── */
.range-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid #3a3a3a;
  flex-shrink: 0;
}

.range-label {
  font-size: 10px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  flex-shrink: 0;
}

.range-input {
  width: 52px;
  background: #1e1e1e;
  border: 1px solid #444;
  border-radius: 3px;
  color: #e0e0e0;
  font-size: 11px;
  padding: 2px 4px;
  text-align: center;
  -moz-appearance: textfield;
}

.range-input::-webkit-inner-spin-button,
.range-input::-webkit-outer-spin-button {
  display: none;
}

.range-input:focus {
  outline: none;
  border-color: #5dade2;
}

.range-sep {
  font-size: 11px;
  color: #555;
}

.range-reset {
  background: none;
  border: 1px solid #444;
  border-radius: 3px;
  font-size: 12px;
  padding: 1px 5px;
  cursor: pointer;
  line-height: 1;
}

.range-reset:hover {
  color: #fff;
  border-color: #888;
}

/* ── Graph area ── */
.graph-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  margin: 0.5em;
  min-height: 0;
}

/* Prevent text selection while dragging the splitter */
.graph-area.dragging {
  cursor: row-resize;
  user-select: none;
}

/* Heatmap — height driven by :style="{ height: splitPct + '%' }" */
.heatmap-wrap {
  flex: none;
  position: relative;
  overflow: hidden;
  background-color: #fff;
  min-height: 0;
}

/* ── Splitter ── */
.splitter {
  flex: none;
  height: 6px;
  background: #1a1a1a;
  cursor: row-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.splitter-handle {
  width: 36px;
  height: 2px;
  background: #444;
  border-radius: 1px;
  pointer-events: none;
}

.splitter:hover {
  background: #2a2a2a;
}

.splitter:hover .splitter-handle {
  background: #888;
}

.graph-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.pick-cursor {
  cursor: crosshair;
}

.crosshair {
  position: absolute;
  width: 14px;
  height: 14px;
  border: 1px dotted #212121;
  outline: 2px double #ffffff;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

/* ── SVG chart — takes all space left after the heatmap and splitter ── */
.chart-wrap {
  flex: 1;
  position: relative;
  background: #161616;
  border-radius: 3px;
  overflow: hidden;
  min-height: 0;
  cursor: crosshair;
}

/* ── Overlays ── */
.overlay-hint,
.overlay-error,
.overlay-click-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  padding: 16px;
  text-align: center;
  pointer-events: none;
}

.overlay-hint {
  color: #444;
}

.overlay-click-hint {
  color: #555;
  font-size: 11px;
  align-items: flex-end;
  padding-bottom: 10px;
}

.overlay-error {
  background: rgba(60, 0, 0, 0.85);
  color: #ff6b6b;
  white-space: pre-wrap;
  align-items: flex-start;
  font-size: 11px;
}

/* ── Tooltip ── */
.tooltip {
  position: absolute;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  pointer-events: none;
  white-space: nowrap;
  box-sizing: border-box;
}
</style>
