# Shader Function Analyzer

An interactive tool for analyzing GLSL fragment shaders. Paste your shader code, select a function or loop variable, click a pixel on the rendered output, and watch how the value evolves across loop iterations — all in real time.

---

## Features

- **GLSL syntax highlighting** in the code editor
- **Function list** showing all parsed functions and their parameters
- **Uniform controls** — sliders and checkboxes for every uniform declared in the shader
- **Heatmap visualization** of float/vec2 variable values across the canvas
- **Color visualization** for vec3/vec4 variables — shows the actual RGB output
- **Thread chart** — tracks how a selected variable changes over loop iterations at a specific pixel
- **Resizable splitter** between the heatmap and the chart

---

## Quick Start

### 1. Paste Your Shader

Paste a GLSL fragment shader into the left panel. The editor expects a complete fragment shader body — the code that would be compiled as the fragment stage.

Uniform declarations support optional range hints in comments:

```glsl
uniform float u_speed; //0.4, [0, 2]
//            value ↑   ↑ default  ↑ max
uniform vec3 u_rgb;    //0, 0.6, 1.2 [0, 6]
uniform int u_colors;  //3, [1, 5]
```

The format is: `// defaultValue, [min, max]` — for vec types, provide one default per component.

### 2. Click PARSE

The **PARSE** button compiles the shader and populates:
- The **Functions** list on the right panel
- The **Uniforms** list with controls for each uniform

### 3. Adjust Uniforms

Use the sliders in the Uniforms section to change uniform values in real time. The heatmap re-renders automatically.

### 4. Select a Function or Variable

**To view a non-void function's output as a heatmap:**
- Click the function name in the Functions list
- A blue→white→red heatmap appears on the canvas, showing the function's return value per pixel

**To trace a loop variable:**
- Click a `for` loop entry (indented under a `void` function)
- Click a variable chip next to the loop (e.g. `float n`, `vec3 col`) to select the watch variable

**Pre-loop variables** (declared before the loop, like `vec2 P`) appear in a separate chip row above the loop and can also be selected.

### 5. Click a Pixel to Track

Once a watch variable is selected, click anywhere on the heatmap canvas. The **Thread Chart** at the bottom shows how the variable's value changes across every iteration of the loop at that pixel.

- **float / vec2 variables**: shown as a line chart (1 or 2 channels)
- **vec3 / vec4 variables**: the canvas switches to full-color display; the chart tracks the RGB channels

Hover over the chart to see exact values at each iteration step.

### 6. Adjust the Split

Drag the horizontal divider between the canvas and the chart to resize both areas.

---

## Test Shader Examples

### Example 1 — Simple Loop with Float Variable

Best for testing the basic loop-tracing workflow. Tracks how `n` accumulates across iterations.

```glsl
uniform float u_speed;  //0.4, [0, 2]
uniform float u_lines;  //30, [10, 50]

float rand1(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float value_noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = rand1(i);
    float b = rand1(i + vec2(1.0, 0.0));
    float c = rand1(i + vec2(0.0, 1.0));
    float d = rand1(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float n = 0.0;
    for (float i = 0.0; i < 8.0; i += 1.0) {
        float scale = pow(2.0, i);
        n += value_noise(uv * scale * u_lines) / scale;
    }
    fragColor = vec4(vec3(n), 1.0);
}
```

**How to use:**
1. Parse the shader
2. Select `void main` → click the `for` loop → click chip `float n`
3. Click a pixel on the canvas
4. The chart shows how `n` accumulates over 8 iterations

---

### Example 2 — vec3 Color Accumulation

Best for testing the vec3 color visualization mode.

```glsl
uniform vec3 u_colorA;  //0.2, 0.5, 1.0 [0, 1]
uniform vec3 u_colorB;  //1.0, 0.3, 0.1 [0, 1]
uniform float u_steps;  //6, [2, 12]

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec3 col = vec3(0.0);
    float n = floor(u_steps);
    for (float i = 0.0; i < 12.0; i += 1.0) {
        if (i >= n) break;
        float t = i / max(n - 1.0, 1.0);
        float mask = smoothstep(t - 0.1, t + 0.1, uv.x) *
                     (1.0 - smoothstep(t + 0.1, t + 0.3, uv.x));
        col += mix(u_colorA, u_colorB, t) * mask;
    }
    fragColor = vec4(col, 1.0);
}
```

**How to use:**
1. Parse the shader
2. Select `void main` → click the `for` loop → click chip `vec3 col`
3. The canvas switches to color display mode
4. Click a pixel — the chart shows R, G, B channels separately

---

### Example 3 — Non-void Function (Heatmap)

Demonstrates selecting a non-void function to view its output as a heatmap.

```glsl
uniform float u_freq;   //4.0, [1, 20]
uniform float u_phase;  //0.0, [0, 6]

float pattern(vec2 uv) {
    float a = sin(uv.x * u_freq + u_phase);
    float b = sin(uv.y * u_freq - u_phase);
    return a * b;
}

float edge(vec2 uv) {
    float dx = dFdx(pattern(uv));
    float dy = dFdy(pattern(uv));
    return length(vec2(dx, dy)) * 10.0;
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float v = pattern(uv);
    fragColor = vec4(vec3(v * 0.5 + 0.5), 1.0);
}
```

**How to use:**
1. Parse the shader
2. Click `float pattern` in the Functions list — the canvas shows a heatmap of `pattern()`'s return value
3. Drag the `u_freq` slider to change the frequency in real time
4. Click `float edge` to switch to the edge detection heatmap

---

## Uniform Declaration Reference

```glsl
// Single float
uniform float u_name;  //defaultValue, [min, max]

// Integer
uniform int u_name;    //defaultValue, [min, max]

// Boolean
uniform bool u_flag;   //0

// Vector — one default per component
uniform vec2 u_size;   //1.0, 2.0 [0, 10]
uniform vec3 u_color;  //0.2, 0.5, 1.0 [0, 1]
uniform vec4 u_rect;   //0, 0, 1, 1 [0, 1]

// Texture (no slider — not yet editable)
uniform sampler2D u_tex;
```

The range hint `[min, max]` is optional. If omitted, the slider defaults to `[-10, 10]`.

---

---

# シェーダー関数アナライザー

GLSLフラグメントシェーダーをインタラクティブに解析するツールです。シェーダーコードを貼り付け、関数やループ変数を選択し、描画されたキャンバス上のピクセルをクリックすると、ループの各イテレーションで値がどのように変化するかをリアルタイムで確認できます。

---

## 機能

- コードエディタの **GLSLシンタックスハイライト**
- 解析した全関数とパラメータを表示する **関数リスト**
- シェーダー内の全ユニフォームに対応した **スライダー/チェックボックス**
- float / vec2 変数の値をキャンバス全体に表示する **ヒートマップ**
- vec3 / vec4 変数の実際のRGBカラーを表示する **カラーモード**
- 特定ピクセルでの変数のループ推移を示す **スレッドチャート**
- ヒートマップとチャートの間を動かせる **リサイザブルスプリッター**

---

## クイックスタート

### 1. シェーダーを貼り付ける

左のエディタにGLSLフラグメントシェーダーを貼り付けます。

ユニフォーム宣言にはコメントで範囲ヒントを書けます：

```glsl
uniform float u_speed; //0.4, [0, 2]
uniform vec3 u_rgb;    //0, 0.6, 1.2 [0, 6]
uniform int u_colors;  //3, [1, 5]
```

書式: `// デフォルト値, [最小値, 最大値]` — vecタイプはコンポーネントの数だけデフォルト値を書く。

### 2. PARSE ボタンをクリック

シェーダーがコンパイルされ、右パネルに**関数リスト**と**ユニフォームコントロール**が表示されます。

### 3. ユニフォームを調整する

スライダーをドラッグするとヒートマップがリアルタイムで更新されます。

### 4. 関数または変数を選択する

**非void関数の出力をヒートマップで見る:**
- 関数リストの関数名をクリックする

**ループ変数を追跡する:**
- `void` 関数の下にある `for` ループエントリをクリックする
- ループ横に表示される変数チップ（例: `float n`, `vec3 col`）をクリックして監視変数を選択する

**プレループ変数**（ループより前に宣言された変数、例: `vec2 P`）はループの上の行にチップとして表示されます。

### 5. ピクセルをクリックして追跡

監視変数を選択した状態でキャンバス上の任意のピクセルをクリックします。下部の**スレッドチャート**に、そのピクセルでのループ全イテレーションにわたる変数の推移が表示されます。

- **float / vec2**: 折れ線グラフ（1〜2チャンネル）
- **vec3 / vec4**: キャンバスがカラー表示に切り替わり、RGB各チャンネルをチャートで追跡

チャート上をホバーすると各イテレーションの正確な値を確認できます。

### 6. 分割サイズを調整する

キャンバスとチャートの間の水平バーをドラッグしてサイズを変更できます。

---

## ユニフォーム宣言リファレンス

```glsl
uniform float u_name;  //デフォルト, [最小, 最大]
uniform int u_name;    //デフォルト, [最小, 最大]
uniform bool u_flag;   //0
uniform vec2 u_size;   //1.0, 2.0 [0, 10]
uniform vec3 u_color;  //0.2, 0.5, 1.0 [0, 1]
uniform vec4 u_rect;   //0, 0, 1, 1 [0, 1]
uniform sampler2D u_tex;  // スライダーなし
```

`[min, max]` ヒントを省略した場合、スライダーのデフォルト範囲は `[-10, 10]` になります。
