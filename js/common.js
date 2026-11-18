// ========== 共享功能 ==========
// 职责：所有页面共享的基础能力（index / WordMemorizer / DictLookup / MyLists 均引用）
//   - 词典目录 DICT_CATALOG 与词典导入（按词典独立存 IndexedDB：WordMemorizerDict_<id>）
//   - 词表数据持久化（IndexedDB：WordMemorizerData/wordData，key='main'，保存时剥离 meaning）
//   - 通用工具：HTML 转义 / 换行处理 / CSV 解析 / 词表工厂 / 重命名 / 单词输入解析
//   - 通用 UI：对话框（showDialog/showConfirm/showPrompt）、提示（showToast）
//   - 存储用量统计、清除缓存（clearAllCache）
// 说明：本文件被四个页面共用，改动需兼顾全部页面（尤其是 WordMemorizer / MyLists 的词表结构）。

// ---------- 常量映射 ----------
const TAG_LABEL_MAP = {
    'zk': '中考',
    'gk': '高考',
    'cet4': '大学英语四级',
    'cet6': '大学英语六级',
    'ky': '考研',
    'ielts': '雅思',
    'toefl': '托福',
    'gre': '美国研究生入学考试'
};

const EXCHANGE_LABEL_MAP = {
    'p': '过去式',
    'd': '过去分词',
    'i': '现在分词',
    'r': '形容词比较级',
    't': '形容词最高级',
    's': '名词复数形式',
    '3': '第三人称单数',
    '0': 'Lemma',
    '1': 'Lemma 的变换形式'
};

// ---------- 工具函数 ----------
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 格式化时态变化：按 / 分割，行首类型替换为中文标签
function formatExchange(exchange) {
    if (!exchange) return '';
    return exchange.split('/').map(part => {
        const idx = part.indexOf(':');
        if (idx === -1) return escapeHtml(part);
        const type = part.substring(0, idx).trim();
        const value = part.substring(idx + 1).trim();
        const label = EXCHANGE_LABEL_MAP[type] || type;
        return label + '：' + escapeHtml(value);
    }).join('\n');
}

// 格式化 tag：替换为中文全称
function formatTags(tagStr) {
    if (!tagStr) return [];
    return tagStr.split(/\s+/).filter(t => t).map(t => {
        return { key: t, label: TAG_LABEL_MAP[t] || t };
    });
}

// 将字面量 \n（反斜杠+n）替换为真实换行符（ECDICT 词典中用字面量 \n 表示换行）
function normalizeNewlines(text) {
    if (!text) return '';
    return String(text).replace(/\\n/g, '\n');
}

// 将所有换行（字面量 \n 和真实 \n）替换为空格并压缩，用于单行显示场景（如选择题选项）
function flattenNewlines(text) {
    if (!text) return '';
    return String(text).replace(/\\n/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

// 解析带引号字段的分隔文本（CSV / TSV），支持字段内换行与转义引号 ""
// delimiter 省略时按逗号解析；onProgress(ratio) 用于大文件解析进度（每约 50 万字符回调一次）
function parseCSV(text, onProgress, delimiter) {
    const sep = delimiter || ',';
    const rows = [];
    let cur = [];
    let field = '';
    let inQuotes = false;
    const total = text.length || 1;
    const step = 500000;
    let nextAt = step;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === sep) {
            cur.push(field); field = '';
        } else if (ch === '\n') {
            cur.push(field); rows.push(cur); cur = []; field = '';
        } else if (ch !== '\r') {
            field += ch;
        }
        if (onProgress && i >= nextAt) {
            nextAt += step;
            onProgress(i / total);
        }
    }
    if (field !== '' || cur.length > 0) { cur.push(field); rows.push(cur); }
    return rows;
}

// 按首行内容猜测分隔符（Excel 另存的 .txt/.tsv 为制表符分隔）
function guessDelimiter(text) {
    const nl = text.search(/\r\n|\r|\n/);
    const head = nl === -1 ? text : text.slice(0, nl);
    return head.indexOf('\t') >= 0 ? '\t' : ',';
}

// 解析用户导入的纯文本表格（自动识别 CSV / TSV）
function parseDelimitedText(text) {
    return parseCSV(text, null, guessDelimiter(text));
}

// ---------- 词表结构 ----------
// 所有词表统一由 makeList 创建，避免各处以不同字段名/字段集合手工拼装
function genListId() {
    return 'list_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

// 创建词表对象；words 与 pendingWords 共享同一批单词对象引用（meaning 只算/存一份）
function makeList(name, words) {
    const listWords = words || [];
    return {
        id: genListId(),
        name: name,
        words: listWords,
        pendingWords: listWords.slice(),
        selectedWord: null,
        queueWords: [],
        roundKnown: [],
        roundUnknown: [],
        lastJudged: null,
        lastJudgedWord: null
    };
}

// 在给定词表集合内生成不重名名称：已存在则加序号（中考、中考1、中考2...）
// excludeId：改名场景下排除自身，避免改回原名被误判重名
function uniqueListNameIn(baseName, lists, excludeId) {
    const used = new Set((lists || []).filter(l => l.id !== excludeId).map(l => l.name));
    if (!used.has(baseName)) return baseName;
    let seq = 1;
    while (used.has(baseName + seq)) seq++;
    return baseName + seq;
}

// 在背单词词表（main）内生成不重名名称
function uniqueListName(baseName, excludeId) {
    const data = getWordData();
    return uniqueListNameIn(baseName, data ? data.lists : [], excludeId);
}

// 解析“每行一个单词、可用 word#释义 指定自定义意思”的输入文本
function parseWordInput(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l)
        .map(line => {
            const idx = line.indexOf('#');
            if (idx > 0) {
                return { word: line.slice(0, idx).trim(), custom: line.slice(idx + 1).trim() };
            }
            return { word: line, custom: '' };
        })
        .filter(p => p.word);
}

// 将解析结果转为单词对象：有自定义释义直接使用，其余查词典
// 返回 { words, failed, dictMissing }；dictMissing 表示需要查词但词典尚未下载
async function buildWordObjects(parsed, dictId) {
    const needLookup = parsed.filter(p => !p.custom);
    let entries = new Map();
    if (needLookup.length > 0) {
        const loaded = await isDictLoaded(dictId);
        if (!loaded) {
            return { words: [], failed: needLookup.map(p => p.word), dictMissing: true };
        }
        entries = await lookupWords(needLookup.map(p => p.word), dictId);
    }
    const words = [];
    const failed = [];
    parsed.forEach(p => {
        if (p.custom) {
            const custom = normalizeNewlines(p.custom);
            words.push({ word: p.word, mnemonic: null, customMeaning: custom, meaning: custom });
            return;
        }
        const entry = entries.get(p.word.toLowerCase());
        if (!entry) { failed.push(p.word); return; }
        words.push({
            word: entry.word,
            mnemonic: null,
            phonetic: entry.phonetic || '',
            meaning: normalizeNewlines(entry.translation || entry.definition || '(无释义)')
        });
    });
    return { words, failed, dictMissing: false };
}

// 为缺少释义的单词补查词典（原地写入 meaning），返回同一个数组
async function fillMissingMeanings(items, dictId) {
    const missing = (items || []).filter(item => item && !item.meaning && !item.customMeaning);
    if (missing.length === 0) return items;
    let entries = new Map();
    try { entries = await lookupWords(missing.map(item => item.word), dictId); } catch (e) { /* 查不到按无释义处理 */ }
    missing.forEach(item => {
        const e = entries.get(String(item.word).toLowerCase());
        item.meaning = e ? normalizeNewlines(e.translation || e.definition || '(无释义)') : '(无释义)';
    });
    return items;
}

// ---------- localStorage 读写（统一 try/catch，避免各处重复包裹） ----------
function getStoredFlag(key, defaultValue) {
    try {
        const v = localStorage.getItem(key);
        return v === null ? !!defaultValue : v === '1';
    } catch (e) {
        return !!defaultValue;
    }
}
function setStoredFlag(key, on) {
    try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) { /* 隐私模式等场景忽略 */ }
}
function getStoredInt(key, min, max, defaultValue) {
    try {
        const v = parseInt(localStorage.getItem(key), 10);
        if (Number.isFinite(v) && v >= min && v <= max) return v;
    } catch (e) { /* 忽略 */ }
    return defaultValue;
}
// 通用 localStorage 字符串写入（设置项保存）
function setStored(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 忽略 */ }
}

// ---------- 词典目录与 IndexedDB ----------
const DICT_DB_PREFIX = 'WordMemorizerDict_';
const DICT_STORE_WORDS = 'words';
const DICT_DB_VERSION = 1;

// 词典目录：在此扩展多本词典（id 唯一；urls 为下载源，按顺序尝试；expectedCount 用于状态显示）
// 每本词典独立数据库：WordMemorizerDict_<id>
const DICT_CATALOG = [
    {
        id: 'ecdict',
        name: 'ECDICT 英汉词典',
        desc: 'ECDICT 开源英汉词典：音标 / 释义 / 词性 / 词频 / 同根词等',
        expectedCount: '770,611',
        // 该词典可用的预设词表 tag（见 data/preset_*.js）
        presets: ['zk', 'gk', 'cet4', 'cet6', 'ky', 'ielts', 'toefl', 'gre'],
        urls: [
            'data/ecdict.csv',
            'https://ghproxy.net/https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
            'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv'
        ]
    }
];

function getDictById(id) {
    return DICT_CATALOG.find(d => d.id === id) || DICT_CATALOG[0];
}
function dictDBName(id) {
    return DICT_DB_PREFIX + id;
}

// 已打开的数据库连接缓存：key = name@version
// 避免每次查词/读写都重新 open（open 是异步且有明显开销，查询联想时尤为敏感）
const _dbCache = new Map();

// 通用打开数据库：若浏览器中残留更高版本的旧库（VersionError），视为无旧版，删除后按当前版本重建
function openIndexedDB(name, version, onUpgrade) {
    const cacheKey = name + '@' + version;
    const cached = _dbCache.get(cacheKey);
    if (cached) return cached;

    const promise = new Promise((resolve, reject) => {
        const attempt = () => {
            let req;
            try {
                req = indexedDB.open(name, version);
            } catch (e) {
                reject(e);
                return;
            }
            req.onupgradeneeded = (e) => { if (onUpgrade) onUpgrade(e.target.result); };
            req.onsuccess = (e) => {
                const db = e.target.result;
                // 其他标签页升级或删除本库时主动断开，避免 deleteDatabase 被阻塞
                db.onversionchange = () => {
                    db.close();
                    _dbCache.delete(cacheKey);
                };
                resolve(db);
            };
            req.onerror = (e) => {
                const err = e.target.error;
                if (err && err.name === 'VersionError') {
                    const del = indexedDB.deleteDatabase(name);
                    del.onsuccess = () => attempt();
                    del.onerror = () => reject(del.error || new Error('无法删除旧版本数据库 ' + name));
                    del.onblocked = () => reject(new Error('旧版本数据库 ' + name + ' 删除被阻塞'));
                } else {
                    reject(err);
                }
            };
        };
        attempt();
    });

    _dbCache.set(cacheKey, promise);
    promise.catch(() => _dbCache.delete(cacheKey));
    return promise;
}

// 关闭并移除指定名称的数据库连接（删除数据库前必须调用，否则会一直阻塞）
async function closeDB(name) {
    const keys = Array.from(_dbCache.keys()).filter(k => k.indexOf(name + '@') === 0);
    for (const key of keys) {
        const pending = _dbCache.get(key);
        _dbCache.delete(key);
        try {
            const db = await pending;
            if (db) db.close();
        } catch (e) { /* 连接本就失败，忽略 */ }
    }
}

async function closeAllDBs() {
    const keys = Array.from(_dbCache.keys());
    for (const key of keys) {
        const pending = _dbCache.get(key);
        _dbCache.delete(key);
        try {
            const db = await pending;
            if (db) db.close();
        } catch (e) { /* 忽略 */ }
    }
}

// 打开指定词典数据库（默认 ecdict）
function openDictDB(id) {
    const name = dictDBName(id || 'ecdict');
    return openIndexedDB(name, DICT_DB_VERSION, (db) => {
        if (!db.objectStoreNames.contains(DICT_STORE_WORDS)) {
            db.createObjectStore(DICT_STORE_WORDS, { keyPath: 'word' });
        }
    });
}

// 从 IndexedDB 查询词条，兼容大小写：IndexedDB 主键是词条原文大小写，
// 先按小写查，未命中再按原文查（如 CD 的 key 是 "CD"，输入 "cd" 也能查到）
function idbGetDictEntry(store, word) {
    const lower = word.toLowerCase();
    return new Promise((resolve) => {
        const req = store.get(lower);
        req.onsuccess = () => {
            if (req.result) { resolve(req.result); return; }
            if (lower !== word) {
                const req2 = store.get(word);
                req2.onsuccess = () => resolve(req2.result || null);
                req2.onerror = () => resolve(null);
            } else {
                resolve(null);
            }
        };
        req.onerror = () => resolve(null);
    });
}

// 查询单个单词（直接读 IndexedDB，不加载全量到内存）
async function lookupWord(word, id) {
    if (!word) return null;
    try {
        const db = await openDictDB(id);
        const tx = db.transaction(DICT_STORE_WORDS, 'readonly');
        return await idbGetDictEntry(tx.objectStore(DICT_STORE_WORDS), word);
    } catch (err) {
        return null;
    }
}

// 批量查询单词（共用一个只读事务）
async function lookupWords(wordList, id) {
    const result = new Map();
    if (!wordList || wordList.length === 0) return result;
    try {
        const db = await openDictDB(id);
        const tx = db.transaction(DICT_STORE_WORDS, 'readonly');
        const store = tx.objectStore(DICT_STORE_WORDS);
        const entries = await Promise.all(wordList.map(w => idbGetDictEntry(store, w)));
        wordList.forEach((w, i) => {
            if (entries[i]) result.set(w.toLowerCase(), entries[i]);
        });
    } catch (e) { /* 数据库不可用时按未命中处理 */ }
    return result;
}

// 统计词典词条总数（直接读 IndexedDB）
async function countDictEntries(id) {
    try {
        const db = await openDictDB(id);
        return await new Promise((resolve) => {
            const tx = db.transaction(DICT_STORE_WORDS, 'readonly');
            const req = tx.objectStore(DICT_STORE_WORDS).count();
            req.onsuccess = () => resolve(req.result || 0);
            req.onerror = () => resolve(0);
        });
    } catch (e) {
        return 0;
    }
}

// 检查单词是否已导入（复用 countDictEntries，避免重复实现计数查询）
async function isDictLoaded(id) {
    return (await countDictEntries(id)) > 0;
}

// 清空指定词典的全部词条（重新下载 / 导入失败回滚时使用）
async function clearDictStore(id) {
    const db = await openDictDB(id);
    await new Promise((resolve, reject) => {
        const tx = db.transaction(DICT_STORE_WORDS, 'readwrite');
        tx.objectStore(DICT_STORE_WORDS).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error || new Error('清空词典失败'));
    });
}

// 前缀模糊查询：直接从 IndexedDB 游标扫描前缀区间，
// 按词频排序（frq 数值小=词频高优先），跳过词频 <=0 的条目
async function searchDictPrefix(prefix, limit, id) {
    if (!prefix) return [];
    const max = limit || 10;
    try {
        const db = await openDictDB(id);
        const tx = db.transaction(DICT_STORE_WORDS, 'readonly');
        const store = tx.objectStore(DICT_STORE_WORDS);
        const range = IDBKeyRange.bound(prefix, prefix + '\uffff', false, false);
        const matches = [];
        await new Promise((resolve, reject) => {
            const req = store.openCursor(range);
            req.onsuccess = (e) => {
                const cur = e.target.result;
                if (!cur) { resolve(); return; }
                const key = String(cur.key);
                const frq = parseInt(cur.value.frq, 10) || 0;
                if (key !== prefix && frq > 0) matches.push({ entry: cur.value, frq });
                cur.continue();
            };
            req.onerror = () => reject(req.error);
        });
        // 只保留词频最高的 max 个候选，避免对整段前缀结果全量排序
        matches.sort((a, b) => a.frq - b.frq);
        if (matches.length > max) matches.length = max;
        return matches.map(x => x.entry);
    } catch (e) {
        return [];
    }
}

// ---------- 词表存储核心（词表/单词持久化，各页面共享） ----------
let _wordDataCache = null;
const WORD_DB_NAME = 'WordMemorizerData';
const WORD_DB_STORE = 'wordData';
const WORD_DB_VERSION = 1;
const WORD_DB_KEY = 'main';
// 「我的词典-词表」独立存储 key：与背单词词表（main）彻底分开
const WORD_DB_KEY_SAVED = 'savedLists';

function openWordDB() {
    return openIndexedDB(WORD_DB_NAME, WORD_DB_VERSION, (db) => {
        if (!db.objectStoreNames.contains(WORD_DB_STORE)) {
            db.createObjectStore(WORD_DB_STORE); // 无 keyPath，用 put(value, key)
        }
    });
}

// 通用读取 / 写入（key 区分 main / savedLists）
async function idbGetValue(key) {
    try {
        const db = await openWordDB();
        return await new Promise((resolve) => {
            const tx = db.transaction(WORD_DB_STORE, 'readonly');
            const req = tx.objectStore(WORD_DB_STORE).get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch (e) {
        return null;
    }
}

async function idbPutValue(key, data) {
    try {
        const db = await openWordDB();
        return await new Promise((resolve) => {
            const tx = db.transaction(WORD_DB_STORE, 'readwrite');
            const req = tx.objectStore(WORD_DB_STORE).put(data, key);
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
        });
    } catch (e) {
        return false;
    }
}

// 将要落盘的词表数据转为纯存储对象：一次性剥离运行时 meaning（不写入 IndexedDB）
// 用 JSON replacer 代替“深拷贝后再逐个 delete”，少一次全量遍历
function toStorable(data) {
    return JSON.parse(JSON.stringify(data, (key, value) => (key === 'meaning' ? undefined : value)));
}

// 读取单词数据（仅从 IndexedDB 读取）
function loadWordData() {
    return idbGetValue(WORD_DB_KEY);
}

// 写入 IndexedDB（传入的 data 已剥离 meaning）
function writeWordData(data) {
    return idbPutValue(WORD_DB_KEY, data);
}

// 初始化词表内存缓存（无数据则创建默认词表）
async function initWordDataCache() {
    if (_wordDataCache) return _wordDataCache;
    _wordDataCache = await loadWordData();
    if (!_wordDataCache) {
        const defaultList = makeList('默认词表');
        _wordDataCache = { activeListId: defaultList.id, lists: [defaultList] };
        saveWordData(_wordDataCache);
    } else {
        await migrateSavedLists(); // 旧版 savedToDict 词表迁移到独立 key
    }
    return _wordDataCache;
}

// 旧数据迁移：把 main 里标记 savedToDict 的词表搬到独立 key「savedLists」，并从背单词词表中移除
async function migrateSavedLists() {
    const data = _wordDataCache;
    if (!data || !Array.isArray(data.lists)) return;
    const saved = data.lists.filter(l => l.savedToDict);
    if (saved.length === 0) return;

    const savedData = (await loadSavedListsData()) || { lists: [] };
    if (!Array.isArray(savedData.lists)) savedData.lists = [];
    const existingIds = new Set(savedData.lists.map(l => l.id));
    saved.forEach(l => {
        if (!existingIds.has(l.id)) {
            delete l.savedToDict; // 副本不再需要标记
            savedData.lists.push(l);
        }
    });
    await writeSavedListsData(toStorable(savedData));

    // 从 main 移除 savedToDict 词表；若全部移空则生成默认词表
    const rest = data.lists.filter(l => !l.savedToDict);
    data.lists = rest.length > 0 ? rest : [makeList('默认词表')];
    if (!data.lists.some(l => l.id === data.activeListId)) data.activeListId = data.lists[0].id;
    await writeWordData(toStorable(data));
}

// ---------- 「我的词典-词表」独立存储（key = savedLists，与背单词词表互不影响） ----------
let _savedListsCache = null;

// 读取「我的词典」词表数据
function loadSavedListsData() {
    return idbGetValue(WORD_DB_KEY_SAVED);
}

// 写入「我的词典」词表数据（key = savedLists）
function writeSavedListsData(data) {
    return idbPutValue(WORD_DB_KEY_SAVED, data);
}

// 初始化「我的词典」词表内存缓存（无数据则为空数组）
async function initSavedListsCache() {
    if (_savedListsCache) return _savedListsCache;
    _savedListsCache = await loadSavedListsData();
    if (!_savedListsCache) {
        _savedListsCache = { lists: [] };
        writeSavedListsData(toStorable(_savedListsCache));
    }
    return _savedListsCache;
}

function getSavedListsData() {
    return _savedListsCache || { lists: [] };
}

// 保存「我的词典」词表（剥离 meaning 后写入独立 key）
function saveSavedListsData(data) {
    _savedListsCache = data;
    writeSavedListsData(toStorable(data));
}

function getWordData() {
    return _wordDataCache;
}

function saveWordData(data) {
    _wordDataCache = data;
    writeWordData(toStorable(data)); // 写入 IndexedDB
}

function getActiveList(data) {
    const d = data || getWordData();
    if (!d || !Array.isArray(d.lists) || d.lists.length === 0) return null;
    return d.lists.find(l => l.id === d.activeListId) || d.lists[0];
}

// ---------- 页面加载遮罩 ----------
// 页面数据初始化完成后调用 hideLoading() 隐藏；window load 事件兜底（防初始化异常卡住页面）
function hideLoading() {
    const el = document.getElementById('loadingOverlay');
    if (el) el.style.display = 'none';
}
window.addEventListener('load', () => {
    hideLoading();
});

// ---------- 预设词表（从 preset_data.js 静态加载，window.PRESET_LISTS） ----------
function getPresetListByTag(tag) {
    if (!window.PRESET_LISTS) return null;
    return window.PRESET_LISTS.find(l => l.tag === tag) || null;
}

// ---------- localStorage 存储用量显示 ----------
function getLocalStorageUsage() {
    let total = 0;
    for (let key in localStorage) {
        if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
            total += (localStorage[key].length + key.length) * 2; // UTF-16 每字符2字节
        }
    }
    return total;
}

// 存储用量显示：localStorage 已用 + IndexedDB 已用 + 剩余空间
// IndexedDB 用量 ≈ 浏览器总用量(navigator.storage.estimate) − localStorage 用量
async function updateMemUsage() {
    const el = document.getElementById('memUsage');
    if (!el || document.hidden) return; // 页面不可见时不统计（定时器仍会继续）
    const lsUsed = getLocalStorageUsage();
    const lsMB = (lsUsed / 1048576).toFixed(2);
    let idbMB = '0.00';
    let remainMB = '--';
    try {
        if (navigator.storage && typeof navigator.storage.estimate === 'function') {
            const est = await navigator.storage.estimate();
            if (est && typeof est.usage === 'number' && typeof est.quota === 'number') {
                const idbUsed = Math.max(0, est.usage - lsUsed); // IndexedDB ≈ 总量 - localStorage
                idbMB = (idbUsed / 1048576).toFixed(2);
                remainMB = (Math.max(0, est.quota - est.usage) / 1048576).toFixed(2);
            }
        }
    } catch (e) { /* 统计失败则忽略 */ }
    // 分两行显示：第一行 localStorage，第二行 IndexedDB + 剩余空间
    el.innerHTML = '本地 ' + lsMB + 'MB<br>IndexedDB ' + idbMB + 'MB · 剩 ' + remainMB + 'MB';
    el.title = 'localStorage 已用 ' + lsMB + 'MB；IndexedDB 已用 ' + idbMB + 'MB；剩余 ' + remainMB + 'MB（来源：navigator.storage.estimate）';
}

// ---------- 词典导入提示与进度条 ----------
function showImportHint(text, pct) {
    let el = document.getElementById('autoImportHint');
    if (!el) {
        el = document.createElement('div');
        el.id = 'autoImportHint';
        el.style.cssText = 'position:fixed;top:76px;left:50%;transform:translateX(-50%);z-index:9999;background:#3a3c44;border:1px solid #5a5c66;color:#fff;padding:10px 18px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.4);min-width:280px;text-align:center;font-size:14px;';
        const txt = document.createElement('div');
        txt.id = 'autoImportHintText';
        const bar = document.createElement('div');
        bar.id = 'autoImportBar';
        bar.style.cssText = 'margin-top:8px;height:8px;background:#555760;border-radius:4px;overflow:hidden;';
        const fill = document.createElement('div');
        fill.id = 'autoImportBarFill';
        fill.style.cssText = 'height:100%;width:0;background:linear-gradient(90deg,#4c8dff,#6aa8ff);border-radius:4px;transition:width .25s;';
        bar.appendChild(fill);
        el.appendChild(txt);
        el.appendChild(bar);
        document.body.appendChild(el);
    }
    const txt = document.getElementById('autoImportHintText');
    if (txt) txt.textContent = text;
    if (typeof pct === 'number') {
        const fill = document.getElementById('autoImportBarFill');
        if (fill) fill.style.width = Math.max(0, Math.min(100, Math.round(pct))) + '%';
    }
}
function hideImportHint() {
    const el = document.getElementById('autoImportHint');
    if (el) el.remove();
}

// 下载并导入词典 CSV（含下载速度、解析/存储进度）
// 下载超时策略：获取响应头 60 秒绝对超时；流式读取 30 秒无新数据视为断流（停滞超时）
// 慢但持续传输不会误杀，真正挂起/断流才会中止，避免永久卡在下载界面
async function autoImportDictFromCSV(id) {
    if (window.dictAutoImporting) return;
    const dict = getDictById(id || 'ecdict');
    if (await isDictLoaded(dict.id)) return;

    window.dictAutoImporting = true;
    showImportHint('正在下载词典 0% ...', 0);
    try {
        // 词典来源（按目录配置顺序尝试）：本地文件 → 加速代理 → GitHub 直连
        let resp = null;
        let activeCtrl = null;
        for (const url of dict.urls) {
            const ctrl = new AbortController();
            const t1 = setTimeout(() => ctrl.abort(), 60000); // 获取响应头：60 秒绝对超时
            try {
                const r = await fetch(url, { signal: ctrl.signal });
                clearTimeout(t1);
                if (r.ok) { resp = r; activeCtrl = ctrl; break; }
                console.warn('词典源不可用（HTTP ' + r.status + '）：' + url);
            } catch (e) {
                clearTimeout(t1);
                console.warn('词典源不可用：' + url, e);
            }
        }
        if (!resp) {
            hideImportHint();
            showToast('词典下载失败：无法获取词典文件，请检查网络后重试', 'error');
            return;
        }

        // 流式读取并实时显示下载进度与速度
        let text;
        if (resp.body && resp.body.getReader) {
            const contentLength = parseInt(resp.headers.get('content-length'), 10) || 0;
            // 头部 content-length 在压缩传输（content-encoding: gzip 等）下是“压缩后”长度，
            // 而 reader 返回的是浏览器自动解压后的字节：一旦解压字节超过头部长度，就判定该长度不可信，
            // 改用“已接收 x MB”推进进度，避免原文只下到几分之一就显示 100% 却还在传
            let lengthTrusted = contentLength > 0;
            let revealFrom = 0; // 切换到“按已接收量推进”时的起始字节
            const reader = resp.body.getReader();
            const chunks = [];
            let received = 0;
            // 实时下载速度：滑动窗口（最近 3 秒收到的字节数）
            const speedWindow = [];
            const fmtSpeed = (bps) => {
                if (bps >= 1048576) return (bps / 1048576).toFixed(1) + 'MB/s';
                if (bps >= 1024) return Math.round(bps / 1024) + 'KB/s';
                return Math.round(bps) + 'B/s';
            };
            let idleTimer = null;
            const armIdle = () => {
                clearTimeout(idleTimer);
                idleTimer = setTimeout(() => {
                    // 中止原始请求：让挂起的 reader.read() 以 AbortError 结束
                    try { if (activeCtrl) activeCtrl.abort(); } catch (e) { /* 忽略 */ }
                }, 30000);
            };
            armIdle();
            try {
                while (true) {
                    const r = await reader.read();
                    armIdle();
                    if (r.done) break;
                    if (!r.value) continue;
                    chunks.push(r.value);
                    received += r.value.length;
                    const now = performance.now();
                    speedWindow.push({ t: now, bytes: r.value.length });
                    while (speedWindow.length && now - speedWindow[0].t > 3000) speedWindow.shift();
                    const winBytes = speedWindow.reduce((s, w) => s + w.bytes, 0);
                    const winMs = Math.max(1, now - speedWindow[0].t);
                    const speed = winBytes / winMs * 1000;
                    // 下载阶段占进度条 0~92%，解析 92~96%，存储 96~100%，全程一条进度条不回退
                    if (lengthTrusted && received > contentLength) {
                        lengthTrusted = false;
                        revealFrom = received;
                    }
                    if (lengthTrusted && contentLength > 0) {
                        const pct = Math.min(91, received / contentLength * 91);
                        showImportHint('正在下载词典 ' + Math.round(pct) + '%（' + fmtSpeed(speed) + '）...', pct);
                    } else {
                        // 总量未知：按已接收量渐近推进（91 → 92），文字给出真实已接收量
                        const extra = Math.max(0, received - revealFrom);
                        const pct = Math.min(92, 91 + (1 - Math.exp(-extra / (40 * 1048576))));
                        const amount = received >= 1048576 ? (received / 1048576).toFixed(1) + 'MB' : Math.round(received / 1024) + 'KB';
                        showImportHint('正在下载词典 已接收 ' + amount + '（' + fmtSpeed(speed) + '）...', pct);
                    }
                }
            } finally {
                clearTimeout(idleTimer);
            }
            const bytes = new Uint8Array(received);
            let off = 0;
            for (const c of chunks) { bytes.set(c, off); off += c.length; }
            text = new TextDecoder().decode(bytes);
        } else {
            showImportHint('正在读取词典文件...');
            text = await resp.text();
        }

        showImportHint('正在解析词典数据 0% ...', 92);
        const rows = parseCSV(text, (ratio) => {
            showImportHint('正在解析词典数据 ' + Math.round(ratio * 100) + '% ...', 92 + ratio * 4);
        });
        if (rows.length < 2) {
            hideImportHint();
            showToast('词典文件为空或格式不正确，导入失败', 'error');
            return;
        }

        const headers = rows[0].map(h => h.trim());
        const idf = {};
        ['word', 'phonetic', 'definition', 'translation', 'pos', 'collins', 'oxford', 'tag', 'bnc', 'frq', 'exchange']
            .forEach(k => { idf[k] = headers.indexOf(k); });
        if (idf.word < 0) {
            hideImportHint();
            showToast('词典文件缺少 word 列，导入失败', 'error');
            return;
        }

        const db = await openDictDB(dict.id);
        const batch = 800;
        const total = rows.length - 1;
        let done = 0;
        for (let i = 1; i < rows.length; i += batch) {
            const entries = [];
            const end = Math.min(i + batch, rows.length);
            for (let j = i; j < end; j++) {
                const row = rows[j];
                if (!row || !row[idf.word]) continue;
                entries.push({
                    word: row[idf.word].trim(),
                    phonetic: row[idf.phonetic] || '',
                    definition: row[idf.definition] || '',
                    translation: row[idf.translation] || '',
                    pos: row[idf.pos] || '',
                    collins: row[idf.collins] || '',
                    oxford: row[idf.oxford] || '',
                    tag: row[idf.tag] || '',
                    bnc: row[idf.bnc] || '',
                    frq: row[idf.frq] || '',
                    exchange: row[idf.exchange] || ''
                });
            }
            if (entries.length > 0) {
                await new Promise((resolve, reject) => {
                    const tx = db.transaction(DICT_STORE_WORDS, 'readwrite');
                    const store = tx.objectStore(DICT_STORE_WORDS);
                    entries.forEach(e => store.put(e));
                    tx.oncomplete = resolve;
                    tx.onerror = () => reject(tx.error);
                });
            }
            done += end - i;
            const pct = Math.round((done / total) * 100);
            showImportHint('正在存储词典 ' + pct + '% ...', 96 + (done / total) * 4);
            // 让出主线程，避免页面卡死
            await new Promise(r => setTimeout(r, 0));
        }

        showImportHint('词典导入完成', 100);
        window.dispatchEvent(new CustomEvent('dictReady', { detail: { count: done } }));
        setTimeout(hideImportHint, 600);
        console.log('词典导入完成，共写入 ' + done + ' 行');
    } catch (e) {
        console.warn('词典导入失败', e);
        hideImportHint();
        // 中途失败时清空半成品数据，避免“已下载但词条不全”的假成功状态
        try { await clearDictStore(dict.id); } catch (err) { /* 忽略 */ }
        const abortMsg = (e && e.name === 'AbortError')
            ? '词典下载中断（网络停滞或超时），请检查网络后重试'
            : '词典下载失败：' + (e && e.message ? e.message : e);
        showToast(abortMsg, 'error');
    } finally {
        window.dictAutoImporting = false;
    }
}

// ---------- 页面初始化 ----------
document.addEventListener('DOMContentLoaded', () => {
    // 词典不再自动下载：仅检测是否已下载，未下载时提示用户前往「我的词典」下载
    checkDictAvailability();
    // 显示存储用量（localStorage + IndexedDB + 剩余空间），每 5 秒刷新
    updateMemUsage();
    setInterval(updateMemUsage, 5000);
});

// 词典可用性提示：未下载任何词典时弹出提示（不自动下载）
async function checkDictAvailability() {
    if (window.disableAutoDictImport) return; // 管理页由用户手动下载/删除，不提示
    const loaded = await isDictLoaded();
    if (loaded) return;
    setTimeout(() => {
        showToast('词典尚未下载，可前往「我的词典」页面下载', 'warning');
    }, 400);
}


// ================= 自定义 UI 提示组件（替代浏览器自带 alert/confirm/prompt） =================
let _toastTimer = null;
// 顶部浮动提示，type: info / success / error / warning
function showToast(msg, type) {
    let el = document.getElementById('appToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'appToast';
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'app-toast show ' + (type || '');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
        el.className = 'app-toast';
    }, 3200);
}

let _dialogCb = null;
// 确认框：msg 为提示文字，onOk/onCancel 为回调
function showConfirm(msg, onOk, onCancel) {
    showDialog('提示', msg, null, onOk, onCancel);
}
// 输入框：title 标题、defaultValue 默认值，onOk(value) 回调
function showPrompt(title, defaultValue, onOk, onCancel) {
    showDialog(title, '', defaultValue, onOk, onCancel);
}
// 通用对话框
function showDialog(title, msg, defaultValue, onOk, onCancel) {
    const overlay = document.getElementById('appDialogOverlay');
    if (!overlay) return;
    document.getElementById('appDialogTitle').textContent = title || '提示';
    const msgEl = document.getElementById('appDialogMsg');
    const input = document.getElementById('appDialogInput');
    const withInput = defaultValue !== null && defaultValue !== undefined;
    if (withInput) {
        msgEl.style.display = 'none';
        input.style.display = '';
        input.value = defaultValue;
    } else {
        msgEl.style.display = '';
        msgEl.textContent = msg || '';
        input.style.display = 'none';
        input.value = '';
    }
    _dialogCb = { onOk: onOk, onCancel: onCancel };
    overlay.style.display = 'flex';
    // 回车确认 / Esc 取消（绑定在遮罩上，输入框与按钮内均可响应）
    overlay.onkeydown = (e) => {
        if (e.key === 'Enter' && withInput) {
            e.preventDefault();
            dialogOk();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            dialogCancel();
        }
    };
    // 先显示再聚焦，否则元素不可见时 focus 无效
    if (withInput) {
        input.focus();
        input.select();
    }
}
function dialogOk() {
    const cb = _dialogCb;
    const input = document.getElementById('appDialogInput');
    const val = input && input.style.display !== 'none' ? input.value : undefined;
    closeDialog();
    if (cb && cb.onOk) cb.onOk(val);
}
function dialogCancel() {
    const cb = _dialogCb;
    closeDialog();
    if (cb && cb.onCancel) cb.onCancel();
}
function closeDialog() {
    const overlay = document.getElementById('appDialogOverlay');
    if (overlay) {
        overlay.style.display = 'none';
        overlay.onkeydown = null;
    }
    _dialogCb = null;
}

// ================= 共享：词表查看 / 添加单词 / 导入（背单词页与我的词典页共用） =================
// 两页的「词表查看、添加单词、Excel 导入」行为完全一致，逻辑只维护这一份

// 将单词转为可安全嵌入 onclick 的 JS 单引号字符串字面量
function jsQuoteStr(s) {
    return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

// 构造词表单词列表 HTML（序号 / 单词 / 释义 / 删除按钮，点击行查看单词详细）
// wordArray: [{ word, meaning, customMeaning }]
// keyword: 搜索词（匹配单词或释义，空则不筛选）
// deleteFnName: 删除按钮调用的全局函数名（如 deleteWordFromList）
// 返回 { html, countText, missing }，missing 为需异步补查释义的条目
function buildWordListMarkup(wordArray, keyword, deleteFnName) {
    const sorted = (wordArray || []).slice().sort((a, b) =>
        String(a.word).toLowerCase().localeCompare(String(b.word).toLowerCase()));
    const kw = (keyword || '').trim().toLowerCase();
    let filtered = sorted;
    if (kw) {
        filtered = sorted.filter(item =>
            String(item.word).toLowerCase().indexOf(kw) !== -1 ||
            String(item.meaning || item.customMeaning || '').toLowerCase().indexOf(kw) !== -1);
    }
    const countText = '单词总数：' + sorted.length + (kw ? '，筛选出 ' + filtered.length + ' 个' : '');
    if (sorted.length === 0) {
        return { html: '<div class="word-item">暂无单词</div>', countText, missing: [] };
    }
    if (filtered.length === 0) {
        return { html: '<div class="word-item">没有匹配的单词</div>', countText, missing: [] };
    }
    let html = '';
    const missing = [];
    filtered.forEach((item, index) => {
        const meaning = item.meaning || (item.customMeaning ? normalizeNewlines(item.customMeaning) : '');
        if (!meaning) missing.push(item);
        html += '<div class="word-item" onclick="showWordDetail(' + jsQuoteStr(item.word) + ')">';
        html += '  <div class="word-item-text">';
        html += '    <span class="word-item-index">' + (index + 1) + '.</span>';
        html += '    <span class="word-item-word">' + escapeHtml(item.word) + '</span>';
        if (meaning) {
            html += '    <span class="word-item-mean">—— ' + escapeHtml(meaning) + '</span>';
        } else {
            html += '    <span class="word-item-mean word-item-mean-loading">（释义加载中...）</span>';
        }
        html += '  </div>';
        html += '  <button class="word-item-del" title="删除单词" onclick="event.stopPropagation();' +
            deleteFnName + '(' + jsQuoteStr(item.word) + ')">';
        html += '    <svg viewBox="0 0 1024 1024" width="13" height="13" fill="currentColor"><path d="M563.8 512l262.5-312.9c4.4-5.2.7-13.1-6.1-13.1h-79.8c-4.7 0-9.2 2.1-12.3 5.7L511.6 449.8 295.1 191.7c-3-3.6-7.5-5.7-12.3-5.7H203c-6.8 0-10.5 7.9-6.1 13.1L459.4 512 196.9 824.9c-4.4 5.2-.7 13.1 6.1 13.1h79.8c4.7 0 9.2-2.1 12.3-5.7l216.5-258.1 216.5 258.1c3 3.6 7.5 5.7 12.3 5.7h79.8c6.8 0 10.5-7.9 6.1-13.1L563.8 512z"/></svg>';
        html += '  </button>';
        html += '</div>';
    });
    return { html, countText, missing };
}

// 构造单词条详情 HTML（音标 / 词表释义 / 助记），extraHtml 追加在末尾（如判定区）
function buildWordDetailHtml(wordObj, listName, extraHtml) {
    let html = '';
    html += '<div class="dict-word">' + escapeHtml(wordObj.word) + '</div>';
    html += '<div class="dict-phonetic">' + (wordObj.phonetic ? '/' + escapeHtml(wordObj.phonetic) + '/' : '') + '</div>';
    const meaning = wordObj.meaning || wordObj.customMeaning || '(无释义)';
    html += '<div class="dict-section-title">词表释义（来源：' + escapeHtml(listName || '') + '）</div>';
    html += '<div class="dict-translation">' + escapeHtml(normalizeNewlines(String(meaning))) + '</div>';
    if (wordObj.mnemonic) {
        html += '<div class="dict-section-title">助记</div>';
        html += '<div class="dict-translation">' + escapeHtml(String(wordObj.mnemonic)) + '</div>';
    }
    if (extraHtml) html += extraHtml;
    return html;
}

// 弹窗开关（各页面共用）：打开时锁定页面滚动；关闭时等所有弹窗都关闭后才恢复滚动
function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('visible');
    document.body.style.overflow = 'hidden';
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('visible');
    if (!document.querySelector('.modal-overlay.visible')) document.body.style.overflow = '';
}

// 从单词详细弹窗右上角「查看详细」跳转查词典页（由该页自动填入输入框并查询）
function goToDictDetail() {
    const word = window._detailWord;
    if (!word) return;
    location.href = 'DictLookup.html?word=' + encodeURIComponent(word);
}

// 把已构造好的单词对象并入词表（按小写单词名去重，同时加入 words 与 pendingWords），返回实际新增数量
// 背单词页与我的词典页共用：两页都需要保持 words / pendingWords 同步
function appendWordsToList(list, newWords) {
    if (!list || !newWords || newWords.length === 0) return 0;
    if (!Array.isArray(list.words)) list.words = [];
    if (!Array.isArray(list.pendingWords)) list.pendingWords = [];
    const existing = new Set(list.words.map(w => String(w.word).toLowerCase()));
    let added = 0;
    newWords.forEach(w => {
        const key = String(w.word).toLowerCase();
        if (!key || existing.has(key)) return;
        existing.add(key);
        list.words.push(w);
        list.pendingWords.push(w);
        added++;
    });
    return added;
}

// 通用导入词表文件（Excel / CSV / TSV / TXT）
// 第 1 列单词、第 2 列意思、第 3 列助记、第 4 列音标（后续列允许为空）
// 返回 { added, skipped }；读取或格式错误时抛出异常（message 可直接提示用户）
async function importWordsFromFile(file, list) {
    const name = String((file && file.name) || '').toLowerCase();
    let rows = [];
    if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
        rows = parseDelimitedText(await file.text());
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        if (typeof XLSX === 'undefined') throw new Error('Excel 解析库未加载，请改用 .csv 文件导入');
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) throw new Error('Excel 中没有工作表');
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    } else {
        throw new Error('不支持的文件格式，请选择 .xlsx 或 .csv');
    }
    let added = 0, skipped = 0;
    // 一次性建立已存在单词集合，避免每行都线性扫描整张词表
    if (!Array.isArray(list.words)) list.words = [];
    if (!Array.isArray(list.pendingWords)) list.pendingWords = [];
    const existing = new Set(list.words.map(w => String(w.word).toLowerCase()));
    rows.forEach(r => {
        if (!r || !Array.isArray(r)) return;
        const word = String(r[0] == null ? '' : r[0]).trim();
        if (!word || /^(单词|word|词汇)$/i.test(word)) return; // 跳过表头
        const meaning = String(r[1] == null ? '' : r[1]).trim();
        const key = word.toLowerCase();
        if (!meaning || existing.has(key)) { skipped++; return; }
        const mnemonic = (r[2] != null && String(r[2]).trim()) ? String(r[2]).trim() : null;
        const phonetic = (r[3] != null && String(r[3]).trim()) ? String(r[3]).trim() : '';
        const wordObj = { word: word, meaning: meaning, mnemonic: mnemonic, phonetic: phonetic };
        existing.add(key);
        list.words.push(wordObj);
        list.pendingWords.push(wordObj);
        added++;
    });
    list.words.sort((a, b) => a.word.localeCompare(b.word));
    list.pendingWords.sort((a, b) => a.word.localeCompare(b.word));
    return { added, skipped };
}

// 在指定容器中展示本次添加/导入失败的单词
function renderAddFailed(containerId, failed) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!failed || failed.length === 0) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }
    el.innerHTML = '<div class="add-failed-title">以下单词添加失败（词典中未找到）：</div>' +
        '<div class="add-failed-words">' + failed.map(w => escapeHtml(w)).join('、') + '</div>';
    el.classList.remove('hidden');
}

// ================= 每日任务（艾宾浩斯复习排期） =================
// 任务与词表同库不同 key：独立存储，不新增数据库版本，避免影响其他页面的连接
const WORD_DB_KEY_DAILY = 'dailyTasks';
const DAILY_DEFAULT_INTERVALS = [1, 2, 4, 7, 15];
const DAILY_MAX_REVIEWS = 8;

function emptyDailyData() {
    return { intervals: DAILY_DEFAULT_INTERVALS.slice(), tasks: [] };
}

// 间隔规范化：最多 8 次、每项为正整数、保证第 n 次不小于第 n-1 次
function normalizeIntervals(list) {
    const src = (Array.isArray(list) && list.length ? list : DAILY_DEFAULT_INTERVALS).slice(0, DAILY_MAX_REVIEWS);
    const out = [];
    src.forEach((v, i) => {
        let n = parseInt(v, 10);
        if (!isFinite(n) || n < 1) n = 1;
        if (i > 0 && n < out[i - 1]) n = out[i - 1];
        out.push(n);
    });
    return out.length ? out : DAILY_DEFAULT_INTERVALS.slice();
}

async function loadDailyTasks() {
    const d = await idbGetValue(WORD_DB_KEY_DAILY);
    if (!d || typeof d !== 'object') return emptyDailyData();
    return {
        intervals: normalizeIntervals(d.intervals),
        tasks: Array.isArray(d.tasks) ? d.tasks : []
    };
}

async function saveDailyTasks(data) {
    return idbPutValue(WORD_DB_KEY_DAILY, data);
}

// 词表被删除（单表删除 / 批量删除 / 合并后移除源表）时，级联删除引用它的全部任务
async function removeDailyTasksByListIds(listIds) {
    const ids = (listIds || []).map(String);
    if (!ids.length) return 0;
    const data = await loadDailyTasks();
    const before = data.tasks.length;
    data.tasks = data.tasks.filter(t => ids.indexOf(String(t.listId)) === -1);
    const removed = before - data.tasks.length;
    if (removed > 0) await saveDailyTasks(data);
    return removed;
}

// ================= 清除缓存 =================
// 删除 IndexedDB 中的全部数据（单词词表库 + 词典库）
function clearAllCache() {
    showConfirm('⚠️ 警告：将清除数据库中的所有数据，包括全部单词列表与词典，此操作无法恢复！确定继续吗？', () => {
        (async () => {
            try {
                // 先关闭所有已缓存的连接，否则 deleteDatabase 会被阻塞
                await closeAllDBs();
                const dbNames = [WORD_DB_NAME];
                // 收集全部词典库（WordMemorizerDict_* 及旧版 WordMemorizerDict）
                try {
                    const all = await indexedDB.databases();
                    all.forEach(d => {
                        if (d.name && (d.name.indexOf(DICT_DB_PREFIX) === 0 || d.name === 'WordMemorizerDict')) {
                            dbNames.push(d.name);
                        }
                    });
                } catch (e) { /* 部分浏览器不支持 databases()，按已知库名删除 */ }
                for (const name of dbNames) {
                    await new Promise((resolve, reject) => {
                        const req = indexedDB.deleteDatabase(name);
                        req.onsuccess = () => resolve();
                        req.onerror = () => reject(req.error);
                        // 有其他页面/连接占用时，浏览器会在连接释放后自动完成删除，这里只需等待
                        req.onblocked = () => {};
                    });
                }
                _wordDataCache = null;
                _savedListsCache = null;
                showToast('已清除全部缓存，页面即将刷新', 'success');
                setTimeout(() => location.reload(), 800);
            } catch (err) {
                console.error(err);
                showToast('清除缓存失败：' + (err && err.message ? err.message : err), 'error');
            }
        })();
    });
}
