<template>
  <div class="panel code-panel">
    <div class="panel-header">Shader Code</div>
    <textarea
      class="code-input"
      v-model="code"
      spellcheck="false"
      placeholder="Paste your GLSL code here..."
    />
    <button class="parse-btn" @click="onParse">Parse</button>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const emit = defineEmits(['parse'])

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
  // Step 2: we will call the parser here and emit the results up
  // For now, emit empty arrays so App.vue wiring can be tested
  emit('parse', { functions: [], uniforms: [] })
}
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
</style>
