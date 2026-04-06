<template>
  <div class="app-layout">

    <CodePanel class="code-panel" @parse="onParse" />

    <SidePanel class="side-panel" :functions="parsedFunctions" :uniforms="parsedUniforms"
      :uniform-values="uniformValues" :selected-function="selectedFunction" :selected-uniform="selectedUniform"
      :selected-loop="selectedLoop" @select-function="onSelectFunction" @select-uniform="onSelectUniform"
      @select-loop="onSelectLoop" @select-watch-var="onSelectWatchVar" @update-uniform="onUpdateUniform" />

    <GraphPanel class="graph-panel" :selected-function="selectedFunction" :selected-loop="selectedLoop"
      :shader-source="shaderSource" :uniform-values="uniformValues" />

  </div>
</template>

<script setup>
import { ref } from 'vue'
import CodePanel from './components/CodePanel.vue'
import SidePanel from './components/SidePanel.vue'
import GraphPanel from './components/GraphPanel.vue'

// Parsed shader content
const parsedFunctions = ref([])
const parsedUniforms = ref([])
const shaderSource = ref('')

// Live uniform values — edited in SidePanel, consumed by GraphPanel
// Structure: { [name]: number | number[] }
const uniformValues = ref({})

// User selection
const selectedFunction = ref(null)
const selectedUniform = ref(null)
const selectedLoop = ref(null)

function onParse({ functions, uniforms, source }) {
  parsedFunctions.value = functions
  parsedUniforms.value = uniforms
  shaderSource.value = source
  selectedFunction.value = null
  selectedUniform.value = null
  selectedLoop.value = null
  // Initialise uniform values from parser defaults, preserving existing values
  const next = {}
  for (const u of uniforms) {
    // Keep the user's current value if it was already set, otherwise use default
    next[u.name] = uniformValues.value[u.name] ?? u.value
  }
  uniformValues.value = next
}

function onUpdateUniform({ name, value }) {
  uniformValues.value = { ...uniformValues.value, [name]: value }
}

function onSelectFunction(fn) {
  selectedFunction.value = selectedFunction.value?.name === fn.name ? null : fn
  selectedLoop.value = null   // clear loop selection when switching to Mode A
}

function onSelectUniform(u) {
  selectedUniform.value = selectedUniform.value?.name === u.name ? null : u
}

function onSelectLoop({ fn, loopIndex, loop }) {
  selectedFunction.value = null   // clear Mode A selection
  // Toggle loop selection
  const same = selectedLoop.value?.fn.name === fn.name
    && selectedLoop.value?.loopIndex === loopIndex
  selectedLoop.value = same ? null : { fn, loopIndex, loop, watchVar: null }
}

function onSelectWatchVar({ fn, loopIndex, loop, watchVar, isPreLoop }) {
  selectedFunction.value = null
  selectedLoop.value = { fn, loopIndex, loop, watchVar, isPreLoop: !!isPreLoop }
}
</script>

<style scoped>
.app-layout {
  display: grid;
  grid-template-columns: 1fr 1fr 2fr;
  /* grid-template-rows: 1fr 1fr; */
  grid-template-areas:
    "code side  graph";
  height: 100vh;
  background: #ffffff;
  color: #e0e0e0;
  padding: 0.1em;
  gap: 0.1em;
  box-sizing: border-box;
}

.code-panel {
  grid-area: code;
  border: 1px solid #ccc;
  border-radius: 4px;
  overflow: auto;
}

.side-panel {
  grid-area: side;
  border: 1px solid #ccc;
  border-radius: 4px;
  overflow: auto;
}

.graph-panel {
  grid-area: graph;
  border: 1px solid #ccc;
  border-radius: 4px;
  overflow: auto;
}
</style>
