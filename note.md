# ShaderFunctionAnalyzer 技術ノート

Vue3 と OpenGL の知識を持つ開発者向けに、このアプリを作る上で必要だった新しい技術を整理する。

---

## 1. WebGL2 の基礎

### OpenGL との比較

| 概念 | OpenGL (デスクトップ) | WebGL2 |
|---|---|---|
| コンテキスト取得 | `glfwCreateWindow()` 等 | `canvas.getContext('webgl2')` |
| シェーダーコンパイル | `glCompileShader()` | `gl.compileShader()` |
| バッファ | `glGenBuffers()` | `gl.createBuffer()` |
| ユニフォーム | `glUniform1f()` | `gl.uniform1f()` |
| バージョン指定 | `#version 330 core` | `#version 300 es` |

WebGL2 は基本的に OpenGL ES 3.0 のサブセット。API 命名は同じ思想で、`gl.` プレフィックスが付くだけ。

### フルスクリーンクワッドの描画

WebGL では「画面全体を覆う三角形2枚（トライアングルストリップ）」を描くのが一般的なパターン：

```javascript
// NDC座標で4頂点: 左下 右下 左上 右上
const positions = new Float32Array([-1,-1,  1,-1,  -1,1,  1,1])
const buf = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, buf)
gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
// 描画
gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
```

頂点シェーダーで `v_uv = a_position * 0.5 + 0.5` とすると UV 座標 (0〜1) が得られる。

### 拡張機能の確認

WebGL2 でも一部の機能は拡張として提供される。浮動小数点テクスチャへのレンダリングには必須：

```javascript
if (!gl.getExtension('EXT_color_buffer_float'))
    throw new Error('float render target not supported')
```

---

## 2. 2パスレンダリングパイプライン

このアプリの核心。ユーザーのシェーダーを「そのまま実行」し、その結果を「別途表示用に変換」する構造。

```
ユーザーシェーダー → [Pass 1] → RGBA32F テクスチャ → [Pass 2] → スクリーン
                                (正確な float 値)        (ヒートマップ or パススルー)
```

### フレームバッファオブジェクト (FBO)

OpenGL の FBO と同じ概念。レンダリング先をスクリーンではなくテクスチャに変更する：

```javascript
// RGBA32F テクスチャ作成
const tex = gl.createTexture()
gl.bindTexture(gl.TEXTURE_2D, tex)
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null)

// FBO に接続
const fbo = gl.createFramebuffer()
gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)

// スクリーンに戻す
gl.bindFramebuffer(gl.FRAMEBUFFER, null)
```

### ピクセルの読み取り

FBO からピクセル値を CPU 側に読み出す。これがチャートデータの取得に使われる：

```javascript
gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
const buf = new Float32Array(4)
// WebGL の y=0 は下端、Canvas の y=0 は上端なので反転が必要
gl.readPixels(x, canvas.height - y, 1, 1, gl.RGBA, gl.FLOAT, buf)
// buf[0]=r, buf[1]=g, buf[2]=b, buf[3]=a
```

### ユニフォームの型に注意

`int` と `bool` は `uniform1f` ではなく `uniform1i` を使わなければならない。WebGL は型の不一致で `GL_INVALID_OPERATION` を返す。実行時に型を確認するには：

```javascript
const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(program, i) // { name, type, size }
    // info.type === gl.INT, gl.FLOAT, gl.FLOAT_VEC2, gl.SAMPLER_2D など
}
```

---

## 3. シェーダーインストルメンテーション

「ループの N 回目でどんな値を持っているか」を調べるために、シェーダーのソースコードを文字列として書き換える技術。AST（構文木）を使わず、波括弧の深さを数える文字スキャンで行った。

### 仕組み

1. ユーザーの for ループ本体を `{` `}` で囲まれた範囲として特定する
2. ループ本体の末尾に「デバッグキャプチャスニペット」を注入する
3. 注入されたシェーダーをコンパイル・実行する

```glsl
// 注入されるスニペット（概念）
int i_debug_counter = 0;  // グローバルに追加

// for ループ本体末尾に追加
if (float(i_debug_counter) >= u_debug_N) {
    fragColor = vec4(targetVar, 0.0, 0.0, 1.0);
    return;  // break ではなく return — 後続のコードを防ぐ
}
i_debug_counter++;
```

`return` を使う理由: for ループに `break` を使っても、`main()` の残りのコードが実行されてしまい `fragColor` が上書きされる。`return` で関数ごと抜ければ確実にキャプチャした値が保存される。

### 波括弧カウントの注意点

文字列スキャンでは、コメント内や文字列リテラル内の `{` `}` を誤カウントしないよう注意が必要。このアプリでは GLSL に文字列リテラルがないため、コメントだけ考慮すればよい。

### 重要な落とし穴: 末尾改行

注入スニペットの末尾に `\n` がないと：

```
// ── comment ──}   ← } が // コメントに飲み込まれる！
```

テンプレートリテラルの末尾には必ず改行を入れること：

```javascript
const snippet = `
    if (...) { ... }
    // ──────────────
`  // ← この } の前の改行が重要
```

---

## 4. テキストエリアへのシンタックスハイライト

「編集可能なテキストに色を付ける」問題。`<textarea>` は HTML を描画できないため、**オーバーレイ技術**を使う。

### 構造

```
[code-wrapper: position: relative]
├── [pre.code-highlight]  ← ハイライトされた HTML (後ろ)
│       v-html でスパン注入、pointer-events: none
└── [textarea.code-input] ← 透明なテキストエリア (前面, z-index:1)
        background: transparent; color: transparent; caret-color: #a8d8a8
```

### 重要な CSS の条件

両レイヤーが**完全に同じ見た目のサイズ**でなければテキストが食い違う：

```css
.code-highlight, .code-input {
    /* まったく同じ値にする */
    font-family: inherit;
    font-size: 13px;
    line-height: 1.6;
    padding: 12px;
    white-space: pre-wrap;     /* 折り返しを有効にする */
    overflow-wrap: break-word;
    tab-size: 4;
}
```

特に重要: `pre` のスクロールバーを **非表示にしてはいけない**。両レイヤーのスクロールバー幅が違うと、コンテンツ幅が変わり折り返し位置がズレる。

### Vue の `:deep()` が必要な理由

Vue の `<style scoped>` は、コンパイル時に全要素へ `data-v-xxxxxx` 属性を付与し、セレクタを `.hl-keyword[data-v-xxxxxx]` のように変換する。しかし `v-html` で動的挿入したスパンにはこの属性が付かないため、スコープドスタイルが効かない。

```css
/* これは効かない */
.hl-keyword { color: #569cd6; }

/* :deep() でスコープを突破する */
:deep(.hl-keyword) { color: #569cd6; }
```

### トークナイザーの設計

正規表現で左から右へスキャンし、最初にマッチしたパターンを使う。優先順位が重要：

```javascript
const TOKEN_RE = /
    \/\*[\s\S]*?\*\/   |  // ブロックコメント（最優先）
    \/\/[^\n]*         |  // 行コメント
    #\w+               |  // プリプロセッサ
    \b\d+\.\d*...\b    |  // 浮動小数点
    \b\d+...\b         |  // 整数
    [A-Za-z_]\w*       |  // 識別子
    [^\w\s]            |  // 記号
    \s+                   // 空白
/g
```

コメントを最初に置かないと、コメント内のキーワードが誤着色される。

---

## 5. レスポンシブ SVG チャート

### ResizeObserver

`window.resize` イベントの代わりに使う。特定要素のサイズ変化を高精度で検知できる：

```javascript
const ro = new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect
    svgW.value = Math.round(width)
    svgH.value = Math.round(height)
})
ro.observe(containerEl.value)
// コンポーネント破棄時に切断
onUnmounted(() => ro.disconnect())
```

### viewBox をコンテナサイズに合わせる

SVG の座標系を CSS ピクセルと一致させることで、ラベルの font-size 等をそのままピクセル値で書ける：

```html
<svg :viewBox="`0 0 ${svgW} ${svgH}`" preserveAspectRatio="none">
```

`svgW`, `svgH` が ResizeObserver で更新されるため、座標計算が常にコンテナ実サイズに基づく。

### 座標変換

データ値 → SVG 座標の変換：

```javascript
// x: データインデックス → SVG x 座標
function cX(i) {
    return PL + (i / (N - 1)) * CW  // PL=左マージン, CW=チャート幅
}
// y: 値 → SVG y 座標（上下反転に注意）
function cY(val) {
    return PT + CH - ((val - min) / range) * CH  // PT=上マージン, CH=チャート高さ
}
```

---

## 6. ドラッグで分割できるスプリッター

```javascript
function onSplitterMouseDown(e) {
    isDragging.value = true
    // document にリスナーを付けることで、高速移動でも外れない
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
}
function onMouseMove(e) {
    if (!isDragging.value) return
    const rect = areaEl.getBoundingClientRect()
    const pct = (e.clientY - rect.top) / rect.height * 100
    splitPct.value = Math.max(20, Math.min(80, pct))  // クランプ
}
```

イベントを `document` に付ける理由: 要素上でリスナーを付けると、マウスが要素外へ出た瞬間にドラッグが止まる。

---

## 7. 位置の保持とリサイズ対応

ピクセル座標 (x, y) をそのまま保存すると、ブラウザリサイズ後に座標がズレる。解決策: **割合 (パーセンテージ)** で保存する：

```javascript
// クリック時
trackedPixel.value = {
    cx, cy,  // 絶対ピクセル座標（今すぐ使う用）
    pct: { x: cx/canvas.width*100, y: cy/canvas.height*100 }  // 保存用
}

// リサイズ時
const { pct } = trackedPixel.value
trackedPixel.value = {
    cx: Math.round(pct.x/100 * newW),
    cy: Math.round(pct.y/100 * newH),
    pct  // 引き継ぐ
}
```

---

## 8. Vue3 コンポーネント設計のポイント

### 子コンポーネントへの切り出し判断

- ロジックとテンプレートが一体として再利用・保守できる単位であれば切り出す
- データは親が持ち、子は `props` で受け取って表示するのが基本
- 子から親への通知は `emit` を使う

### 内部状態の分離

ThreadChart のホバー状態 (`hover`) は外部に公開する必要がないため、コンポーネント内部の `reactive` で管理する。こういった「表示専用の一時状態」は子コンポーネント内に閉じ込めるとスッキリする。

### `computed` の活用

レンダリングに必要な計算値はすべて `computed` にする。Vue が依存関係を追跡し、必要な時だけ再計算するため、明示的なウォッチが不要になる場面が多い。

---

## まとめ: 学習の優先順位

1. **WebGL2 基本** — コンテキスト、シェーダーコンパイル、バッファ、ユニフォーム設定
2. **FBO & テクスチャ** — レンダリング先の切り替え、readPixels
3. **シンタックスハイライト** — オーバーレイ技術、:deep()、正規表現トークナイザー
4. **ResizeObserver** — window.resize より精度が高く、特定要素の監視に適している
5. **SVG 座標変換** — viewBox とコンテナサイズの一致、データ→座標の線形変換
6. **ドラッグ操作** — document レベルのイベント管理
