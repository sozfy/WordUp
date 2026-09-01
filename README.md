# 📖 背单词（Word Memorizer）

一个纯前端、本地化的英语背单词 + 离线词典查询工具。所有数据保存在浏览器本地（IndexedDB / localStorage），无需联网、无需服务器。

## ✨ 功能特性

- **背单词**：批量添加单词、按词表随机抽背，认识/不认识分类记忆，支持选择题模式
- **单词列表管理**：多个独立词表，可新增/删除/改名/查看，可切换词表进行随机抽词
- **预设词表**：内置中考、高考、四六级、考研、雅思、托福、GRE 词表（基于 ECDICT 词库 tag 预生成）
- **查单词**：基于 ECDICT 词库的离线词典查询，支持输入联想（按词频排序）、模糊匹配
- **词条详情**：音标、词性、中英释义、时态变化、考试标签一目了然
- **本地存储**：词表、单词与词典数据均存 IndexedDB，少量设置项存 localStorage，隐私安全
- **双端适配**：响应式布局，手机、平板与电脑均可流畅使用，移动端优化触摸热区与键盘体验

## 🗂 目录结构

```
背单词-GitHub/
├── index.html              # 入口主页
├── WordMemorizer.html      # 背单词页
├── DictLookup.html         # 查单词页
├── css/
│   └── style.css           # 全局样式
├── js/
│   ├── common.js           # 共享逻辑（词典加载、自动导入、存储用量）
│   ├── script.js           # 背单词页逻辑
│   ├── dict.js             # 查单词页逻辑
│   └── generate_preset.js  # 预设词表生成脚本（Node.js）
├── data/
│   ├── preset_data.js      # 预设词表汇总入口（已提交）
│   ├── preset_<tag>.js      # 8 套预设词表，按 tag 拆分（zk/gk/cet4/cet6/ky/ielts/toefl/gre）
│   └── ecdict.csv          # ECDICT 词典（见下方说明，未纳入版本控制）
├── README.md
├── LICENSE
└── .gitignore
```

## 🚀 使用说明

### 方式一：本地直接打开

直接双击打开 `index.html` 即可使用（推荐用本地 HTTP 服务器以获得最佳体验）：

```bash
# 在项目根目录启动本地服务器
python -m http.server 8000
# 然后访问 http://localhost:8000
```

### 方式二：部署到 GitHub Pages

1. 将本仓库 fork / push 到你的 GitHub 账号
2. 进入仓库 Settings → Pages → 选择分支发布
3. 访问 `https://<你的用户名>.github.io/<仓库名>/`

### 词典数据（ecdict.csv）

`ecdict.csv` 为 ECDICT 词库（约 63MB），超过 GitHub 单文件上传限制，**不随仓库分发**。首次打开任意页面时（例如查单词页），应用会自动从 ECDICT GitHub 仓库**在线获取**并导入到浏览器 IndexedDB（约 1-3 分钟，有进度提示）。

词典获取优先级：

1. 本地 `data/ecdict.csv`（如你自行放置）
2. [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT) 仓库在线下载
   `https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv`

> 未放置本地 ecdict.csv 或网络不可用时，**背单词**功能（基于预生成的 preset_data.js）仍可正常使用；查单词需在联网状态下完成首次导入。

## 🛠 预设词表重新生成

预设词表已预生成并提交。如需基于新版 ecdict.csv 重新生成：

```bash
cd js
node generate_preset.js
```

脚本读取 `data/ecdict.csv`，按 tag 分类生成 `data/preset_<tag>.js`（每个词表一个文件）及汇总入口 `data/preset_data.js`。

## 📊 数据来源

- 词典数据：[ECDICT](https://github.com/skywind3000/ECDICT)（MIT License，免费开源英汉词典）
- 本项目为 ECDICT 的本地化应用封装

## 📄 License

[MIT](LICENSE)
