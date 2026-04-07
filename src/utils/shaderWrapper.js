/**
 * shaderWrapper.js
 *
 * Takes a user's GLSL source + a selected function, and generates a complete
 * fragment shader that evaluates that function over the canvas for Pass 1.
 *
 * The generated shader:
 *   - Maps each pixel's UV (0→1) to a plot range (e.g. [-1,1] × [-1,1])
 *   - Calls the selected function with that vec2 as the first argument
 *   - Stores the result in fragColor.r (raw float for Pass 1)
 */

/**
 * Generate a runnable fragment shader for a selected function.
 *
 * @param {string} userSource   — the full GLSL source the user pasted
 * @param {object} fn           — { name, returnType, params: [{type, name}] }
 * @param {object} plotRange    — { xMin, xMax, yMin, yMax }
 * @returns {string}            — complete #version 300 es fragment shader source
 */
export function wrapFunction(userSource, fn, plotRange = { xMin: -1, xMax: 1, yMin: -1, yMax: 1 }) {
    // Remove the original main() from the user source so we can inject our own.
    // We keep all uniforms, helper functions, etc.
    const sourceWithoutMain = stripMain(userSource)

    // Build the argument list for calling the selected function.
    // The first vec2 parameter becomes the plot coordinate.
    // All other parameters get a default value of 0.0 (or zero-vectors).
    const callArgs = buildCallArgs(fn.params)

    // Build the main() that evaluates the function and stores the float result
    const injectedMain = buildMain(fn, callArgs, plotRange)

    // These declarations are injected by the wrapper — strip them from the
    // user source first to avoid "redefinition" errors
    const INJECTED_UNIFORMS = ['u_resolution']
    const cleanedSource = stripUniforms(sourceWithoutMain, INJECTED_UNIFORMS)

    return [
        '#version 300 es',
        'precision highp float;',
        '',
        'in  vec2 v_uv;',
        'out vec4 fragColor;',
        'uniform vec2 u_resolution;',
        '',
        '// ── user code (main removed) ──────────────────',
        cleanedSource,
        '',
        '// ── injected by shader analyzer ───────────────',
        injectedMain,
    ].join('\n')
}

/**
 * Build a runnable fragment shader that just executes void main() as-is.
 * Used when the user selects the main() function — shows the real shader output
 * (actual colors) via renderDirect() instead of a heatmap.
 *
 * @param {string} userSource — full GLSL source
 * @returns {string}          — complete #version 300 es fragment shader
 */
export function wrapMain(userSource) {
    // Strip version — we inject our own
    const withoutVersion = userSource.replace(/^\s*#version\s+\S+[^\n]*/m, '')

    // Strip declarations that we inject to avoid redefinition errors
    const BUILTIN = ['u_resolution', 'u_time', 'u_date', 'u_mouse', 'u_frame']
    let cleaned = withoutVersion
    for (const name of BUILTIN) {
        const re = new RegExp(`\\buniform\\s+\\w+\\s+${name}\\s*;`, 'g')
        cleaned = cleaned.replace(re, `// (${name} provided by analyzer)`)
    }

    return [
        '#version 300 es',
        'precision highp float;',
        '',
        'in  vec2 v_uv;',
        'out vec4 fragColor;',
        '',
        'uniform vec2  u_resolution;',
        'uniform float u_time;',
        'uniform vec4  u_date;',
        'uniform vec2  u_mouse;',
        'uniform int   u_frame;',
        '',
        cleaned,
    ].join('\n')
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Remove specific uniform declarations from source to avoid redefinition errors.
 * e.g. stripUniforms(src, ['u_resolution']) removes "uniform vec2 u_resolution;"
 */
function stripUniforms(src, names) {
    let result = src
    for (const name of names) {
        // Match: uniform <type> <name>; (with optional whitespace)
        const re = new RegExp(`\\buniform\\s+\\w+\\s+${name}\\s*;`, 'g')
        result = result.replace(re, `// (${name} provided by analyzer)`)
    }
    return result
}

/**
 * Remove the void main() { ... } block from the source.
 * Uses a simple brace-counting approach (no regex) to handle nested braces.
 */
function stripMain(src) {
    // Find "void main(" — handle optional whitespace
    const mainIndex = src.search(/void\s+main\s*\(/)
    if (mainIndex === -1) return src

    // Walk forward from the opening brace, counting { and }
    let braceDepth = 0
    let i = mainIndex
    let started = false

    while (i < src.length) {
        if (src[i] === '{') { braceDepth++; started = true }
        if (src[i] === '}') { braceDepth-- }
        if (started && braceDepth === 0) {
            // i is the closing } of main()
            return src.slice(0, mainIndex) + src.slice(i + 1)
        }
        i++
    }
    return src.slice(0, mainIndex)
}

/**
 * Build the argument string for calling fn(...).
 * Rules:
 *   - First vec2 param → "plotCoord" (the pixel's position in plot space)
 *   - Other params     → a zero default: 0.0, vec2(0.0), vec3(0.0), etc.
 *
 * This is intentionally simple — Step 6 will replace defaults with real
 * uniform controls so the user can tweak them via sliders.
 */
function buildCallArgs(params) {
    let firstVec2Used = false

    return params.map(p => {
        if (p.type === 'vec2' && !firstVec2Used) {
            firstVec2Used = true
            return 'plotCoord'
        }
        return defaultLiteral(p.type)
    }).join(', ')
}

/** Return a GLSL zero-literal for a given type */
function defaultLiteral(type) {
    switch (type) {
        case 'float':  return '0.0'
        case 'int':    return '0'
        case 'bool':   return 'false'
        case 'vec2':   return 'vec2(0.0)'
        case 'vec3':   return 'vec3(0.0)'
        case 'vec4':   return 'vec4(0.0)'
        default:       return '0.0'
    }
}

/**
 * Build the injected main() function.
 * - Maps the pixel UV to the plot range
 * - Calls the user's function
 * - Stores the result in fragColor:
 *     vec3/vec4 → full RGB (Pass 2 uses passthrough to show real color)
 *     float/int → single float in .r (Pass 2 applies heatmap)
 *     vec2      → .x in .r (heatmap of first component)
 */
function buildMain(fn, callArgs, r) {
    const { xMin, xMax, yMin, yMax } = r

    let storeResult
    switch (fn.returnType) {
        case 'vec3':
        case 'vec4':
            // Store full RGB so the passthrough Pass 2 shows the real color
            storeResult = 'fragColor = vec4(result.rgb, 1.0);'
            break
        case 'vec2':
            storeResult = 'fragColor = vec4(result.x, 0.0, 0.0, 1.0);'
            break
        case 'int':
            storeResult = 'fragColor = vec4(float(result), 0.0, 0.0, 1.0);'
            break
        default: // float
            storeResult = 'fragColor = vec4(result, 0.0, 0.0, 1.0);'
    }

    return `void main() {
    // Map UV (0→1) to the plot range
    float px = v_uv.x * ${floatLit(xMax - xMin)} + ${floatLit(xMin)};
    float py = v_uv.y * ${floatLit(yMax - yMin)} + ${floatLit(yMin)};
    vec2 plotCoord = vec2(px, py);

    // Call the selected function
    ${fn.returnType} result = ${fn.name}(${callArgs});

    ${storeResult}
}`
}

/** Ensure a number is written as a valid GLSL float literal (always has a dot) */
function floatLit(n) {
    const s = n.toString()
    return s.includes('.') ? s : s + '.0'
}
