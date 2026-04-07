import { parse } from "@shaderfrog/glsl-parser"

/**
 * Parse a GLSL source string and return extracted functions and uniforms.
 * Returns null if the code has a syntax error.
 */
export function parseGLSL(code) {
    try {
        // quiet: true — suppresses "undefined variable" warnings for GLSL
        // built-ins like gl_FragCoord, gl_Position that the parser doesn't know about
        const ast = parse(code, { quiet: true })
        const uniforms = extractUniforms(ast, code)
        return {
            functions: extractFunctions(ast),
            uniforms:  mergeshadertoyUniforms(uniforms, code),
            source:    code,
        }
    } catch (e) {
        console.error("GLSL parse error:", e)
        return null
    }
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Get the plain type name string out of a TypeSpecifierNode.
 */
function getTypeName(typeSpecifierNode) {
    const s = typeSpecifierNode?.specifier
    return s?.token ?? s?.identifier ?? 'unknown'
}

// ─── functions ───────────────────────────────────────────────────────────────

function extractFunctions(ast) {
    const functions = []

    for (const node of ast.program) {
        if (node.type !== 'function') continue

        const header     = node.prototype.header
        const name       = header.name.identifier
        const returnType = getTypeName(header.returnType.specifier)
        const params     = (node.prototype.parameters ?? []).map(p => ({
            type: getTypeName(p.specifier),
            name: p.identifier?.identifier ?? '',
        }))
        // Unique identifier that survives overloading — e.g. "vec2 mod289(vec2)"
        const id = `${returnType} ${name}(${params.map(p => p.type).join(', ')})`

        const loops        = extractLoops(node.body)
        const preLoopVars  = extractPreLoopVars(node.body)

        // In void main() every for-loop can have fragColor tracked across iterations,
        // even when the loop body declares no local variables.
        if (name === 'main' && returnType === 'void') {
            for (const loop of loops) {
                loop.localVars.push({ type: 'vec4', name: 'fragColor', isOutput: true })
            }
        }

        // For void functions with NO for-loops, expose all body-local vars as
        // trackable chips.  We reuse preLoopVars (which already scans the whole
        // body when there is no for-statement to stop it early) and append a
        // synthetic fragColor entry for void main so users can see the output.
        const bodyVars = (loops.length === 0 && returnType === 'void')
            ? [
                ...preLoopVars,
                ...(name === 'main'
                    ? [{ type: 'vec4', name: 'fragColor', isOutput: true }]
                    : []),
              ]
            : []

        functions.push({ id, name, returnType, params, loops, preLoopVars, bodyVars })
    }

    return functions
}

function extractLoops(bodyNode) {
    const loops = []
    if (!bodyNode?.statements) return loops

    for (const stmt of bodyNode.statements) {
        if (stmt.type !== 'for_statement') continue

        let loopVar     = null
        let loopVarType = null
        const init = stmt.init
        if (init?.type === 'declaration_statement') {
            const decl = init.declaration
            if (decl?.type === 'declarator_list') {
                loopVarType = getTypeName(decl.specified_type.specifier)
                loopVar     = decl.declarations?.[0]?.identifier?.identifier ?? null
            }
        }

        const localVars = []
        const body = stmt.body
        const statements = body?.statements ?? []

        for (const s of statements) {
            if (s.type !== 'declaration_statement') continue
            const decl = s.declaration
            if (decl?.type !== 'declarator_list') continue
            const type = getTypeName(decl.specified_type.specifier)
            for (const d of decl.declarations ?? []) {
                const varName = d.identifier?.identifier
                if (varName) localVars.push({ type, name: varName })
            }
        }

        loops.push({ loopVar, loopVarType, localVars })
    }

    return loops
}

function extractPreLoopVars(bodyNode) {
    const vars = []
    if (!bodyNode?.statements) return vars

    for (const stmt of bodyNode.statements) {
        if (stmt.type === 'for_statement') break
        if (stmt.type !== 'declaration_statement') continue

        const decl = stmt.declaration
        if (decl?.type !== 'declarator_list') continue

        const qualifiers = decl.specified_type.qualifiers ?? []
        const isUniform  = qualifiers.some(q => q.type === 'keyword' && q.token === 'uniform')
        if (isUniform) continue

        const type = getTypeName(decl.specified_type.specifier)
        for (const d of decl.declarations ?? []) {
            const name = d.identifier?.identifier
            if (name) vars.push({ type, name })
        }
    }

    return vars
}

// ─── uniforms ────────────────────────────────────────────────────────────────

/**
 * Walk the top-level statements and collect uniform variable declarations.
 * Also reads inline comments to extract default values and slider ranges:
 *
 *   uniform vec3 u_rgb;   //0, 0.6, 1.2 [0, 6]
 *   uniform float u_time; //0.4, [0, 2]
 *
 * Each result looks like:
 *   { name: "u_rgb", type: "vec3", value: [0, 0.6, 1.2], range: { min: 0, max: 6 } }
 */
function extractUniforms(ast, source) {
    const uniforms = []

    for (const node of ast.program) {
        if (node.type !== 'declaration_statement') continue

        const decl = node.declaration
        if (decl.type !== 'declarator_list') continue

        const qualifiers = decl.specified_type.qualifiers ?? []
        const isUniform  = qualifiers.some(q => q.type === 'keyword' && q.token === 'uniform')
        if (!isUniform) continue

        const typeName = getTypeName(decl.specified_type.specifier)

        for (const declaration of decl.declarations) {
            const name = declaration.identifier.identifier
            const line = findUniformLine(source, name)
            const { value: commentValue, range } = parseUniformComment(line, typeName)

            uniforms.push({
                name,
                type:  typeName,
                value: commentValue ?? defaultValue(typeName),
                range: range ?? null,
            })
        }
    }

    return uniforms
}

// ─── comment parsing ──────────────────────────────────────────────────────────

/**
 * Find the source line that declares a given uniform name.
 */
function findUniformLine(source, name) {
    const re = new RegExp(`\\buniform\\b[^;]*\\b${name}\\b`)
    for (const line of source.split('\n')) {
        if (re.test(line)) return line
    }
    return ''
}

/**
 * Parse a uniform declaration line's inline comment to extract default value
 * and slider range.
 *
 * Supported format (all parts optional):
 *   // defaultVal [min, max]           (scalar)
 *   // x, y, z [min, max]             (vector)
 *   // x, y, z,  [min, max]           (trailing comma OK)
 *
 * Returns { value?, range? }
 */
function parseUniformComment(line, type) {
    const commentIdx = line.indexOf('//')
    if (commentIdx === -1) return {}
    const comment = line.slice(commentIdx + 2).trim()

    // Extract range [min, max]
    const rangeMatch = comment.match(/\[([^\]]+)\]/)
    let range = null
    if (rangeMatch) {
        const parts = rangeMatch[1].split(',').map(s => parseFloat(s.trim()))
        if (parts.length === 2 && parts.every(isFinite)) {
            range = { min: parts[0], max: parts[1] }
        }
    }

    // Extract default values — everything before the '[', stripped of trailing commas
    const beforeRange = rangeMatch
        ? comment.slice(0, comment.indexOf('[')).trim()
        : comment.trim()
    const defaultStr = beforeRange.replace(/,\s*$/, '').trim()

    if (!defaultStr) return { range }

    const nums = defaultStr.split(',').map(s => parseFloat(s.trim())).filter(isFinite)
    if (!nums.length) return { range }

    const dim = typeDimension(type)
    let value
    if (dim === 1) {
        value = type === 'int' ? Math.round(nums[0]) : nums[0]
    } else if (nums.length >= dim) {
        value = nums.slice(0, dim)
    }

    return { value, range }
}

function typeDimension(type) {
    switch (type) {
        case 'float': case 'int': case 'bool': return 1
        case 'vec2': case 'ivec2': return 2
        case 'vec3': case 'ivec3': return 3
        case 'vec4': case 'ivec4': return 4
        default: return 1
    }
}

// ─── Shadertoy built-in uniforms ─────────────────────────────────────────────

const SHADERTOY_UNIFORMS = [
    { name: 'u_time',       type: 'float', value: 0,             range: { min: 0, max: 100  } },
    { name: 'u_resolution', type: 'vec2',  value: [512, 512],    range: { min: 0, max: 2048 }, auto: true },
    { name: 'u_mouse',      type: 'vec2',  value: [0, 0],        range: { min: 0, max: 1024 } },
    { name: 'u_date',       type: 'vec4',  value: [0, 0, 0, 0],  range: { min: 0, max: 365  } },
    { name: 'iTime',        type: 'float', value: 0,             range: { min: 0, max: 100  } },
    { name: 'iResolution',  type: 'vec3',  value: [512, 512, 1], range: { min: 0, max: 2048 }, auto: true },
    { name: 'iMouse',       type: 'vec4',  value: [0, 0, 0, 0],  range: { min: 0, max: 1024 } },
    { name: 'iDate',        type: 'vec4',  value: [0, 0, 0, 0],  range: { min: 0, max: 365  } },
    { name: 'iFrame',       type: 'int',   value: 0,             range: { min: 0, max: 1000 } },
]

function mergeshadertoyUniforms(declared, source) {
    const declaredNames = new Set(declared.map(u => u.name))
    const extra = []

    for (const builtin of SHADERTOY_UNIFORMS) {
        if (declaredNames.has(builtin.name)) continue
        const re = new RegExp(`\\b${builtin.name}\\b`)
        if (!re.test(source)) continue
        extra.push({
            name:  builtin.name,
            type:  builtin.type,
            value: builtin.value,
            range: builtin.range,
        })
    }

    return [...declared, ...extra]
}

// ─── default values ──────────────────────────────────────────────────────────

function defaultValue(type) {
    switch (type) {
        case 'float':  return 0
        case 'int':    return 0
        case 'bool':   return false
        case 'vec2':   return [0, 0]
        case 'vec3':   return [0, 0, 0]
        case 'vec4':   return [0, 0, 0, 0]
        case 'mat2':   return [1,0, 0,1]
        case 'mat3':   return [1,0,0, 0,1,0, 0,0,1]
        case 'mat4':   return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
        default:       return null
    }
}
