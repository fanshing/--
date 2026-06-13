# Operator Snap Game

本项目是一个最小可运行的双人联机小游戏：

- 后端：Node + Express + Socket.IO
- 前端：静态 `public` 页面（`index.html`, `client.js`；入口脚本为 `all.js`，用于兼容旧地址并减少缓存导致的旧代码问题）

运行：

```powershell
cd server
npm install
npm start
```

然后在浏览器打开 `http://localhost:3000`，用两个浏览器窗口或两台机器访问并分别输入昵称加入，同时开始抢干员。

## 图标（职业 / 干员）

### 职业图标

- 目录：`public/icons/classes/`
- 上传页：`http://localhost:3000/icon-upload.html`
- 状态接口：`GET /api/icons/status`

### 干员图标（本地）

本项目不会从网络自动抓取图片资源。若你有合法来源的干员头像/图标素材，可以用以下任一方式导入：

1) 批量上传（推荐）
- 打开：`http://localhost:3000/operator-icon-upload.html`
- 直接拖拽多张图片（PNG/WEBP/SVG）到页面。
- 要求：图片文件名（不含扩展名）等于干员名，例如 `能天使.png`。

2) 命令行批量导入
```powershell
node server/tools/import-operator-icons.js --src "你的图片目录"
```

### （可选）从 prts.wiki 生成“名字↔图标”并下载

如果你对这些图片拥有合法授权，并且允许从 prts.wiki 批量拉取（遵守对方条款/限流），可以使用脚本通过 MediaWiki API 自动搜索并下载：

```powershell
node server/tools/fetch-prts-operator-icons.js --limit 50
```

脚本会输出：
- 图片到 `public/icons/operators/`
- 对应关系到 `public/icons/operators-map.prts.json`

可用参数：
- `--dry-run` 只生成映射不下载
- `--delay 300` 每个请求之间延迟（毫秒），避免过快
- `--only "能天使"` 只处理单个干员
- `--only-file "e:/tmp/missing.txt"` 只处理名单文件中的干员（逐行一个名字，或 JSON 数组）
- `--overrides "server/tools/prts-operator-overrides.json"` 指定覆盖表（别名/页面/文件名），用于解决少量无法自动定位的干员
- `--stamp` 在 JSON 中写入生成时间（默认不写，保证文件稳定）
- `--retry-failed` 只重试上次失败的干员（需要已有 `public/icons/operators-map.prts.json`）
- `--force` 即使本地已存在也重新下载覆盖
- `--no-skip-existing` 不跳过已存在文件（默认会跳过，减少请求量）

#### 覆盖表（处理少量失败项）

当脚本对极少数名字（站内别名/标题不一致等）自动找不到头像时，可以编辑 `server/tools/prts-operator-overrides.json`：

- **字符串**：表示“别名”（会被当作一个额外的名字变体去尝试）
- **对象**（任选其一或组合）：
	- `alias`/`variants`：补充名字变体
	- `pageTitle`：指定 prts 的页面标题（脚本会从该页面的 images 列表里挑选头像文件）
	- `fileTitle`：指定完整文件标题，例如 `File:头像_安赛尔.png`
	- `fileBase`：指定不带扩展名的文件标题，例如 `头像_安赛尔`（脚本会尝试 .png/.webp/.svg）

填好后运行：

```powershell
node server/tools/fetch-prts-operator-icons.js --retry-failed --delay 200
```

导入后文件会写入：`public/icons/operators/`（默认文件名为干员名；若名字包含 Windows 不允许的字符会自动转为 URL 编码/替换）。

前端显示规则：
- **已知干员名**：优先显示本地干员图标；找不到则回退为职业图标。
- **未知干员（仅知道职业）**：显示职业图标。

多对局 / 选房间：

- 大厅会显示对局列表（如 `room-1`、`room-2`）。
- 可点击“新建对局”创建新房间。
- 加入/观战都需要先在下拉框选择目标对局。

观战：

- 观战需要显式点击“观战”（不占用玩家名额、不参与出价/结束/继续等操作，只同步观看对局）。
- 若选择“加入(玩家)”但该对局已满，会提示加入失败；可改为观战或新建对局。

掉线继承：

- 若对局进行中有一名玩家中途断开连接，其调用点、分数、已抓干员等数据会被暂存。
- 当房间里只剩 1 名玩家时，下一位加入者：
	- **仅当其昵称（原始昵称）与掉线者一致** 才会继承该玩家数据并继续对局。
	- 若昵称不一致，则视为新玩家加入，不继承属性（并清理掉线占位的回合状态残留）。

规则备注：

- 情报点用于“查看(peak)”当前干员的星级/分支（不会揭示名字）。
- 点击“结束”：本回合出价视为 0 并照常结算；但若该回合有人点击了“结束”，则该回合不会因为平局/双休息等原因把“当前干员及其分支”从池中移出（下一回合开始再进入结束态规则）。
- 彩蛋：若有玩家使用昵称“周防有希”加入对局，其在局内显示名会变为“星”。当该玩家在本回合抓到干员，且本回合双方都没有使用情报点（无人点击查看/peek），则该次抓取会把该干员替换为“相同分支”的一名 6★ 干员（随机）；若该分支没有 6★ 则不替换。
