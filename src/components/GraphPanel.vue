<template>
  <div class="panel graph-panel">
    <div class="panel-header">Graph</div>
    <div class="canvas-placeholder">
      <span class="hint">Select a function and parameter to plot</span>
    </div>
  </div>
</template>

<script setup>
// Step 4: WebGL canvas goes here
</script>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  background: #16213e;
  border-radius: 8px;
  overflow: hidden;
  flex: 2;
  min-width: 0;
}

.panel-header {
  font-size: 11px;
  font-weight: bold;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #888;
  padding: 8px 12px;
  border-bottom: 1px solid #0f3460;
}

.canvas-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0d1b2a;
  margin: 8px;
  border-radius: 4px;
  border: 1px dashed #0f3460;
}

.hint {
  color: #444;
  font-size: 12px;
}
</style>
