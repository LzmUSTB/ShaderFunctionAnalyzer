<template>
  <div class="panel side-panel">

    <div class="panel-header">Functions</div>
    <div class="list-placeholder">
      <span class="hint">Parse a shader to see functions</span>
    </div>

    <div class="panel-header" style="margin-top: 16px;">Parameters</div>
    <div class="list-placeholder">
      <span class="hint">Parse a shader to see parameters</span>
    </div>

  </div>
</template>

<script setup>
defineProps({
  functions: Array,
  uniforms:  Array,
})
</script>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  background: #16213e;
  border-radius: 8px;
  overflow: hidden;
  flex: 1;
  min-width: 160px;
  max-width: 220px;
  padding: 8px;
}

.panel-header {
  font-size: 11px;
  font-weight: bold;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #888;
  padding: 8px 4px;
  border-bottom: 1px solid #0f3460;
}

.list-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}

.hint {
  color: #444;
  font-size: 12px;
  text-align: center;
}
</style>
