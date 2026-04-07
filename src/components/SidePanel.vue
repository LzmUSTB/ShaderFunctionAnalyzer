<template>
  <PanelFrame>
    <div class="container">
      <div class="section-header">Functions</div>
      <div class="list">
        <div v-if="functions.length === 0" class="hint">Parse a shader to see functions</div>
        <template v-for="fn in functions" :key="fn.id">

          <div class="list-item"
            :class="{ selected: selectedFunction?.id === fn.id, main: fn.name === 'main', void: fn.returnType === 'void' && fn.name !== 'main' }"
            @click="emit('select-function', fn)">
            <span class="type-tag">{{ fn.returnType }}</span>
            <span class="item-name">{{ fn.name }}</span>
            <span class="params">({{fn.params.map(p => p.type + ' ' + p.name).join(', ')}})</span>
          </div>

          <!-- Pre-loop variable chips (functions that HAVE a for-loop) -->
          <template v-if="fn.loops?.length && fn.preLoopVars?.length">
            <div class="list-item preloop-row">
              <span class="section-tag">vars</span>
              <span v-for="v in fn.preLoopVars" :key="'pre_' + v.name" class="var-chip preloop-chip"
                :class="{ 'chip-selected': isPreLoopVarSelected(fn, v.name) }"
                @click.stop="onSelectPreLoopVar(fn, v)">{{
                  v.type }} {{ v.name }}</span>
            </div>
          </template>

          <!-- Body variable chips (void functions with NO for-loop) -->
          <template v-if="fn.returnType === 'void' && !fn.loops?.length && fn.bodyVars?.length">
            <div class="list-item preloop-row">
              <span class="section-tag">vars</span>
              <span v-for="v in fn.bodyVars" :key="'bv_' + v.name" class="var-chip" :class="{
                'chip-selected': isBodyVarSelected(fn, v.name),
                'output-chip': v.isOutput,
                'preloop-chip': !v.isOutput
              }" @click.stop="onSelectBodyVar(fn, v)">{{ v.type }} {{ v.name }}</span>
            </div>
          </template>

          <template v-if="fn.returnType === 'void' && fn.loops?.length">
            <div v-for="(loop, li) in fn.loops" :key="fn.id + '_loop_' + li" class="list-item loop-item"
              :class="{ selected: isLoopSelected(fn, li) }" @click="emit('select-loop', { fn, loopIndex: li, loop })">
              <span class="type-tag">for</span>
              <span class="item-name">{{ loop.loopVar }}</span>
              <span v-for="v in loop.localVars" :key="v.name" class="var-chip"
                :class="{ 'chip-selected': isVarSelected(fn, li, v.name), 'output-chip': v.isOutput }"
                @click.stop="emit('select-watch-var', { fn, loopIndex: li, loop, watchVar: v })">{{ v.type }} {{ v.name
                }}</span>
            </div>
          </template>

        </template>
      </div>

      <div class="section-header">Uniforms</div>
      <div class="uniforms-list">
        <div v-if="uniforms.length === 0" class="hint">Parse a shader to see uniforms</div>
        <div v-for="u in uniforms" :key="u.name" class="uniform-row">

          <!-- Header: type + name -->
          <div class="uniform-header">
            <span class="type-tag">{{ u.type }}</span>
            <span class="item-name">{{ u.name }}</span>
            <span v-if="u.name === 'u_resolution'" class="auto-tag">auto change</span>
            <button v-if="u.type === 'float'" class="play-btn" :class="{ active: playing[u.name] }"
              :title="playing[u.name] ? 'Pause' : 'Animate'"
              @click="togglePlay(u.name, u.range?.min ?? 0, u.range?.max ?? 1)">
              {{ playing[u.name] ? 'STOP' : 'PLAY' }}
            </button>
          </div>

          <!-- auto-managed: driven by canvas size, not user-editable -->
          <div v-if="u.auto" class="auto-note">
            auto &mdash; {{ formatAutoValue(u, uniformValues[u.name]) }}
          </div>

          <!-- sampler2D: no slider, just a label -->
          <div v-else-if="u.type === 'sampler2D'" class="sampler-note">
            texture — not editable yet
          </div>

          <!-- bool: checkbox -->
          <div v-else-if="u.type === 'bool'" class="control-row">
            <input type="checkbox" :checked="uniformValues[u.name]"
              @change="emit('update-uniform', { name: u.name, value: $event.target.checked })" />
          </div>

          <!-- float: slider + autoplay button -->
          <div v-else-if="u.type === 'float'" class="float-row">

            <RangeSlider class="flex-slider" :model-value="uniformValues[u.name] ?? 0" :min="u.range?.min ?? 0"
              :max="u.range?.max ?? 1" @update:model-value="emit('update-uniform', { name: u.name, value: $event })" />
          </div>

          <!-- int: slider only -->
          <div v-else-if="u.type === 'int'">
            <RangeSlider :model-value="uniformValues[u.name] ?? 0" :is-int="true" :min="u.range?.min ?? 0"
              :max="u.range?.max ?? 1" @update:model-value="emit('update-uniform', { name: u.name, value: $event })" />
          </div>

          <!-- vec2/3/4: one slider per component -->
          <div v-else-if="['vec2', 'vec3', 'vec4'].includes(u.type)" class="vec-controls">
            <div v-for="(comp, ci) in vecComponents(u.type)" :key="comp" class="vec-row">
              <span class="comp-label">{{ comp }}</span>
              <RangeSlider :model-value="(uniformValues[u.name] ?? [])[ci] ?? 0" :min="u.range?.min ?? 0"
                :max="u.range?.max ?? 1" @update:model-value="onVecComponent(u.name, u.type, ci, $event)" />
            </div>
          </div>

        </div>
      </div>
    </div>
  </PanelFrame>
</template>

<script setup>
import { reactive, onUnmounted } from 'vue'
import PanelFrame from './PanelFrame.vue'
import RangeSlider from './RangeSlider.vue'

const props = defineProps({
  functions: { type: Array, default: () => [] },
  uniforms: { type: Array, default: () => [] },
  uniformValues: { type: Object, default: () => ({}) },
  selectedFunction: { type: Object, default: null },
  selectedUniform: { type: Object, default: null },
  selectedLoop: { type: Object, default: null },
})

const emit = defineEmits(['select-function', 'select-uniform', 'select-loop', 'select-watch-var', 'update-uniform'])

function isLoopSelected(fn, li) {
  return props.selectedLoop?.fn.id === fn.id && props.selectedLoop?.loopIndex === li
}
function isVarSelected(fn, li, varName) {
  return isLoopSelected(fn, li) && props.selectedLoop?.watchVar?.name === varName
}
function isPreLoopVarSelected(fn, varName) {
  return props.selectedLoop?.fn.id === fn.id
    && props.selectedLoop?.isPreLoop
    && props.selectedLoop?.watchVar?.name === varName
}
function onSelectPreLoopVar(fn, v) {
  const loop = fn.loops?.[0] ?? null
  emit('select-watch-var', { fn, loopIndex: 0, loop, watchVar: v, isPreLoop: true })
}
function isBodyVarSelected(fn, varName) {
  return props.selectedLoop?.fn.id === fn.id
    && props.selectedLoop?.isBodyVar
    && props.selectedLoop?.watchVar?.name === varName
}
function onSelectBodyVar(fn, v) {
  emit('select-watch-var', { fn, loopIndex: -1, loop: null, watchVar: v, isBodyVar: true })
}

// Format the live value for an auto-managed uniform (e.g. u_resolution)
function formatAutoValue(_, val) {
  if (val == null) return 'canvas size'
  if (Array.isArray(val)) return val.map(v => Math.round(v)).join(' × ')
  return String(Math.round(val))
}

// Return component labels for a vec type
function vecComponents(type) {
  return { vec2: ['x', 'y'], vec3: ['x', 'y', 'z'], vec4: ['x', 'y', 'z', 'w'] }[type] ?? []
}

// Update a single component of a vec uniform
function onVecComponent(name, type, index, value) {
  const len = { vec2: 2, vec3: 3, vec4: 4 }[type]
  const prev = props.uniformValues[name] ?? Array(len).fill(0)
  const next = [...prev]
  next[index] = value
  emit('update-uniform', { name, value: next })
}

// ── Autoplay ──────────────────────────────────────────────────────────────────
// Animates a float uniform by advancing it at 1 unit/second, wrapping at max.
const playing = reactive({})   // { [name]: bool }
const rafIds = {}             // { [name]: animationFrameId }
const lastTime = {}             // { [name]: DOMHighResTimeStamp }

function togglePlay(name, min, max) {
  if (playing[name]) {
    playing[name] = false
    cancelAnimationFrame(rafIds[name])
    delete rafIds[name]
    delete lastTime[name]
  } else {
    playing[name] = true
    function tick(ts) {
      if (!playing[name]) return
      if (lastTime[name] != null) {
        const dt = (ts - lastTime[name]) / 1000
        const cur = props.uniformValues[name] ?? min
        const range = max - min
        const next = range > 0
          ? min + ((cur + dt - min) % range + range) % range
          : cur
        emit('update-uniform', { name, value: next })
      }
      lastTime[name] = ts
      rafIds[name] = requestAnimationFrame(tick)
    }
    rafIds[name] = requestAnimationFrame(tick)
  }
}

onUnmounted(() => {
  for (const id of Object.values(rafIds)) cancelAnimationFrame(id)
})

</script>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.section-header {
  font-size: 11px;
  flex: 0 0 auto;
  user-select: none;
  font-weight: bold;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #ffffff;
  padding: 8px 12px;
  border-bottom: 1px solid #6a6a6a;
  border-top: 1px solid #6a6a6a;
  flex-shrink: 0;
}

.list {
  padding: 4px 0;
  overflow-y: auto;
  flex: 1 1 0;
  min-height: 0;
}

.list-item {
  padding: 5px 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px;
  cursor: pointer;
  font-size: 12px;
}

.list-item:hover {
  background: #363636;
}

.loop-item {
  padding-left: 24px;
}

.type-tag {
  color: #5dade2;
  flex-shrink: 0;
}

.item-name {
  color: #a8d8a8;
  font-weight: bold;
}

.auto-tag {
  margin-left: 0.5em;
  color: #b2ff8b;
  text-wrap: nowrap;
  user-select: none;
  font-weight: bold;
  background-color: #333333;
  padding: 0 1em;
}

.params {
  color: #666;
  font-size: 10px;
  word-break: break-all;
}

.list-item.void .type-tag {
  color: #888;
}

.list-item.void .item-name {
  color: #666;
}

/* ── main() — shader entry point ── */
.list-item.main {
  border-left: 2px solid #e8a838;
  padding-left: 10px;
  /* compensate for the border */
}

.list-item.main .type-tag {
  color: #e8a838;
}

.list-item.main .item-name {
  color: #f0c878;
}

.list-item.main .params {
  color: #8a7040;
}

.preloop-row {
  padding-left: 24px;
  flex-wrap: wrap;
}

.section-tag {
  font-size: 9px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  flex-shrink: 0;
  margin-right: 2px;
}

.preloop-chip {
  color: #c8a8e8;
  border-color: #5a3a7a;
  background: #2a1a3a;
}

.preloop-chip:hover {
  background: #3a2a4a;
  color: #e0c8ff;
}

.preloop-chip.chip-selected {
  background: #7a4ab8;
  color: #fff;
  border-color: #7a4ab8;
}

.var-chip {
  font-size: 0.8em;
  padding: 1px 6px;
  background: #2a2a2a;
  user-select: none;
  color: #aaa;
  cursor: pointer;
  border: 1px solid #444;
}

.output-chip {
  color: #9cdcfe;
  border-color: #2a4a7a;
  background: #1a2a3a;
}

.output-chip:hover {
  background: #2a3a5a;
  color: #c8e8ff;
}

.output-chip.chip-selected {
  background: #5dade2;
  color: #000;
  border-color: #5dade2;
}

.var-chip:hover {
  background: #3a3a3a;
  color: #fff;
}

.chip-selected {
  background: #e8a838;
  color: #000;
  border-color: #e8a838;
}

.list-item.selected {
  background: #5dade2;
}

.list-item.selected .type-tag,
.list-item.selected .item-name,
.list-item.selected .params {
  color: #000;
}

/* ── Uniforms controls ── */
.uniforms-list {
  padding: 4px 0;
  overflow-y: auto;
  flex: 1 1 0;
  min-height: 0;
}

.uniform-row {
  padding: 0.2em 0.4em;
  border-bottom: 1px solid #474747;
}

.uniform-header {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 0.5em;
  margin-bottom: 4px;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.comp-label {
  font-size: 10px;
  width: 10px;
  flex-shrink: 0;
}

.auto-note {
  font-size: 10px;
  color: #5dade2;
  font-style: italic;
  padding: 2px 0;
}

.sampler-note {
  font-size: 10px;
  color: #555;
  font-style: italic;
}

.vec-controls {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.vec-row {}

.vec-row .comp-label {
  font-size: 0.5em;
}

.hint {
  color: #444;
  font-size: 11px;
  text-align: center;
  padding: 16px 12px;
}

.float-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.flex-slider {
  flex: 1;
  min-width: 0;
}

.play-btn {
  text-wrap: nowrap;
  font-size: 10px;
  padding: 0.2em 1em;
  border: 1px solid #555;
  background: #2a2a2a;
  color: #cecece;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 0.5em;
}

.play-btn:hover {
  background: #3a3a3a;
  color: #fff;
}

.play-btn.active {
  background: #e8a838;
  border-color: #e8a838;
  color: #000;
}
</style>
