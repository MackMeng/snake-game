# 贪吃蛇

原生 HTML5 Canvas 实现的贪吃蛇小游戏，**零依赖、零构建**——没有 npm 包、没有打包器，浏览器直接运行。

## 本地运行

项目使用 ES Modules，`file://` 协议会被浏览器的 CORS 策略拦截，必须通过 HTTP 服务打开：

```bash
python -m http.server 8000
```

然后访问 <http://localhost:8000>。

备选：`npx serve .`，或 VS Code 的 Live Server 插件。

## 玩法

| 操作 | 按键 |
|------|------|
| 移动 | 方向键 / `W` `A` `S` `D` |
| 暂停 / 继续 | `空格` / `P` |
| 开始 / 从结束态重开 | `Enter` |
| 随时重开 | `R` |

- 吃到食物 `+10` 分，每吃 5 个提升一级，移动速度加快。
- 撞墙或撞到自身即结束；棋盘被蛇填满则通关。
- 最高分与静音设置保存在 `localStorage`。

## 功能

- Canvas 网格渲染：蛇身蓝→青绿 HSL 渐变、蛇头朝向眼睛、食物呼吸式发光
- 难度递增：移动间隔随等级缩短，设下限保证可玩性
- 状态机：`READY` / `PLAYING` / `PAUSED` / `GAME_OVER`
- 切到后台自动暂停，避免回来时蛇已撞墙
- Web Audio 实时合成音效，无音频文件
- 方向输入队列 + 180° 掉头拦截，快速连按不会自撞
- 最高分持久化与破纪录高亮

## 架构

依赖方向单向，领域层不触碰任何浏览器 API：

```
        表现层 renderer.js
              ↑ (只读数据)
服务层 input/audio/storage → 编排层 game.js → 入口 main.js
              ↓
        领域层 snake.js / food.js
        配置层 config.js  ← 所有层都可引用
```

```
.
├── index.html          # HUD + canvas + 遮罩层
├── css/style.css       # 主题变量与布局
├── js/
│   ├── config.js       # 全部常量（唯一配置来源）
│   ├── storage.js      # localStorage 封装
│   ├── audio.js        # Web Audio 音效合成
│   ├── input.js        # 键盘输入 → 语义化指令
│   ├── snake.js        # 蛇实体（纯逻辑）
│   ├── food.js         # 食物生成（纯逻辑）
│   ├── renderer.js     # Canvas 绘制
│   ├── game.js         # 状态机 + 主循环 + 规则判定
│   └── main.js         # 装配与启动
└── tests/              # 零依赖测试
```

## 测试

测试同样零依赖，用 Node 内置能力实现：

```bash
node tests/run-all.mjs        # 运行全部
node tests/game.test.mjs      # 单独运行某个模块
```

需要 Node ≥ 22（依赖其 ESM 语法探测，无需 `package.json`）。

测试覆盖领域逻辑、编排规则与浏览器 API 的控制流；音色与像素观感需人工确认。

## 调参

游戏平衡性集中在 [`js/config.js`](js/config.js)：

- `INITIAL_STEP_MS` — 初始移动间隔（毫秒）
- `SPEED_STEP_MS` — 每升一级缩短的间隔
- `MIN_STEP_MS` — 速度下限
- `FOODS_PER_LEVEL` — 每吃多少个食物升一级
- `SCORE_PER_FOOD` — 每个食物分值

## 已知限制

- 必须通过 HTTP 服务运行，不能双击 `index.html`
- 仅支持键盘操作，未实现触屏手势或虚拟方向键
- 不支持穿墙模式、多人对战等扩展玩法

## 许可证

[MIT](LICENSE)
