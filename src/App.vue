<template>
  <div class="app-layout" :class="{ dragging }">

    <!-- Column 1: Credit + Code -->
    <div class="col" :style="{ width: colWidths[0] + 'px' }">
      <Credit />
      <CodePanel class="col-fill" @parse="onParse" />
    </div>

    <div class="v-splitter" @mousedown="onSplitterDown(0, $event)">
      <div class="v-splitter-handle" />
    </div>

    <!-- Column 2: Side panel -->
    <div class="col" :style="{ width: colWidths[1] + 'px' }">
      <SidePanel class="col-fill" :functions="parsedFunctions" :uniforms="parsedUniforms"
        :uniform-values="uniformValues" :selected-function="selectedFunction" :selected-uniform="selectedUniform"
        :selected-loop="selectedLoop" @select-function="onSelectFunction" @select-uniform="onSelectUniform"
        @select-loop="onSelectLoop" @select-watch-var="onSelectWatchVar" @update-uniform="onUpdateUniform" />
    </div>

    <div class="v-splitter" @mousedown="onSplitterDown(1, $event)">
      <div class="v-splitter-handle" />
    </div>

    <!-- Column 3: Graph panel — takes remaining space -->
    <div class="col col-right">
      <GraphPanel class="col-fill" :selected-function="selectedFunction" :selected-loop="selectedLoop"
        :shader-source="shaderSource" :uniform-values="uniformValues"
        @canvas-resize="onCanvasResize" />
    </div>

  </div>
</template>

<script setup>
import { ref } from 'vue'
import CodePanel from './components/CodePanel.vue'
import SidePanel from './components/SidePanel.vue'
import GraphPanel from './components/GraphPanel.vue'
import Credit from './components/Credit.vue'

// Parsed shader content
const parsedFunctions = ref([])
const parsedUniforms = ref([])
const shaderSource = ref('')

// Live uniform values — edited in SidePanel, consumed by GraphPanel
const uniformValues = ref({})

// User selection
const selectedFunction = ref(null)
const selectedUniform = ref(null)
const selectedLoop = ref(null)

// ── Resizable columns ─────────────────────────────────────────────────────────
const dragging = ref(false)

// Initial widths in pixels — roughly 1:1:2 ratio like the old grid
const SPLITTER_W = 5
const colWidths = ref([
  Math.floor((window.innerWidth - SPLITTER_W * 2) * 0.25),
  Math.floor((window.innerWidth - SPLITTER_W * 2) * 0.25),
])

function onSplitterDown(idx, e) {
  e.preventDefault()
  dragging.value = true
  const startX = e.clientX
  const startW = colWidths.value[idx]

  function onMove(ev) {
    const delta = ev.clientX - startX
    const widths = [...colWidths.value]
    widths[idx] = Math.max(120, startW + delta)
    colWidths.value = widths
  }
  function onUp() {
    dragging.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// ── Event handlers ────────────────────────────────────────────────────────────
function onParse({ functions, uniforms, source }) {
  parsedFunctions.value = functions
  parsedUniforms.value = uniforms
  shaderSource.value = source
  selectedUniform.value = null
  selectedLoop.value = null
  const next = {}
  for (const u of uniforms) {
    next[u.name] = uniformValues.value[u.name] ?? u.value
  }
  uniformValues.value = next
  // Auto-select void main() so the shader renders immediately after parsing
  selectedFunction.value = functions.find(f => f.name === 'main') ?? null
}

function onUpdateUniform({ name, value }) {
  uniformValues.value = { ...uniformValues.value, [name]: value }
}

function onSelectFunction(fn) {
  selectedFunction.value = selectedFunction.value?.id === fn.id ? null : fn
  selectedLoop.value = null
}

function onSelectUniform(u) {
  selectedUniform.value = selectedUniform.value?.name === u.name ? null : u
}

function onSelectLoop({ fn, loopIndex, loop }) {
  selectedFunction.value = null
  const same = selectedLoop.value?.fn.id === fn.id
    && selectedLoop.value?.loopIndex === loopIndex
  selectedLoop.value = same ? null : { fn, loopIndex, loop, watchVar: null }
}

function onCanvasResize({ width, height }) {
  const cur = uniformValues.value
  const next = { ...cur }
  if ('u_resolution' in cur) next.u_resolution = [width, height]
  if ('iResolution'  in cur) next.iResolution  = [width, height, 1]
  uniformValues.value = next
}

function onSelectWatchVar({ fn, loopIndex, loop, watchVar, isPreLoop }) {
  selectedFunction.value = null
  selectedLoop.value = { fn, loopIndex, loop, watchVar, isPreLoop: !!isPreLoop }
}
</script>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: row;
  height: 100vh;
  padding: 0.2em;
  overflow: hidden;
  box-sizing: border-box;
}

.app-layout.dragging {
  cursor: col-resize;
  user-select: none;
}

/* Fixed-width columns (col 1 & 2), col-right fills remaining */
.col {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 0;
  overflow: hidden;
}

.col-right {
  flex: 1;
}

/* Panel fills its column */
.col-fill {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

/* ── Vertical splitter ── */
.v-splitter {
  flex: none;
  width: 5px;
  background: #ffffff;
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  transition: background 0.1s;
}

.v-splitter:hover,
.app-layout.dragging .v-splitter {
  background: #b0b0b0;
}

.v-splitter-handle {
  width: 1px;
  height: 40px;
  background: #555;
  border-radius: 1px;
  pointer-events: none;
}

.v-splitter:hover .v-splitter-handle,
.app-layout.dragging .v-splitter-handle {
  background: #999;
}
</style>
