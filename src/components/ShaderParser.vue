<template>
  <div class="app-layout">

    <!-- LEFT: code input -->
    <div class="panel code-panel">
      <div class="panel-header">Shader Code</div>
      <textarea class="code-input" v-model="code" spellcheck="false" placeholder="Paste your GLSL code here..." />
      <button class="parse-btn" @click="onParse">Parse</button>
    </div>

    <!-- MIDDLE: functions + parameters list -->
    <div class="panel side-panel">
      <div class="panel-header">Functions</div>
      <div class="list-placeholder">
        <!-- Step 2 will fill this with parsed functions -->
        <span class="hint">Parse a shader to see functions</span>
      </div>

      <div class="panel-header" style="margin-top: 16px;">Parameters</div>
      <div class="list-placeholder">
        <!-- Step 2 will fill this with parsed uniforms -->
        <span class="hint">Parse a shader to see parameters</span>
      </div>
    </div>

    <!-- RIGHT: graph canvas -->
    <div class="panel graph-panel">
      <div class="panel-header">Graph</div>
      <div class="canvas-placeholder">
        <!-- Step 4 will put a WebGL canvas here -->
        <span class="hint">Select a function and parameter to plot</span>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref } from 'vue'

const code = ref(
`uniform float u_time;
uniform vec2 u_resolution;

float circle(vec2 p, float r) {
    return length(p) - r;
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float d = circle(uv, 0.5);
}`
)

function onParse() {
  // Step 2: we will call the GLSL parser here
  console.log('parse clicked — wiring this up in Step 2')
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

/* ── panels ── */
.panel {
  display: flex;
  flex-direction: column;
  background: #16213e;
  border-radius: 8px;
  overflow: hidden;
}

.code-panel  { flex: 2; min-width: 0; }
.side-panel  { flex: 1; min-width: 160px; max-width: 220px; padding: 8px; }
.graph-panel { flex: 2; min-width: 0; }

/* ── panel header ── */
.panel-header {
  font-size: 11px;
  font-weight: bold;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #888;
  padding: 8px 12px;
  border-bottom: 1px solid #0f3460;
}

/* ── code textarea ── */
.code-input {
  flex: 1;
  resize: none;
  background: #0d1b2a;
  color: #a8d8a8;
  border: none;
  padding: 12px;
  font-family: monospace;
  font-size: 13px;
  line-height: 1.6;
  outline: none;
}

.parse-btn {
  background: #0f3460;
  color: #e0e0e0;
  border: none;
  padding: 10px;
  cursor: pointer;
  font-size: 13px;
  letter-spacing: 0.05em;
}

.parse-btn:hover {
  background: #1a5276;
}

/* ── placeholders ── */
.list-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
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
  text-align: center;
}
</style>
