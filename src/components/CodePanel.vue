<template>
  <PanelFrame title="Shader Code">
    <div class="editor-container">

      <!-- Line number gutter -->
      <div class="gutter" ref="gutterEl">
        <div v-for="n in lineCount" :key="n" class="line-num">{{ n }}</div>
      </div>

      <!-- Code textarea -->
      <textarea
        class="code-input"
        ref="textareaEl"
        v-model="code"
        spellcheck="false"
        placeholder="Paste your GLSL code here..."
        @keydown="onKeyDown"
        @scroll="syncScroll"
      />

    </div>
    <button class="parse-btn" @click="onParse">Parse</button>
    <div v-if="parseError" class="parse-error">{{ parseError }}</div>
  </PanelFrame>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import { parseGLSL } from '../utils/glslParser'
import PanelFrame from './PanelFrame.vue'

const emit = defineEmits(['parse'])

const code = ref(
`//RGB phase shifts
uniform vec3 u_rgb; //0, 0.6, 1.2 [0, 6]
//Bokeh radius
uniform vec2 u_bokeh; //0.4, 0.8 [0, 4]
//Animation speed
uniform float u_speed; //0.4, [0, 2]
//Spin range
uniform float u_spin; //0.2, [0, 1]
//Ring scatter strength
uniform float u_scatter; //1.39, [0, 2]
//Number of colors
uniform int u_colors; //3, [1, 5]
//Number of lines
uniform float u_lines; //30, [10, 50]

//Noise functions
float rand1(vec2 p)
{
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float value_noise(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = rand1(i);
    float b = rand1(i + vec2(1.0, 0.0));
    float c = rand1(i + vec2(0.0, 1.0));
    float d = rand1(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y) * 2.0 - 1.0;
}

mat2 rotate2d(float r)
{
    return mat2(cos(r), sin(r), -sin(r), cos(r));
}

void main()
{
    vec2 P = (gl_FragCoord.xy - u_resolution * 0.4) / u_resolution.y * 6e2,
    u = vec2(dot(P, u_bokeh)) / 6e2;

    //Blank color
    vec3 col = vec3(0);

    //Fibonacci disk
    for (float i = 1.0;i < 16.0;i += 1.0 / i)
    {
        vec2 p = (P + u * i) * mat2(2, 1, -2, 4) / 4e1;
        float l = length(p);
        float d = cos(sin(ceil(log(l) * u_lines) * 1e2) * 2e2 + u_speed * u_time);
        float n = value_noise(0.5*vec2(l)) * value_noise(p * 5.0 * rotate2d(u_spin* d));
        u *= rotate2d(2.4);
        vec3 hue = cos(atan(p.y, p.x) * float(u_colors) + d * u_scatter + u_rgb) + 1.1;
        col += pow(max(n * hue, 0.0) * sqrt(l) * 0.1, vec3(3.0));
    }
    fragColor = vec4(sqrt(col / (1.0+col)), 1);
}`
)

const parseError  = ref(null)
const gutterEl    = ref(null)
const textareaEl  = ref(null)

// Count lines reactively — drives the gutter numbers
const lineCount = computed(() => code.value.split('\n').length)

// ── Tab key: insert 4 spaces instead of moving focus ─────────────────────
function onKeyDown(e) {
    if (e.key !== 'Tab') return
    e.preventDefault()

    const el    = textareaEl.value
    const start = el.selectionStart
    const end   = el.selectionEnd

    // Insert 4 spaces at the cursor position
    code.value = code.value.slice(0, start) + '    ' + code.value.slice(end)

    // Restore cursor after the inserted spaces
    // nextTick: wait for Vue to update the textarea value first
    nextTick(() => {
        el.selectionStart = start + 4
        el.selectionEnd   = start + 4
    })
}

// ── Sync gutter scroll with textarea scroll ───────────────────────────────
// When the user scrolls the textarea, the gutter must follow.
function syncScroll() {
    gutterEl.value.scrollTop = textareaEl.value.scrollTop
}

// ── Parse ─────────────────────────────────────────────────────────────────
function onParse() {
    const result = parseGLSL(code.value)
    if (!result) {
        parseError.value = 'Syntax error — check the console for details'
        return
    }
    parseError.value = null
    emit('parse', result)
}
</script>

<style scoped>
.editor-container {
  flex: 1;
  display: flex;
  overflow: hidden;   /* children handle their own scroll */
}

/* ── Gutter: line numbers ── */
.gutter {
  width: 40px;
  flex-shrink: 0;
  background: #1a1a1a;
  overflow: hidden;   /* scrolled programmatically via syncScroll */
  padding: 12px 0;
  text-align: right;
  user-select: none;
}

.line-num {
  font-family: monospace;
  font-size: 13px;
  line-height: 1.6;
  color: #555;
  padding-right: 8px;
}

/* ── Textarea ── */
.code-input {
  flex: 1;
  resize: none;
  background: #212121;
  color: #a8d8a8;
  border: none;
  padding: 12px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  outline: none;
  overflow-y: scroll;  /* always show scrollbar to keep gutter in sync */
}

/* ── Parse button ── */
.parse-btn {
  background: #ffffff;
  color: #212121;
  border: 2px solid #212121;
  padding: 10px;
  cursor: pointer;
  font-size: 13px;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

.parse-btn:hover {
  background: #d3d3d3;
}

.parse-error {
  padding: 8px 12px;
  background: #3d0000;
  color: #ff6b6b;
  font-size: 11px;
  flex-shrink: 0;
}
</style>
