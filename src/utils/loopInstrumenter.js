/**
 * loopInstrumenter.js
 *
 * Rewrites a GLSL shader to stop a for-loop at iteration N and output
 * the value of a watched variable as fragColor, for Mode B visualization.
 *
 * Strategy:
 *   - Find the Nth for-loop inside the target function
 *   - Inject a debug-break after all local declarations in the loop body
 *   - The break outputs the watched variable to fragColor and exits the loop
 *   - u_debug_N (float uniform) controls which iteration to stop at
 */

/**
 * @param {string} source      — original GLSL source
 * @param {object} loopInfo    — { fn, loopIndex, loop, watchVar }
 * @returns {string}           — complete instrumented fragment shader
 */
export function instrumentLoop(source, loopInfo) {
    const { fn, loopIndex, loop, watchVar, isPreLoop } = loopInfo

    const outputExpr = buildOutputExpr(watchVar)

    // Use `return` (not `break`) so post-loop fragColor assignments can't overwrite
    // the captured debug value.
    const captureSnippet = `
    // ── debug capture injected by shader analyzer ──
    if (float(i_debug_counter) >= u_debug_N) {
        fragColor = ${outputExpr};
        return;
    }
    i_debug_counter++;
    // ──────────────────────────────────────────────
`

    let instrumented = source

    // For pre-loop vars: inject a capture point BEFORE the first for-loop.
    // This makes u_debug_N == 0 correspond to the variable's initial value.
    if (isPreLoop) {
        instrumented = injectBeforeLoop(instrumented, fn.name, captureSnippet)
    }

    // Inject a capture point inside the loop body (steps 1..N for pre-loop vars,
    // steps 0..N for loop-local vars).
    if (loop) {
        instrumented = injectIntoLoop(instrumented, fn.name, loopIndex, loop.loopVar, captureSnippet)
    }

    return buildShader(instrumented)
}

// ── Output expression builder ────────────────────────────────────────────────

/**
 * Convert a watched variable to a vec4 suitable for fragColor.
 * We store the raw value — Pass 2 heatmap will colorize it.
 *
 *   float  → vec4(value, 0, 0, 1)
 *   vec2   → vec4(value.x, value.y, 0, 1)   stored in .rg
 *   vec3   → vec4(value.rgb, 1)
 *   vec4   → value directly
 */
function buildOutputExpr(watchVar) {
    const n = watchVar.name
    switch (watchVar.type) {
        case 'float': return `vec4(${n}, 0.0, 0.0, 1.0)`
        case 'vec2':  return `vec4(${n}.x, ${n}.y, 0.0, 1.0)`
        case 'vec3':  return `vec4(${n}.rgb, 1.0)`
        case 'vec4':  return n
        default:      return `vec4(0.0, 0.0, 0.0, 1.0)`
    }
}

// ── Injection into source ────────────────────────────────────────────────────

/**
 * Find the Nth for-loop inside the named function and inject code
 * after its local variable declarations.
 *
 * Uses character-level brace counting — no AST needed here since we
 * already know the structure from the parsed metadata.
 */
function injectIntoLoop(source, fnName, loopIndex, loopVar, injection) {
    // Find the function body start
    const fnStart = findFunctionBody(source, fnName)
    if (fnStart === -1) return source

    // Find the Nth for-loop inside that function
    const loopBodyStart = findNthForLoop(source, fnStart, loopIndex)
    if (loopBodyStart === -1) return source

    // Find the injection point: after all declaration statements in the loop body
    const injectAt = findInjectionPoint(source, loopBodyStart)

    return source.slice(0, injectAt) + injection + source.slice(injectAt)
}

/**
 * Inject code into the function body just BEFORE its first for-loop.
 * This is where pre-loop variables have already been initialised.
 */
function injectBeforeLoop(source, fnName, injection) {
    const fnStart = findFunctionBody(source, fnName)
    if (fnStart === -1) return source

    const injectAt = findPreLoopInjectionPoint(source, fnStart)
    return source.slice(0, injectAt) + injection + '\n    ' + source.slice(injectAt)
}

/**
 * Walk the function body and return the position of the first `for` keyword
 * that is at depth 1 (direct child of the function body).
 * We inject the pre-loop capture snippet right before this position.
 */
function findPreLoopInjectionPoint(src, fnBodyStart) {
    let i     = fnBodyStart + 1   // step past the opening {
    let depth = 1

    while (i < src.length) {
        if (src[i] === '{') depth++
        if (src[i] === '}') {
            depth--
            if (depth === 0) return i   // end of function — inject before closing brace
        }

        // First `for` at function depth → inject right before it
        if (depth === 1 && src.slice(i, i + 3) === 'for' && /\W/.test(src[i + 3] ?? ' ')) {
            return i
        }
        i++
    }
    return fnBodyStart + 1
}

/** Find the opening { of the named function's body */
function findFunctionBody(src, fnName) {
    // Match: returnType fnName( ... ) {
    const re = new RegExp(`\\b${fnName}\\s*\\(`)
    const match = re.exec(src)
    if (!match) return -1

    // Walk forward to find the opening brace of the function
    let i = match.index
    while (i < src.length && src[i] !== '{') i++
    return i  // position of {
}

/** Find the opening { of the Nth for-loop after startPos */
function findNthForLoop(src, startPos, targetIndex) {
    let count   = 0
    let i       = startPos
    let depth   = 0  // brace depth relative to the function body

    // Track when we enter the function body
    if (src[i] === '{') { depth = 1; i++ }

    while (i < src.length) {
        if (src[i] === '{') depth++
        if (src[i] === '}') {
            depth--
            if (depth === 0) break  // exited the function body
        }

        // Look for "for" keyword at the current function depth (depth === 1)
        if (depth === 1 && src.slice(i, i + 3) === 'for' && /\W/.test(src[i + 3] ?? ' ')) {
            if (count === targetIndex) {
                // Walk forward to find the for-loop's body opening brace
                while (i < src.length && src[i] !== '{') i++
                return i  // position of for-loop body {
            }
            count++
        }
        i++
    }
    return -1
}

/**
 * Find the position of the closing } of the loop body.
 * We inject the capture snippet right before this brace so that every
 * variable declared anywhere inside the loop body is guaranteed to be
 * in scope — including variables declared after expression statements.
 *
 * Example: if the loop body is:
 *   { vec2 p = …; float l = …; u *= …;  vec3 hue = …; col += …; }
 *                                                                 ^ inject here
 * All of p, l, hue, col are in scope at this point.
 */
function findInjectionPoint(src, loopBodyOpen) {
    let i     = loopBodyOpen + 1   // step past the opening {
    let depth = 1

    while (i < src.length) {
        if (src[i] === '{') depth++
        if (src[i] === '}') {
            depth--
            if (depth === 0) return i   // position of the closing }
        }
        i++
    }
    return loopBodyOpen + 1
}

// ── Full shader builder ──────────────────────────────────────────────────────

/**
 * Wrap the instrumented source in a complete #version 300 es shader.
 * Strips the original #version line and void main if present,
 * then provides our own main that calls the original.
 *
 * Unlike Mode A, Mode B runs the original main() directly —
 * we only injected a break inside it, so we keep main() as-is.
 */
function buildShader(instrumentedSource) {
    // Remove any existing #version directive — we'll add our own
    const withoutVersion = instrumentedSource.replace(/^\s*#version\s+\S+\s*/m, '')

    // Strip any of these declarations that may already exist in the user source
    // to avoid redefinition errors
    const INJECTED = ['u_resolution', 'u_time', 'u_date', 'u_mouse', 'u_frame']
    let cleaned = withoutVersion
    for (const name of INJECTED) {
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
        '// ── standard Shadertoy-compatible uniforms ──',
        'uniform vec2  u_resolution;',
        'uniform float u_time;',
        'uniform vec4  u_date;',
        'uniform vec2  u_mouse;',
        'uniform int   u_frame;',
        '',
        '// ── Mode B debug uniforms ──',
        'uniform float u_debug_N;',
        'int i_debug_counter = 0;',
        '',
        '// ── original shader (instrumented) ──',
        cleaned,
    ].join('\n')
}
