# 职业图标放置说明

把职业图标文件放到本目录，文件名使用职业中文名：

- `先锋.svg`（推荐 SVG，白色图形、透明背景）
- `近卫.svg`
- `重装.svg`
- `狙击.svg`
- `术师.svg`
- `医疗.svg`
- `辅助.svg`
- `特种.svg`

前端会按职业字段 `class` 自动加载：

- 优先尝试 `/icons/classes/<职业>.svg`
- 如果 svg 不存在，再尝试 `/icons/classes/<职业>.png`
- 两者都不存在时，回退到内置的简易 SVG 图标

## 导入助手（推荐）

打开 `/icon-import.html`（例如本地：http://localhost:3000/icon-import.html），把图片拖进去后下载为正确文件名，然后放回本目录即可。

## 直接上传写入项目（最省事）

打开 `/icon-upload.html`（例如本地：http://localhost:3000/icon-upload.html），对每个职业选择图片后点“上传到项目”。

服务端会自动写入本目录下的文件（优先写入你上传的格式）：

- `先锋.(png|webp|svg)`
- `近卫.(png|webp|svg)`
- `重装.(png|webp|svg)`
- `狙击.(png|webp|svg)`
- `术师.(png|webp|svg)`
- `医疗.(png|webp|svg)`
- `辅助.(png|webp|svg)`
- `特种.(png|webp|svg)`

上传完回到游戏页面刷新（必要时 Ctrl+F5）。

### 排错

- 如果页面仍显示占位图标：先确认本目录里确实出现了上述文件
- 如果上传页面提示接口失败：确认服务端是从 `server/index.js` 启动的，并且端口与页面一致

如果你有“完全一致”的那套图标（并且你拥有使用权/授权），直接把对应文件放进来即可生效。
