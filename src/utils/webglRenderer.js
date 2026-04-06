/**
 * WebGLRenderer
 * A minimal WebGL2 engine that runs a fragment shader on a fullscreen quad.
 *
 * Two-pass pipeline:
 *   Pass 1 — user's shader → RGBA32F float texture (exact values)
 *   Pass 2 — heatmap shader → screen (color-maps the float texture)
 */
export class WebGLRenderer {
    constructor(canvas) {
        this.canvas = canvas
        this.gl = canvas.getContext('webgl2')
        if (!this.gl) throw new Error('WebGL2 not supported in this browser')

        // Required to render into RGBA32F float textures.
        // Without this, the framebuffer attachment is "not renderable".
        if (!this.gl.getExtension('EXT_color_buffer_float'))
            throw new Error('EXT_color_buffer_float not supported')

        this._initQuad()
        this._initFloatFramebuffer()

        // Compile built-in heatmap program (Pass 2, colorizes the float texture)
        const hmResult = this._compileProgram(VERTEX_SHADER_SRC, HEATMAP_FRAG_SRC)
        if (!hmResult.ok) throw new Error('Heatmap shader failed: ' + hmResult.error)
        this.heatmapProgram = hmResult.program

        // Compile built-in passthrough program (Pass 2 for void main() — shows real colors)
        const ptResult = this._compileProgram(VERTEX_SHADER_SRC, PASSTHROUGH_FRAG_SRC)
        if (!ptResult.ok) throw new Error('Passthrough shader failed: ' + ptResult.error)
        this.passthroughProgram = ptResult.program

        // The user's compiled shader program (set by compile())
        this.userProgram = null

        // Value range for the heatmap color mapping
        this.minVal = -1.0
        this.maxVal =  1.0

        // True only after at least one successful render — guards readPixel
        this.hasRendered = false

        // Per-program cache of uniform name → WebGL type (INT, FLOAT, etc.)
        // Using WeakMap so entries are GC'd when programs are deleted.
        this._uniformTypeCache = new WeakMap()
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /**
     * Compile a new user fragment shader for Pass 1.
     * Returns { ok: true } or { ok: false, error: string }.
     */
    compile(fragmentSrc) {
        const gl = this.gl
        if (this.userProgram) {
            gl.deleteProgram(this.userProgram)
            this.userProgram = null
        }
        this.hasRendered = false
        const result = this._compileProgram(VERTEX_SHADER_SRC, fragmentSrc)
        if (!result.ok) return result
        this.userProgram = result.program
        return { ok: true }
    }

    /**
     * Run both passes and draw the heatmap to the canvas.
     * @param {Object} uniforms  extra uniforms for the user shader { name: value }
     */
    render(uniforms = {}) {
        if (!this.userProgram) return

        const gl = this.gl
        const w  = this.canvas.width
        const h  = this.canvas.height

        this._resizeFloatFramebuffer(w, h)

        // ── Pass 1: user shader → float FBO ──────────────────────────────
        // Renders the raw computed float value into the RGBA32F texture.
        // The user shader stores its output value in fragColor.r.
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
        gl.viewport(0, 0, w, h)
        this._drawQuad(this.userProgram, uniforms)  // uniforms are all floats for user shader

        this.hasRendered = true

        // ── Pass 2: heatmap shader → screen ──────────────────────────────
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.viewport(0, 0, w, h)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this.floatTexture)

        // Floats and samplers must be set with different gl.uniform calls,
        // so we pass them separately to avoid type mismatches.
        this._drawQuad(
            this.heatmapProgram,
            { u_minVal: this.minVal, u_maxVal: this.maxVal }, // floats
            { u_floatTex: 0 }                                 // samplers (int)
        )
    }

    /**
     * Like render() but uses a passthrough Pass 2 — shows the shader's actual
     * fragColor RGB instead of the heatmap colorisation. Used for void main().
     */
    renderDirect(uniforms = {}) {
        if (!this.userProgram) return
        const gl = this.gl
        const w  = this.canvas.width
        const h  = this.canvas.height

        this._resizeFloatFramebuffer(w, h)

        // Pass 1: user shader → RGBA32F FBO (exact fragColor values stored)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
        gl.viewport(0, 0, w, h)
        this._drawQuad(this.userProgram, uniforms)

        this.hasRendered = true

        // Pass 2: passthrough → screen (shows RGB directly, no heatmap)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.viewport(0, 0, w, h)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this.floatTexture)
        this._drawQuad(this.passthroughProgram, {}, { u_floatTex: 0 })
    }

    /**
     * Read the exact float value stored in Pass 1 at canvas pixel (x, y).
     * Returns a Float32Array [r, g, b, a] — .r is the tracked value.
     */
    readPixel(x, y) {
        if (!this.hasRendered) return new Float32Array(4)
        const gl  = this.gl
        const buf = new Float32Array(4)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
        // WebGL y=0 is bottom; canvas y=0 is top — flip y
        gl.readPixels(x, this.canvas.height - y, 1, 1, gl.RGBA, gl.FLOAT, buf)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        return buf
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    _initQuad() {
        const gl = this.gl
        // Four corners of a fullscreen quad as a triangle-strip
        const positions = new Float32Array([-1,-1,  1,-1,  -1,1,  1,1])
        this.quadBuffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    }

    _initFloatFramebuffer() {
        const gl = this.gl
        this.fbo          = gl.createFramebuffer()
        this.floatTexture = gl.createTexture()
        this._fboWidth    = 0
        this._fboHeight   = 0
    }

    _resizeFloatFramebuffer(w, h) {
        if (w === this._fboWidth && h === this._fboHeight) return
        const gl = this.gl
        gl.bindTexture(gl.TEXTURE_2D, this.floatTexture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.floatTexture, 0)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.bindTexture(gl.TEXTURE_2D, null)
        this._fboWidth  = w
        this._fboHeight = h
    }

    /**
     * Bind the program, set uniforms, and draw the fullscreen quad.
     * @param {Object} floatUniforms  { name: number | number[] }
     * @param {Object} intUniforms    { name: number } — for sampler2D texture units
     */
    _drawQuad(program, floatUniforms = {}, intUniforms = {}) {
        const gl = this.gl
        gl.useProgram(program)

        const posLoc = gl.getAttribLocation(program, 'a_position')
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
        gl.enableVertexAttribArray(posLoc)
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

        // Always set u_resolution if the program uses it
        const resLoc = gl.getUniformLocation(program, 'u_resolution')
        if (resLoc) gl.uniform2f(resLoc, this.canvas.width, this.canvas.height)

        // Build (or retrieve cached) uniform type map so we can call the
        // correct gl.uniform* variant — e.g. uniform int requires uniform1i,
        // not uniform1f, which causes GL_INVALID_OPERATION.
        let typeMap = this._uniformTypeCache.get(program)
        if (!typeMap) {
            typeMap = this._buildUniformTypeMap(program)
            this._uniformTypeCache.set(program, typeMap)
        }

        for (const [name, value] of Object.entries(floatUniforms)) {
            if (value == null) continue   // skip unset uniforms (e.g. sampler2D with no texture)
            const loc = gl.getUniformLocation(program, name)
            if (loc === null) continue
            const glType = typeMap[name]
            // Integer / bool / sampler uniforms must use uniform1i
            if (glType === gl.INT || glType === gl.BOOL || glType === gl.UNSIGNED_INT || glType === gl.SAMPLER_2D) {
                gl.uniform1i(loc, Math.round(Number(value)))
            } else if (typeof value === 'number') {
                gl.uniform1f(loc, value)
            } else if (value.length === 2) {
                gl.uniform2fv(loc, value)
            } else if (value.length === 3) {
                gl.uniform3fv(loc, value)
            } else if (value.length === 4) {
                gl.uniform4fv(loc, value)
            }
        }

        // Explicit integer uniforms (sampler2D texture units) — always uniform1i
        for (const [name, value] of Object.entries(intUniforms)) {
            const loc = gl.getUniformLocation(program, name)
            if (loc !== null) gl.uniform1i(loc, value)
        }

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    /** Build a name→glType map for all active uniforms in a program. */
    _buildUniformTypeMap(program) {
        const gl  = this.gl
        const n   = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
        const map = {}
        for (let i = 0; i < n; i++) {
            const info = gl.getActiveUniform(program, i)
            if (info) map[info.name] = info.type
        }
        return map
    }

    _compileProgram(vertSrc, fragSrc) {
        const gl = this.gl

        const vert = this._compileShader(gl.VERTEX_SHADER, vertSrc)
        if (!vert.ok) return vert

        const frag = this._compileShader(gl.FRAGMENT_SHADER, fragSrc)
        if (!frag.ok) return frag

        const program = gl.createProgram()
        gl.attachShader(program, vert.shader)
        gl.attachShader(program, frag.shader)
        gl.linkProgram(program)
        gl.deleteShader(vert.shader)
        gl.deleteShader(frag.shader)

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const err = gl.getProgramInfoLog(program)
            gl.deleteProgram(program)
            return { ok: false, error: err }
        }
        return { ok: true, program }
    }

    _compileShader(type, src) {
        const gl     = this.gl
        const shader = gl.createShader(type)
        gl.shaderSource(shader, src)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const err = gl.getShaderInfoLog(shader)
            gl.deleteShader(shader)
            return { ok: false, error: err }
        }
        return { ok: true, shader }
    }
}

// ── Shared vertex shader ─────────────────────────────────────────────────────
const VERTEX_SHADER_SRC = `#version 300 es
in  vec2 a_position;
out vec2 v_uv;
void main() {
    v_uv        = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`

// ── Pass 2: heatmap shader ───────────────────────────────────────────────────
// Reads the float value from Pass 1 and maps it to a color gradient:
//   blue (minVal) → white (midpoint) → red (maxVal)
const HEATMAP_FRAG_SRC = `#version 300 es
precision highp float;

in  vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_floatTex;  // the RGBA32F texture from Pass 1
uniform float     u_minVal;    // value that maps to blue
uniform float     u_maxVal;    // value that maps to red

// Map a normalized t (0→1) to a blue→white→red gradient
vec3 heatmap(float t) {
    t = clamp(t, 0.0, 1.0);
    // Below 0.5: blue → white
    // Above 0.5: white → red
    vec3 cool = mix(vec3(0.0, 0.0, 1.0), vec3(1.0, 1.0, 1.0), t * 2.0);
    vec3 warm = mix(vec3(1.0, 1.0, 1.0), vec3(1.0, 0.0, 0.0), t * 2.0 - 1.0);
    return t < 0.5 ? cool : warm;
}

void main() {
    float value = texture(u_floatTex, v_uv).r;
    float t     = (value - u_minVal) / (u_maxVal - u_minVal);
    fragColor   = vec4(heatmap(t), 1.0);
}
`

// ── Pass 2 (alternative): passthrough — shows stored RGBA directly ────────────
// Used when rendering void main() so the real shader colors are visible.
const PASSTHROUGH_FRAG_SRC = `#version 300 es
precision highp float;

in  vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_floatTex;

void main() {
    fragColor = texture(u_floatTex, v_uv);
}
`
