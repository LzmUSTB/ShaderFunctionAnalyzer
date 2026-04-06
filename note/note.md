# シェーダー関数アナライザー 開発ノート

このアプリは、GLSLシェーダーコードを視覚的に解析・デバッグするためのツール。
ShaderToyなどのシェーダーを学習するときに、パラメータの値をグラフで確認できるようにする。

---

## アーキテクチャ

```
App.vue                  ← レイアウト全体 + 共有state（parsedFunctions, parsedUniforms）
├── CodePanel.vue        ← GLSLコードの入力エリア + Parseボタン
├── SidePanel.vue        ← パース結果の表示（関数一覧・uniform一覧）
└── GraphPanel.vue       ← WebGLキャンバス（グラフ描画）
```

**データの流れ:**
```
CodePanel  →  emit('parse', {functions, uniforms})
                    ↓
App.vue    →  parsedFunctions / parsedUniforms に保存
                    ↓
SidePanel  ←  props として受け取る
GraphPanel ←  選択された関数をpropsで受け取る（Step 4以降）
```

---

## ステップ別メモ

### Step 1 — レイアウト
- CSS Flexboxで3カラムレイアウト（コード・サイドパネル・グラフ）
- `flex: 2 / 1 / 2` で幅の比率を設定
- `height: 100vh` で画面いっぱいに表示
- `style.css` の `place-items: center` と `#app` の `padding` を削除しないと全画面にならない

### Step 2 — GLSLパーサー
- `@shaderfrog/glsl-parser` ライブラリを使用
- `parse(code)` → ASTツリーを生成
- ASTとは: コードをオブジェクトのツリー構造に変換したもの（Abstract Syntax Tree）

---

## ASTの構造メモ

GLSLの `uniform float u_time;` は以下のツリーになる:
```
declaration_statement
  └── declarator_list
        ├── specified_type
        │     ├── qualifiers: [ keyword("uniform") ]
        │     └── specifier: type_specifier → keyword("float")
        └── declarations: [ declaration → identifier("u_time") ]
```

GLSLの `float circle(vec2 p, float r) { ... }` は:
```
function
  └── prototype
        ├── header
        │     ├── returnType → type_specifier → keyword("float")
        │     └── name → identifier("circle")
        └── parameters
              ├── parameter_declaration → specifier("vec2"), identifier("p")
              └── parameter_declaration → specifier("float"), identifier("r")
```

**ポイント:** `uniform` 宣言や関数定義は必ずファイルのトップレベルにある
→ `ast.program[]` をループするだけでよく、深い再帰は不要

---

## Mode B — ループスクラバー

### コンセプト
`for` ループを含む `void` 関数（例: `main()`）を可視化するモード。
ループをイテレーション N で止めて、その時点のローカル変数の値を全ピクセルで表示する。

### Shader Instrumentation（計装）

元のシェーダーコードを実行時に書き換えてデバッグ出力を注入する技術。

```glsl
// 元のコード
for(float i; i++<1e2;) {
    vec2 c = ...;
    fragColor = ...;
}

// 注入後（instrumentLoop() が生成）
for(float i; i++<1e2;) {
    vec2 c = ...;                    // ← 宣言はそのまま上に残す
    // ↓ ここに注入（宣言の後、他の処理の前）
    if (float(i_debug_counter) >= u_debug_N) {
        fragColor = vec4(c.x, c.y, 0.0, 1.0);
        break;
    }
    i_debug_counter++;
    fragColor = ...;
}
```

**なぜ宣言の後に注入するか？**
注入点より前に `vec2 c` が宣言されていないと、`c` を参照できずコンパイルエラーになるため。

### 注入点の決定アルゴリズム（`findInjectionPoint`）
1. ループボディの `{` の直後から走査開始
2. 型キーワード（`float`, `vec2` など）で始まる文はスキップ（宣言）
3. 最初の「非宣言文」の位置に注入する

### ループ変数のフロー
```
SidePanel: var-chip クリック
  → emit('select-watch-var', { fn, loopIndex, loop, watchVar })
      ↓
App.vue: selectedLoop = { fn, loopIndex, loop, watchVar }
      ↓
GraphPanel: watch(selectedLoop) → plotLoop()
  → instrumentLoop(source, selectedLoop) → 注入済みシェーダー生成
  → renderer.compile() → renderer.render({ u_debug_N: iterN })
      ↓
スライダー操作: iterN が変わる → plotLoop() 再実行
```

### 型別の出力マッピング（RGBA32F テクスチャへ）
| 変数の型 | fragColor への格納 | ツールチップ表示 |
|---|---|---|
| `float` | `vec4(value, 0, 0, 1)` | `.r` の値 |
| `vec2` | `vec4(x, y, 0, 1)` | `.r` と `.g` の値 |
| `vec3` | `vec4(rgb, 1)` | `.r` の値（将来的に3チャンネル） |
| `vec4` | そのまま | `.r` の値 |

---

## ハマりやすいポイント（バグメモ）

- `void main()` のようにパラメータがない関数では `prototype.parameters` が `undefined` になる
  → `(node.prototype.parameters ?? []).map(...)` で安全に処理する

---

## WebGLメモ（Step 4以降）

### グラフ表示の仕組み（2パス方式）
```
Pass 1（非表示）: RGBA32F浮動小数点テクスチャにシェーダーの計算結果を書き込む
                  → 値の範囲に関係なく正確なfloat値を保存（例: -3.7, 150.2）
Pass 2（表示）:   浮動小数点テクスチャをヒートマップ色にマッピングして表示
                  → 表示用の色範囲（例: [-2, 2]）は視覚化のためだけ

ホバー時:         Pass 1のテクスチャから gl.readPixels() で正確な値を取得
                  → ツールチップに表示（例: f([0,1]) = 2）
```

**精度について:** WebGL2の `RGBA32F` はIEEE 754単精度浮動小数点（約7桁）
→ GLSLの `float` と同じ精度なので、シェーダーが計算した値をそのまま取得できる

### シェーダーで関数をプロットする方法
```
キャンバスの各ピクセル (300, 200) on 600x400
  → UV座標にマッピング: p = (0.0, 0.0) in [-1,1] の範囲
  → 関数を評価: f(p) = some_value
  → 値に応じて色付け（ヒートマップ）
  → ホバーでピクセルの正確な値を表示
```

---

## 使用技術

| 技術 | 用途 |
|---|---|
| Vue 3 (Composition API) | UIフレームワーク |
| Vite | ビルドツール |
| @shaderfrog/glsl-parser | GLSLのASTパーサー |
| WebGL2 | シェーダー実行・グラフ描画 |
| RGBA32F テクスチャ | 正確な浮動小数点値の保存 |

---

## ヒートマップの仕組みと見方

### ヒートマップとは

ヒートマップは「**全ピクセルに対して、選択した変数の値を色で表示したもの**」。

- **青** → 値が小さい（minVal 側）  
- **白** → 中間値  
- **赤** → 値が大きい（maxVal 側）

ヒートマップの各ピクセル座標 = そのピクセルの `gl_FragCoord.xy` に対応する。  
つまり「どの画素でその変数がいくつになるか」を一度に視覚化している。

---

### Mode A（関数を選んだとき）

例：`float circle(vec2 p)` を選択すると…

```
float circle(vec2 p) {
    return step(length(p) - 0.5, 0.0);
}
```

- ヒートマップ上の座標 `(x, y)` は、プロットレンジ（例：-1〜1）にマッピングされた plotCoord になる  
- 各ピクセルで `circle(plotCoord)` の戻り値が計算され、その float 値が色になる  
- 結果：中心付近が赤（1.0）、外側が青（0.0）→ 白い円が見える

**ヒートマップが一様な色のとき** → 関数の出力が全画素で同じ（定数）

---

### Mode B（ループ変数を選んだとき）

例：Fibonacci Disk シェーダーで `vec3 col` を選択し、scrubber を動かすと…

```glsl
vec3 col = vec3(0);  // ← step 0 はここの値

for (float i = 1.0; i < 16.0; i += 1.0/i) {
    // ← step 1, 2, 3... ここのループ本体実行後の col の値
    col += pow(max(n * hue, 0.0) * sqrt(l) * 0.1, vec3(3.0));
}
```

| step | 意味 | ヒートマップが示すもの |
|------|------|----------------------|
| 0 | ループ前 | `col = vec3(0)` → 全画素が黒（最小値） |
| 1 | 1回目の反復後 | 1つのリング由来の輝度分布 |
| 5 | 5回目の反復後 | 5つのリングが重なった状態 |
| 15 | ループ終了後 | 最終的な `col` の空間分布 |

**スクラバーを動かす** = シェーダーを何度も再コンパイルせず、`u_debug_N` の値だけ変えて再レンダリングしている。

---

### スレッドトラッカー（ピクセルをクリックしたとき）

ヒートマップをクリックすると、**そのピクセル1点**の実行スレッドを追跡できる。

- `gl_FragCoord.xy` が固定される（そのピクセルの座標）
- `u_resolution`・`u_time`・その他ユニフォームもスライダーの現在値で固定
- step 0〜N まで順番にレンダリングし、そのピクセルの値を読み出す
- **折れ線グラフ** に描画：横軸 = step、縦軸 = 変数の値

**例：`vec3 col` を選んで左上のピクセルをクリックした場合**

```
step 0:  col.r = 0.000  ← ループ前、0
step 1:  col.r = 0.003  ← 1つ目のリングがこのピクセルに少し寄与
step 4:  col.r = 0.021  ← 4つ目のリングで急激に増加
step 8:  col.r = 0.025  ← ほぼ収束
step 14: col.r = 0.026  ← ループ終了時の最終値
```

グラフが**フラット**な変数（例：`vec2 P`）は、ループ中に値が変化しないことを意味する。  
グラフが**急峻に変化**する箇所は、そのステップで大きな寄与があったことを示す。

---

### range（min → max）コントロールについて

ヒートマップの色はこの範囲で正規化される：

- `range: -1 → 1` のとき、値が -1.0 以下 = 真っ青、1.0 以上 = 真っ赤
- `circle()` の出力（0 か 1）を見るには `range: 0 → 1` に設定すると鮮明になる
- `col` の蓄積値（微小な正の数）は `range: 0 → 0.1` 程度にするとコントラストが出る

