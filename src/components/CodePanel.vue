<template>
  <PanelFrame title="Shader Code">
    <div class="editor-container">

      <!-- Line number gutter -->
      <div class="gutter" ref="gutterEl">
        <div v-for="n in lineCount" :key="n" class="line-num">{{ n }}</div>
      </div>

      <!-- Highlight layer + Textarea overlay -->
      <div class="code-wrapper">
        <!-- Syntax-highlighted display (behind the textarea) -->
        <pre class="code-highlight" ref="highlightEl" aria-hidden="true"><code v-html="highlighted"></code></pre>

        <!-- Transparent editing layer -->
        <textarea class="code-input" ref="textareaEl" v-model="code" spellcheck="false"
          placeholder="Paste your GLSL code here..." @keydown="onKeyDown" @scroll="syncScroll" />
      </div>

    </div>
    <button class="parse-btn" @click="onParse">PARSE</button>
    <div v-if="parseError" class="parse-error">{{ parseError }}</div>
  </PanelFrame>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { parseGLSL } from '../utils/glslParser'
import PanelFrame from './PanelFrame.vue'

const emit = defineEmits(['parse'])

const code = ref(
  `uniform float u_time;//0 [0, 10]
uniform int u_step;//50 [1,100] 

float hash(float n) {
    return fract(sin(n) * 43758.5453123);
}

vec2 hash2(float n) {
    return vec2(hash(n), hash(n + 100.0));
}

vec3 hsv2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0,4,2), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return c.z * mix(vec3(1.0), rgb, c.y);
}

vec3 getColor(float i) {
    float t = u_time * 0.5;
    float hue = fract(i * 0.1 + t);
    return hsv2rgb(vec3(hue, 0.6, 0.9));
}

float circleSDF(vec2 p, float r) {
    return length(p) - r;
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 p = uv * 2.0 - 1.0;
    p.x *= u_resolution.x / u_resolution.y;

    vec3 color = vec3(0.0);

    for (int i = 0; i < 100; i++) {
        if (i >= u_step) break;

        float fi = float(i);

        vec2 rnd = hash2(fi);
        vec2 center = rnd * 2.0 - 1.0;

        float radius = 0.03 + 0.05 * hash(fi + 200.0);

        vec2 local = p - center;

        float d = circleSDF(local, radius);

        float mask = smoothstep(0.01, 0.0, d);

        vec3 c = getColor(fi);

        color += c * mask;
    }
    color = clamp(color, 0.0, 1.0);

    fragColor = vec4(color, 1.0);
}`
)

const parseError = ref(null)
const gutterEl = ref(null)
const textareaEl = ref(null)
const highlightEl = ref(null)

// Count lines reactively — drives the gutter numbers
const lineCount = computed(() => code.value.split('\n').length)

// ── GLSL syntax highlighter ───────────────────────────────────────────────
const KEYWORDS = new Set([
  'void', 'float', 'int', 'uint', 'bool',
  'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4',
  'bvec2', 'bvec3', 'bvec4',
  'mat2', 'mat3', 'mat4', 'mat2x2', 'mat2x3', 'mat2x4', 'mat3x2', 'mat3x3', 'mat3x4', 'mat4x2', 'mat4x3', 'mat4x4',
  'sampler2D', 'samplerCube', 'sampler3D',
  'if', 'else', 'for', 'while', 'do', 'break', 'continue', 'return', 'discard',
  'switch', 'case', 'default',
  'uniform', 'varying', 'attribute', 'const', 'in', 'out', 'inout',
  'precision', 'highp', 'mediump', 'lowp', 'invariant', 'flat', 'smooth',
  'struct', 'layout',
])

const BUILTINS = new Set([
  'radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'inversesqrt',
  'abs', 'sign', 'floor', 'trunc', 'round', 'roundEven', 'ceil',
  'fract', 'mod', 'modf', 'min', 'max', 'clamp', 'mix', 'step', 'smoothstep',
  'isnan', 'isinf', 'length', 'distance', 'dot', 'cross', 'normalize',
  'faceforward', 'reflect', 'refract',
  'matrixCompMult', 'outerProduct', 'transpose', 'determinant', 'inverse',
  'lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual', 'equal', 'notEqual',
  'any', 'all', 'not',
  'texture', 'texture2D', 'textureCube', 'textureProj', 'textureLod',
  'dFdx', 'dFdy', 'fwidth',
])

const GL_VARS = new Set([
  'gl_Position', 'gl_PointSize', 'gl_FragCoord', 'gl_FrontFacing',
  'gl_FragDepth', 'gl_PointCoord', 'gl_VertexID', 'gl_InstanceID',
  'gl_FragColor', 'fragColor',
])

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Tokeniser regex — order: block comment, line comment, preprocessor,
// float literals, int literals, identifiers, everything else
const TOKEN_RE = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|#\w+|\b\d+\.\d*(?:[eE][+-]?\d+)?[fF]?\b|\b\d*\.\d+(?:[eE][+-]?\d+)?[fF]?\b|\b\d+(?:[eE][+-]?\d+)?[uUfF]?\b|[A-Za-z_]\w*|[^\w\s]|\s+/g

function highlightGLSL(src) {
  TOKEN_RE.lastIndex = 0
  let out = ''
  let m
  while ((m = TOKEN_RE.exec(src)) !== null) {
    const tok = m[0]
    const ch = tok[0]
    if (ch === '/' || ch === '*') {
      // comments (line or block)
      out += `<span class="hl-comment">${escapeHtml(tok)}</span>`
    } else if (ch === '#') {
      out += `<span class="hl-preproc">${escapeHtml(tok)}</span>`
    } else if (tok === 'true' || tok === 'false') {
      out += `<span class="hl-bool">${tok}</span>`
    } else if (/^[\d.]/.test(ch)) {
      out += `<span class="hl-number">${tok}</span>`
    } else if (GL_VARS.has(tok)) {
      out += `<span class="hl-glvar">${tok}</span>`
    } else if (KEYWORDS.has(tok)) {
      out += `<span class="hl-keyword">${tok}</span>`
    } else if (BUILTINS.has(tok)) {
      out += `<span class="hl-builtin">${tok}</span>`
    } else {
      out += escapeHtml(tok)
    }
  }
  // Trailing newline keeps the last line visible when it ends with \n
  return out + '\n'
}

const highlighted = computed(() => highlightGLSL(code.value))

// ── Tab key: insert 4 spaces instead of moving focus ─────────────────────
function onKeyDown(e) {
  if (e.key !== 'Tab') return
  e.preventDefault()

  const el = textareaEl.value
  const start = el.selectionStart
  const end = el.selectionEnd

  code.value = code.value.slice(0, start) + '    ' + code.value.slice(end)

  nextTick(() => {
    el.selectionStart = start + 4
    el.selectionEnd = start + 4
  })
}

// ── Sync gutter + highlight scroll with textarea scroll ──────────────────
function syncScroll() {
  gutterEl.value.scrollTop    = textareaEl.value.scrollTop
  highlightEl.value.scrollTop = textareaEl.value.scrollTop
}

// Re-sync after every content change: paste / delete / typing updates the
// textarea's scroll position (browser scrolls to cursor) before Vue has
// flushed the new content into the <pre>. The scroll event fires at that
// moment, so the pre ends up at a mismatched offset. Waiting one tick
// ensures the pre is up-to-date before we copy the scroll position.
watch(code, () => nextTick(syncScroll))

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
  overflow: hidden;
}

/* ── Gutter: line numbers ── */
.gutter {
  width: 40px;
  flex-shrink: 0;
  background: #1a1a1a;
  overflow: hidden;
  padding: 12px 0;
  text-align: right;
  user-select: none;
}

.line-num {
  font-size: 13px;
  line-height: 1.6;
  color: #555;
  padding-right: 8px;
}

/* ── Wrapper holds the stacked pre + textarea ── */
.code-wrapper {
  flex: 1;
  position: relative;
  overflow: hidden;
}

/* ── Shared metrics for highlight layer and textarea ── */
.code-highlight,
.code-input {
  box-sizing: border-box;   /* identical content width regardless of element type */
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  margin: 0;
  padding: 12px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  tab-size: 4;
}

/* ── Syntax-highlighted pre layer ── */
.code-highlight {
  background: #212121;
  color: #ffa200;
  /* default token colour */
  overflow-y: scroll;
  overflow-x: hidden;
  pointer-events: none;
  border: none;
  /* Intentionally NOT hiding the scrollbar: keeping the reserved scrollbar
     space makes the content width identical to the textarea's, so wrap
     points stay perfectly aligned. The textarea (z-index:1) sits on top
     and its scrollbar visually covers the pre's scrollbar. */
}

.code-highlight code {
  display: block;
  background: transparent;
  font-family: inherit;
  font-size: inherit;
}

/* ── GLSL token colours ── */
/* :deep() is required because the spans are injected via v-html and
   Vue does not stamp scoped attributes onto dynamically-inserted nodes */
:deep(.hl-keyword) {
  color: #24ffba;
}

/* blue  — types / qualifiers / control flow */
:deep(.hl-builtin) {
  color: #dcdcaa;
}

/* yellow — built-in functions */
:deep(.hl-comment) {
  color: #6a9955;
  font-style: italic;
}

:deep(.hl-number) {
  color: #b5cea8;
}

/* muted green */
:deep(.hl-preproc) {
  color: #c586c0;
}

/* purple — #version / #define */
:deep(.hl-glvar) {
  color: #9cdcfe;
}

/* light blue — gl_* / fragColor */
:deep(.hl-bool) {
  color: #569cd6;
}

/* ── Transparent editing layer ── */
.code-input {
  resize: none;
  background: transparent;
  color: transparent;
  caret-color: #a8d8a8;
  border: none;
  outline: none;
  overflow-y: scroll;
  overflow-x: hidden;
  z-index: 1;
  /* selection highlight is still visible through transparency */
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
  background-color: #d6d6d6;
}

.parse-error {
  padding: 8px 12px;
  background: #3d0000;
  color: #ff6b6b;
  font-size: 11px;
  flex-shrink: 0;
}
</style>
