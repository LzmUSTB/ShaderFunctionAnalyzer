import { parse } from "@shaderfrog/glsl-parser"

export function parseGLSL(code) {
    try {
        const ast = parse(code)
        return ast
    } catch (e) {
        console.error("GLSL parse error:", e)
        return null
    }
}

export function traverse(node, visitor) {
    if (!node || typeof node !== "object") return

    visitor(node)

    for (const key in node) {
        const child = node[key]

        if (Array.isArray(child)) {
            child.forEach(n => traverse(n, visitor))
        } else if (typeof child === "object" && child !== null) {
            traverse(child, visitor)
        }
    }
}

export function extractVariables(ast) {
    const variables = []

    traverse(ast, (node) => {
        if (node.type === "declaration") {
            const decl = node

            const kind = decl.storageQualifier || "local"
            const dataType = decl.dataType

            if (decl.declarations) {
                decl.declarations.forEach(d => {
                    variables.push({
                        name: d.identifier,
                        type: dataType,
                        kind: kind,
                        value: getDefaultValue(dataType)
                    })
                })
            }
        }
    })

    return variables
}

function getDefaultValue(type) {
    switch (type) {
        case "float": return 0
        case "int": return 0
        case "vec2": return [0, 0]
        case "vec3": return [0, 0, 0]
        case "vec4": return [0, 0, 0, 0]
        default: return null
    }
}