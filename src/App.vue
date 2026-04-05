<template>
  <div class="app-layout">

    <!-- LEFT: code input -->
    <CodePanel @parse="onParse" />

    <!-- MIDDLE: functions + parameters -->
    <SidePanel :functions="parsedFunctions" :uniforms="parsedUniforms" />

    <!-- RIGHT: graph -->
    <GraphPanel />

  </div>
</template>

<script setup>
import { ref } from 'vue'
import CodePanel from './components/CodePanel.vue'
import SidePanel from './components/SidePanel.vue'
import GraphPanel from './components/GraphPanel.vue'

// Shared state — parsed results live here and flow down as props
const parsedFunctions = ref([])
const parsedUniforms  = ref([])

function onParse({ functions, uniforms }) {
  parsedFunctions.value = functions
  parsedUniforms.value  = uniforms
}
</script>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  background: #1a1a2e;
  color: #e0e0e0;
  font-family: monospace;
  gap: 8px;
  padding: 8px;
  box-sizing: border-box;
}
</style>
