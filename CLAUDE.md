# CLAUDE.md — 贪吃蛇小游戏

本文件是本项目的权威说明。若与全局 `~/.claude/CLAUDE.md` 冲突，以本文件为准。

## 1. 项目概览

原生 Web 贪吃蛇小游戏。目标：打开浏览器就能玩，核心玩法完整 + 进阶体验（难度递增、暂停重开、最高分持久化、音效、精细视觉）。

## 2. 技术栈与硬约束

- 原生 **HTML5 + CSS3 + ES2020 JavaScript（ES Modules）**
- **零依赖、零构建**：不引入 npm 包、不使用打包器/框架/预处理器
- 所有浏览器 API 使用前需确认兼容性；不做旧浏览器兜底（目标为现代 Chromium/Firefox/Safari）

### 运行方式（重要）

使用 ES Modules，`file://` 协议会因 CORS 被浏览器拦截，**必须通过 HTTP 服务打开**：

```bash
cd "D:/develop/ai coding/snake"
python -m http.server 8000
# 浏览器访问 http://localhost:8000
```

备选：`npx serve .`，或 VS Code 的 Live Server 插件。

## 3. 目录结构

```
snake/
├── CLAUDE.md          # 本文件
├── index.html         # 唯一页面：HUD + canvas + 遮罩层
├── css/
│   └── style.css      # 主题变量与布局
├── tests/             # 零依赖测试（Node 内置能力实现，见第 8 节）
│   ├── harness.mjs    # 极简断言工具
│   ├── run-all.mjs    # 汇总运行入口
│   └── *.test.mjs     # 各模块测试
└── js/
    ├── config.js      # 配置层：全部常量（唯一配置来源）
    ├── storage.js     # 服务层：localStorage 封装
    ├── audio.js       # 服务层：Web Audio 音效合成
    ├── input.js       # 服务层：键盘/触摸输入 → 方向指令
    ├── snake.js       # 领域层：蛇实体
    ├── food.js        # 领域层：食物实体
    ├── renderer.js    # 表现层：唯一操作 canvas 的模块
    ├── game.js        # 编排层：状态机 + 主循环 + 规则判定
    └── main.js        # 入口：装配依赖、启动
```

## 4. 架构分层与依赖规则

依赖方向**单向**，禁止反向引用：

```
        表现层 renderer.js
              ↑ (只读数据)
服务层 input/audio/storage → 编排层 game.js → 入口 main.js
              ↓
        领域层 snake.js / food.js
        配置层 config.js  ← 所有层都可引用
```

- **配置层** `config.js`：唯一常量来源。**禁止**在其他模块硬编码网格尺寸、速度、分值、存储 key。
- **领域层** `snake.js` / `food.js`：纯逻辑，**不得**触碰 DOM、canvas、localStorage、AudioContext。输入输出皆为普通数据，便于单测。
- **服务层** `storage.js` / `audio.js` / `input.js`：封装浏览器能力，对上层暴露简单接口，不参与游戏规则。
- **表现层** `renderer.js`：**唯一**调用 canvas 2D 上下文的模块。只读游戏状态，**不得**修改状态。
- **编排层** `game.js`：状态机、主循环、碰撞与计分规则。串联各模块，不含绘制细节。
- **入口** `main.js`：创建实例、注入依赖、绑定事件、启动。

跨模块通信一律通过 `import`/`export` 或显式传入的回调，**禁止使用全局变量**。

### 视觉约定

- 配色分两处：页面在 `css/style.css` 的 `:root` 变量，画布在 `js/renderer.js` 的 `PALETTE`。两者是同一套视觉语言的两种载体，改配色时需同时检查。
- 基调：深青黑底（明确的青色偏向，不是中性黑）；蛇身走**冷色**（尾部暗蓝 `hsl(214 62% 40%)` → 头部亮青绿 `hsl(158 78% 64%)`）；食物与页面强调色走**暖色**（橙 `#ff8a4c`、琥珀 `#f2b544`）。冷暖对比是刻意选择：满屏冷色蛇身时，暖色食物始终是最醒目的一点。
- 蛇身颜色按 **HSL 分量**插值，不用 RGB 插值——蓝到青绿的 RGB 插值会从灰色穿过，颜色发脏。
- 刻意避开「近黑底 + 单一亮绿强调色」这套通用配色：它读起来像模板产物，而非针对本项目的选择。

## 5. 状态机

`game.js` 维护唯一状态，取值：

| 状态 | 含义 | 可响应输入 |
|------|------|-----------|
| `READY` | 未开始（首屏） | Enter 开始 |
| `PLAYING` | 进行中 | 方向键、空格暂停、R 重开 |
| `PAUSED` | 已暂停 | 空格继续、R 重开 |
| `GAME_OVER` | 结束 | Enter/R 重开 |

状态迁移：
```
READY ──Enter──> PLAYING ──空格──> PAUSED ──空格──> PLAYING
                     │                  │
                     └──死亡──> GAME_OVER ──Enter/R──> PLAYING
```

主循环仅在 `PLAYING` 推进逻辑；`READY`/`PAUSED`/`GAME_OVER` 只做渲染。

## 6. 关键规则

- 网格：`COLS × ROWS`，蛇与食物坐标均为整数格 `{ x, y }`，原点在左上。
- 移动：头部先按方向新增一格；吃到食物则不删尾（长度 +1），否则删尾。
- 撞墙：头部越出 `[0, COLS) × [0, ROWS)` → 死亡。**不做穿墙**。
- 撞自身：头部坐标与蛇身（不含本回合将被移除的尾）重合 → 死亡。
- 反向保护：方向采用**队列**而非单值，且禁止 180° 掉头，避免快速连按导致自撞。
- 计分：每个食物 `SCORE_PER_FOOD` 分；每吃 `FOODS_PER_LEVEL` 个提升一级，移动间隔递减 `SPEED_STEP_MS`，不低于 `MIN_STEP_MS`。

## 7. 开发步骤（逐步推进，每步可独立验证）

- [x] **Step 1** 项目骨架 + CLAUDE.md：目录、index.html、样式、config.js、各模块骨架
- [x] **Step 2** 服务层：`storage.js`（最高分/静音持久化）、`audio.js`（音效合成）
- [x] **Step 3** 领域层：`snake.js`（移动/生长/自撞）、`food.js`（随机生成避开蛇身）＋ 测试固化到 `tests/`
- [x] **Step 4** 表现层：`renderer.js`（网格、蛇身渐变、食物发光、死亡闪烁）+ 样式完善
- [x] **Step 5** 服务层：`input.js`（键盘 → 语义化指令，暂停/重开/开始；触屏暂缓）
- [x] **Step 6** 编排层：`game.js`（状态机、主循环、碰撞判定、计分与提速）
- [x] **Step 7** 入口装配：`main.js` 串联全部模块，移除骨架自检代码
- [ ] **Step 8** 端到端自测，逐项过第 9 节验证清单

每步完成后向用户汇报：改动文件、验证方法、下一步计划。**不要跳步实现后续模块。**

## 8. 测试

项目不引入 jest/vitest，用 Node 内置能力自建极简断言工具，保持「零依赖」约束。

```bash
node tests/run-all.mjs        # 跑全部
node tests/snake.test.mjs     # 单独跑某个模块
```

- 每个 `*.test.mjs` 独立可执行，失败时以非零退出码结束。
- 测试文件通过 `import` 直接引用 `js/` 下的模块（Node ≥ 22 的 ESM 语法探测，无需 `package.json`）。
- 浏览器 API（`localStorage`、`AudioContext`）用内存假对象替换，只验证控制流与兜底路径；音色等感官效果需人工试听。
- **新增/修改领域逻辑时同步补测试**。编排层（`game.js`）的碰撞与计分规则必须覆盖。

## 9. 编码规范

- 文件命名 `kebab-case`（当前均为单词，无需分隔）；变量/函数 `camelCase`；常量 `UPPER_SNAKE_CASE`。
- 核心模块必须写 **JSDoc 类型注解**（`@param` / `@returns` / `@typedef`），坐标统一用 `@typedef {{x:number,y:number}} Point`。
- 注释说明**为什么**这么做，不复述代码行为。
- 单个函数建议 ≤ 40 行；纯函数优先，副作用集中在服务层。
- 不写调试 `console.log`；如临时需要，完成后必须清理。
- 修改流程：先读上下文 → 理解原有逻辑 → 局部修改，禁止大范围重写。

## 10. 验证清单

端到端（浏览器打开后逐项确认）：

- [ ] 首屏显示 READY 遮罩，按 Enter 开始
- [ ] 方向键 / WASD 四向移动，禁止 180° 掉头
- [ ] 快速连按两个方向不会自撞
- [ ] 吃到食物：蛇增长、加分、播放音效
- [ ] 每 5 个食物提速一级，HUD 速度数值同步更新
- [ ] 撞墙 / 撞自身 → GAME_OVER，显示本局分数与最高分
- [ ] 破纪录时高亮提示，刷新页面后最高分仍在（localStorage）
- [ ] 空格暂停/继续；`R` 随时重开；Enter 从结束态重开
- [ ] 静音开关生效且状态持久化
- [ ] 窗口缩放时 canvas 不变形，页面不因方向键滚动

## 11. 已知限制

- 因使用 ES Modules，**不能双击 index.html 直接运行**，必须走 HTTP 服务（见第 2 节）。
- 音效为 Web Audio 合成音，无音频文件；浏览器要求首次用户交互后才能发声。
- 不支持穿墙模式、多人对战、关卡地图等扩展玩法（如需再迭代）。
- 输入暂只支持键盘（方向键 / WASD / 空格 / Enter / R），未实现触屏手势或虚拟方向键。
