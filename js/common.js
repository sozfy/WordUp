// ========== 共享功能 ==========

// ---------- 全局词典（所有页面共享，从 IndexedDB 加载） ----------
window.dictData = null;       // Map: word.toLowerCase() -> entry
window.dictLoaded = false;
window.dictLoading = false;

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

const PRESET_TAGS = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'ielts', 'toefl', 'gre'];

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

// CSV 解析器（支持带引号字段），用于内置词典自动导入
function parseCSV(text) {
    const rows = [];
    let cur = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else { inQuotes = false; }
            } else { field += ch; }
        } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',') { cur.push(field); field = ''; }
            else if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
            else if (ch === '\r') { /* ignore */ }
            else { field += ch; }
        }
    }
    if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
    return rows;
}

// ---------- IndexedDB 词典 ----------
const DICT_DB_NAME = 'WordMemorizerDict';
const DICT_STORE_WORDS = 'words';
const DICT_STORE_PRESET = 'presetLists';
const DICT_DB_VERSION = 2;

function openDictDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DICT_DB_NAME, DICT_DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(DICT_STORE_WORDS)) {
                db.createObjectStore(DICT_STORE_WORDS, { keyPath: 'word' });
            }
            if (!db.objectStoreNames.contains(DICT_STORE_PRESET)) {
                db.createObjectStore(DICT_STORE_PRESET, { keyPath: 'tag' });
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

// 从 IndexedDB 全量加载词典到内存（页面打开时自动调用）
async function loadDictToMemory() {
    if (window.dictLoaded || window.dictLoading) return;
    window.dictLoading = true;
    try {
        const db = await openDictDB();
        const entries = await new Promise((resolve, reject) => {
            const tx = db.transaction(DICT_STORE_WORDS, 'readonly');
            const req = tx.objectStore(DICT_STORE_WORDS).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = (e) => reject(e.target.error);
        });
        const map = new Map();
        for (const entry of entries) {
            if (entry.word) {
                map.set(entry.word.toLowerCase(), entry);
            }
        }
        if (map.size > 0) {
            window.dictData = map;
            window.dictLoaded = true;
        }
        window.dispatchEvent(new CustomEvent('dictReady', { detail: { count: map.size } }));
    } catch (e) {
        console.warn('词典加载失败', e);
    } finally {
        window.dictLoading = false;
    }
}

// 查询单个单词（优先内存，否则 IndexedDB）
async function lookupWord(word) {
    if (window.dictLoaded) {
        return window.dictData.get(word.toLowerCase()) || null;
    }
    try {
        const db = await openDictDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(DICT_STORE_WORDS, 'readonly');
            const req = tx.objectStore(DICT_STORE_WORDS).get(word.toLowerCase());
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = (e) => reject(e.target.error);
        });
    } catch (err) {
        return null;
    }
}

// 批量查询单词
async function lookupWords(wordList) {
    const result = new Map();
    if (!wordList || wordList.length === 0) return result;
    // 如果内存已加载，直接查
    if (window.dictLoaded) {
        wordList.forEach(w => {
            const entry = window.dictData.get(w.toLowerCase());
            if (entry) result.set(w.toLowerCase(), entry);
        });
        return result;
    }
    // 否则从 IndexedDB 查
    try {
        const db = await openDictDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(DICT_STORE_WORDS, 'readonly');
            const store = tx.objectStore(DICT_STORE_WORDS);
            let pending = wordList.length;
            wordList.forEach(w => {
                const req = store.get(w.toLowerCase());
                req.onsuccess = () => {
                    if (req.result) result.set(w.toLowerCase(), req.result);
                    pending--;
                    if (pending === 0) resolve(result);
                };
                req.onerror = () => {
                    pending--;
                    if (pending === 0) resolve(result);
                };
            });
        });
    } catch {
        return result;
    }
}

// 检查单词是否已导入（IndexedDB 中有数据）
async function isDictLoaded() {
    try {
        const db = await openDictDB();
        return new Promise((resolve) => {
            const tx = db.transaction(DICT_STORE_WORDS, 'readonly');
            const req = tx.objectStore(DICT_STORE_WORDS).count();
            req.onsuccess = () => resolve(req.result > 0);
            req.onerror = () => resolve(false);
        });
    } catch {
        return false;
    }
}

// ---------- 预设词表（从 preset_data.js 静态加载，window.PRESET_LISTS） ----------
function getPresetLists() {
    return window.PRESET_LISTS || [];
}

function getPresetListByTag(tag) {
    if (!window.PRESET_LISTS) return null;
    return window.PRESET_LISTS.find(l => l.tag === tag) || null;
}

// ---------- localStorage 存储用量显示 ----------
function getLocalStorageUsage() {
    let total = 0;
    for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
            total += (localStorage[key].length + key.length) * 2; // UTF-16 每字符2字节
        }
    }
    return total;
}

// 检测浏览器真实的 localStorage 配额（不清除现有数据，追加写入直到失败）
// 结果缓存到 localStorage，只检测一次
let _cachedQuota = null;
function detectLocalStorageQuota() {
    if (_cachedQuota !== null) return _cachedQuota;
    try {
        const cached = localStorage.getItem('_ls_quota_v2');
        if (cached) {
            const val = parseInt(cached, 10);
            if (val > 0) {
                _cachedQuota = val;
                return _cachedQuota;
            }
        }
    } catch (e) {}

    try {
        // 清理可能残留的测试数据
        for (let i = 0; i < 250; i++) {
            try { localStorage.removeItem('_qtest_' + i); } catch (e) {}
        }
        try { localStorage.removeItem('_quota_test_'); } catch (e) {}

        const chunk = 'a'.repeat(51200); // 100KB(UTF-16)
        const keys = [];
        let count = 0;
        // 写入循环用独立 try-catch，达到配额时抛出，不跳过后续清理
        try {
            while (count < 100) { // 安全上限 10MB
                const key = '_qtest_' + count;
                localStorage.setItem(key, chunk);
                keys.push(key);
                count++;
            }
        } catch (e) {
            // 达到配额上限，count 即为成功写入的块数
        }
        // 始终清理测试数据
        for (let i = 0; i < keys.length; i++) {
            try { localStorage.removeItem(keys[i]); } catch (e) {}
        }
        const used = getLocalStorageUsage();
        const quota = used + count * 102400;
        _cachedQuota = quota;
        try { localStorage.setItem('_ls_quota_v2', String(quota)); } catch (e) {}
        return quota;
    } catch (e) {
        // 检测失败，回退到常规5MB
        _cachedQuota = 5 * 1048576;
        return _cachedQuota;
    }
}

function updateMemUsage() {
    const el = document.getElementById('memUsage');
    if (!el) return;
    const usedBytes = getLocalStorageUsage();
    const usedMB = (usedBytes / 1048576).toFixed(2);
    if (_cachedQuota !== null) {
        const quotaMB = (_cachedQuota / 1048576).toFixed(2);
        el.textContent = '存储 ' + usedMB + '/' + quotaMB + 'MB';
        el.title = 'localStorage 已用 / 浏览器配额';
    } else {
        el.textContent = '存储 ' + usedMB + 'MB';
        el.title = 'localStorage 已用';
    }
}

// ---------- 内置词典自动导入（APK 首次启动时从 ecdict.csv 导入） ----------
let _autoImportShown = false;
function showImportHint(text) {
    let el = document.getElementById('autoImportHint');
    if (!el) {
        el = document.createElement('div');
        el.id = 'autoImportHint';
        el.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:9999;background:#3a3c44;border:1px solid #5a5c66;color:#fff;padding:10px 18px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.4);max-width:90%;text-align:center;font-size:14px;';
        document.body.appendChild(el);
        _autoImportShown = true;
    }
    el.textContent = text;
}
function hideImportHint() {
    const el = document.getElementById('autoImportHint');
    if (el) el.remove();
}

async function autoImportDictFromCSV() {
    if (window.dictAutoImporting || window.dictLoading) return;
    let loaded = false;
    try { loaded = await isDictLoaded(); } catch (e) {}
    if (loaded) return;
    if (window.dictData && window.dictData.size > 0) return;

    window.dictAutoImporting = true;
    showImportHint('首次使用，正在导入内置词典（约需1-3分钟）...');
    try {
        // 词典来源：优先本地 data/ecdict.csv（自备），否则从 ECDICT GitHub 仓库在线获取
        const DICT_CSV_URLS = [
            'data/ecdict.csv',
            'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv'
        ];
        let resp = null;
        for (const url of DICT_CSV_URLS) {
            try {
                resp = await fetch(url);
                if (resp.ok) break;
            } catch (e) { resp = null; }
        }
        if (!resp || !resp.ok) {
            console.warn('未找到内置词典文件 ecdict.csv');
            return;
        }
        showImportHint('正在读取词典文件...');
        const text = await resp.text();
        showImportHint('正在解析词典数据...');
        const rows = parseCSV(text);
        if (rows.length < 2) { console.warn('词典 CSV 为空'); return; }

        const headers = rows[0].map(h => h.trim());
        const idf = {};
        ['word','phonetic','definition','translation','pos','collins','oxford','tag','bnc','frq','exchange'].forEach(k => idf[k] = headers.indexOf(k));

        const db = await openDictDB();
        const batch = 800;
        const total = rows.length - 1;
        let done = 0;
        for (let i = 1; i < rows.length; i += batch) {
            const entries = [];
            const end = Math.min(i + batch, rows.length);
            for (let j = i; j < end; j++) {
                const row = rows[j];
                if (!row[idf.word]) continue;
                entries.push({
                    word: row[idf.word] ? row[idf.word].trim() : '',
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
            showImportHint('正在存储词典 ' + pct + '% ...');
            // 让出主线程，避免页面卡死
            await new Promise(r => setTimeout(r, 0));
        }

        showImportHint('词典导入完成，正在加载...');
        await loadDictToMemory();
        window.dispatchEvent(new CustomEvent('dictReady', { detail: { count: window.dictData ? window.dictData.size : 0 } }));
        hideImportHint();
        console.log('内置词典自动导入完成');
    } catch (e) {
        console.warn('内置词典自动导入失败', e);
        hideImportHint();
    } finally {
        window.dictAutoImporting = false;
    }
}

// ---------- 页面初始化 ----------
document.addEventListener('DOMContentLoaded', () => {
    // 只在查单词页面全量加载词典到内存（用于搜索建议/模糊匹配）
    // 背单词页面不自动加载，添加单词时按需查 IndexedDB，避免打开时等待
    if (document.getElementById('searchInput')) {
        // 查单词页：先确保词典已导入（首次自动从 ecdict.csv 导入 IndexedDB），再加载到内存
        autoImportDictFromCSV().then(() => loadDictToMemory());
    } else {
        // 其他页面：后台自动导入内置词典（不阻塞 UI）
        autoImportDictFromCSV();
    }
    // 清理可能残留的配额检测数据
    for (let i = 0; i < 250; i++) {
        try { localStorage.removeItem('_qtest_' + i); } catch (e) {}
    }
    try { localStorage.removeItem('_quota_test_'); } catch (e) {}
    // 存储用量显示
    updateMemUsage();
    // 检测真实配额（同步执行，首次约几十到几百毫秒，结果缓存）
    detectLocalStorageQuota();
    updateMemUsage();
    setInterval(updateMemUsage, 5000);
});
