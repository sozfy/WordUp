// ========== 词典查询逻辑 ==========
// 词典数据由 common.js 自动加载到 window.dictData / window.dictLoaded
const DB_NAME = 'WordMemorizerDict';
const STORE_NAME = 'words';
const DB_VERSION = 2;

// ---------- HTML 转义 ----------
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ---------- CSV 解析器（支持带引号字段）----------
function parseCSV(text) {
    const rows = [];
    let cur = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];

        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += c;
            }
        } else {
            if (c === '"') {
                inQuotes = true;
            } else if (c === ',') {
                cur.push(field);
                field = '';
            } else if (c === '\n') {
                cur.push(field);
                rows.push(cur);
                cur = [];
                field = '';
            } else if (c === '\r') {
                // 忽略 \r，等 \n 处理
            } else {
                field += c;
            }
        }
    }
    // 最后一行
    if (field.length > 0 || cur.length > 0) {
        cur.push(field);
        rows.push(cur);
    }
    return rows;
}

// ---------- IndexedDB 操作 ----------
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'word' });
            }
            if (!db.objectStoreNames.contains('presetLists')) {
                db.createObjectStore('presetLists', { keyPath: 'tag' });
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function saveToIndexedDB(entries) {
    const db = await openDB();
    const batch = 1000;

    // 第一步：清空旧数据（独立事务）
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });

    // 第二步：分批写入，每批一个独立事务
    for (let i = 0; i < entries.length; i += batch) {
        const end = Math.min(i + batch, entries.length);
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            for (let j = i; j < end; j++) {
                store.put(entries[j]);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
        const pct = Math.round((end / entries.length) * 100);
        updateProgress(pct, `正在存储到本地数据库... ${end}/${entries.length}`);
    }
}

// ---------- UI 更新 ----------
function updateProgress(pct, text) {
    const bar = document.getElementById('progressBar');
    const txt = document.getElementById('progressText');
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.textContent = text;
}

function setDictStatus(text) {
    const el = document.getElementById('dictStatus');
    if (el) el.textContent = text;
}

// ---------- 重新导入词典 ----------
async function reimportDict() {
    showConfirm('重新导入将清空当前词典数据并重新下载（约需1-3分钟），是否继续？', async () => {
    const btn = document.getElementById('reimportBtn');
    const searchBtn = document.getElementById('searchBtn');
    if (btn) btn.disabled = true;
    setDictStatus('正在清空旧词典...');
    try {
        const db = await openDictDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(DICT_STORE_WORDS, 'readwrite');
            tx.objectStore(DICT_STORE_WORDS).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
        // 重置内存状态，强制重新导入
        window.dictLoaded = false;
        window.dictData = null;
        window.dictLoading = false;
        window.dictAutoImporting = false;
        if (searchBtn) searchBtn.disabled = true;
        await autoImportDictFromCSV();
        // 更新状态
        if (window.dictLoaded) {
            setDictStatus('词典已加载：' + window.dictData.size + ' 个单词');
            if (searchBtn) searchBtn.disabled = false;
        } else {
            setDictStatus('词典未加载');
        }
    } catch (e) {
        console.error('重新导入失败', e);
        showToast('重新导入失败：' + e.message, 'error');
        setDictStatus('词典未加载');
    } finally {
        if (btn) btn.disabled = false;
    }
    });
}

// ---------- 导入词典 ----------
async function importDict() {
    const fileInput = document.getElementById('csvFile');
    if (!fileInput.files || fileInput.files.length === 0) {
        showToast('请先选择 ecdict.csv 文件', 'error');
        return;
    }

    const file = fileInput.files[0];
    const importBtn = document.getElementById('importBtn');
    const progressDiv = document.getElementById('importProgress');

    importBtn.disabled = true;
    progressDiv.classList.remove('hidden');
    updateProgress(0, '正在读取文件...');

    try {
        const text = await file.text();
        updateProgress(10, '正在解析 CSV...');

        // 用 setTimeout 让 UI 更新
        await new Promise(r => setTimeout(r, 50));

        const rows = parseCSV(text);
        if (rows.length < 2) {
            showToast('CSV 文件格式不正确或为空', 'error');
            importBtn.disabled = false;
            return;
        }

        const headers = rows[0].map(h => h.trim());
        const wordIdx = headers.indexOf('word');
        const phoneticIdx = headers.indexOf('phonetic');
        const definitionIdx = headers.indexOf('definition');
        const translationIdx = headers.indexOf('translation');
        const posIdx = headers.indexOf('pos');
        const collinsIdx = headers.indexOf('collins');
        const oxfordIdx = headers.indexOf('oxford');
        const tagIdx = headers.indexOf('tag');
        const bncIdx = headers.indexOf('bnc');
        const frqIdx = headers.indexOf('frq');
        const exchangeIdx = headers.indexOf('exchange');

        updateProgress(30, `正在处理 ${rows.length - 1} 条数据...`);
        await new Promise(r => setTimeout(r, 50));

        const entries = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row[wordIdx]) continue;
            entries.push({
                word: row[wordIdx] ? row[wordIdx].trim() : '',
                phonetic: row[phoneticIdx] || '',
                definition: row[definitionIdx] || '',
                translation: row[translationIdx] || '',
                pos: row[posIdx] || '',
                collins: row[collinsIdx] || '',
                oxford: row[oxfordIdx] || '',
                tag: row[tagIdx] || '',
                bnc: row[bncIdx] || '',
                frq: row[frqIdx] || '',
                exchange: row[exchangeIdx] || ''
            });

            if (i % 10000 === 0) {
                const pct = 30 + Math.round((i / rows.length) * 40);
                updateProgress(pct, `正在处理... ${i}/${rows.length - 1}`);
                await new Promise(r => setTimeout(r, 0));
            }
        }

        updateProgress(75, '正在存储到本地数据库...');
        await saveToIndexedDB(entries);

        // 更新全局词典（common.js 共享）
        const map = new Map();
        for (const entry of entries) {
            if (entry.word) map.set(entry.word.toLowerCase(), entry);
        }
        window.dictData = map;
        window.dictLoaded = true;
        window.dispatchEvent(new CustomEvent('dictReady', { detail: { count: entries.length } }));

        updateProgress(100, '导入完成！共 ' + entries.length + ' 个单词');
        setDictStatus('词典已加载：' + entries.length + ' 个单词');
        document.getElementById('searchBtn').disabled = false;

        setTimeout(() => {
            progressDiv.classList.add('hidden');
            importBtn.disabled = false;
        }, 1500);

    } catch (err) {
        console.error(err);
        showToast('导入失败：' + err.message, 'error');
        importBtn.disabled = false;
        progressDiv.classList.add('hidden');
    }
}

// ---------- 查询单词 ----------
function searchWord() {
    const input = document.getElementById('searchInput');
    const word = input.value.trim().toLowerCase();
    const resultEl = document.getElementById('dictResult');
    const suggestions = document.getElementById('suggestions');

    suggestions.classList.add('hidden');

    if (!word) {
        resultEl.innerHTML = '<div class="dict-empty">请输入要查询的单词</div>';
        return;
    }

    if (!window.dictLoaded) {
        resultEl.innerHTML = '<div class="dict-empty">请先导入词典数据</div>';
        return;
    }

    const entry = window.dictData.get(word);
    if (entry) {
        renderResult(entry);
    } else {
        // 尝试模糊匹配（前缀），按词频排序，词频高优先，跳过词频为0的
        const matches = [];
        for (const [key, val] of window.dictData) {
            if (key.startsWith(word)) {
                const frq = parseInt(val.frq, 10) || 0;
                if (frq <= 0) continue;
                matches.push({ val, frq });
            }
        }
        matches.sort((a, b) => a.frq - b.frq);
        const topMatches = matches.slice(0, 10).map(m => m.val);

        if (topMatches.length > 0) {
            let html = `<div class="dict-empty">未找到 "${escapeHtml(word)}"，您是不是想找：</div><div style="margin-top:0.5rem;">`;
            topMatches.forEach(m => {
                html += `<div class="word-item" style="cursor:pointer;" data-word="${escapeHtml(m.word)}">${escapeHtml(m.word)} — ${escapeHtml(m.translation.substring(0, 50))}</div>`;
            });
            html += '</div>';
            resultEl.innerHTML = html;
        } else {
            resultEl.innerHTML = `<div class="dict-empty">未找到单词 "${word}"</div>`;
        }
    }
}

// ---------- 渲染查询结果 ----------
function renderResult(entry) {
    const resultEl = document.getElementById('dictResult');

    let tagsHtml = '';
    const tags = formatTags(entry.tag);
    if (tags.length > 0) {
        tagsHtml = '<div class="dict-tags">';
        tags.forEach(t => {
            tagsHtml += '<span class="dict-tag" title="' + escapeHtml(t.key) + '">' + escapeHtml(t.label) + '</span>';
        });
        tagsHtml += '</div>';
    }

    let html = '';
    html += '<div class="dict-word">' + escapeHtml(entry.word) + '</div>';
    html += '<div class="dict-phonetic">' + (entry.phonetic ? '/' + escapeHtml(entry.phonetic) + '/' : '') + '</div>';

    if (entry.translation) {
        // translation 中的 \n 是字面量，先转为真实换行再转义，pre-wrap 会渲染换行
        html += '<div class="dict-section-title">中文释义</div>';
        html += '<div class="dict-translation">' + escapeHtml(normalizeNewlines(entry.translation)) + '</div>';
    }

    if (entry.definition) {
        html += '<div class="dict-section-title">英文定义</div>';
        html += '<div class="dict-definition">' + escapeHtml(normalizeNewlines(entry.definition)) + '</div>';
    }

    if (entry.pos) {
        html += '<div class="dict-section-title">词性</div>';
        html += '<div class="dict-translation">' + escapeHtml(entry.pos) + '</div>';
    }

    if (entry.exchange) {
        html += '<div class="dict-section-title">时态变化</div>';
        html += '<div class="dict-translation">' + formatExchange(entry.exchange) + '</div>';
    }

    if (entry.collins || entry.oxford || entry.bnc || entry.frq) {
        html += '<div class="dict-section-title">词典信息</div><div class="dict-definition">';
        if (entry.collins) html += '柯林斯星级：' + escapeHtml(entry.collins) + '　';
        if (entry.oxford) html += '牛津：' + escapeHtml(entry.oxford) + '　';
        if (entry.bnc) html += 'BNC：' + escapeHtml(entry.bnc) + '　';
        if (entry.frq) html += '词频：' + escapeHtml(entry.frq);
        html += '</div>';
    }

    html += tagsHtml;

    resultEl.innerHTML = html;
}

// ---------- 输入建议 ----------
function setupSuggestions() {
    const input = document.getElementById('searchInput');
    const suggestions = document.getElementById('suggestions');

    let debounceTimer = null;

    input.addEventListener('input', () => {
        const val = input.value.trim().toLowerCase();
        if (!val || !window.dictLoaded) {
            suggestions.classList.add('hidden');
            return;
        }

        // 防抖：避免每次击键都全量遍历+排序
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const matches = [];
            for (const [key, entry] of window.dictData) {
                if (key.startsWith(val) && key !== val) {
                    // 跳过词频为 0 或无词频的单词
                    const frq = parseInt(entry.frq, 10) || 0;
                    if (frq <= 0) continue;
                    matches.push({ key, frq });
                }
            }
            // 按词频排序，词频高（frq 数值小）优先
            matches.sort((a, b) => a.frq - b.frq);
            const topKeys = matches.slice(0, 8).map(m => m.key);

            if (topKeys.length > 0) {
                suggestions.innerHTML = topKeys.map(w =>
                    `<div class="word-item" style="cursor:pointer;" data-word="${escapeHtml(w)}">${escapeHtml(w)}</div>`
                ).join('');
                suggestions.classList.remove('hidden');
            } else {
                suggestions.classList.add('hidden');
            }
        }, 150);
    });

    // 点击外部关闭建议
    document.addEventListener('click', (e) => {
        if (!suggestions.contains(e.target) && e.target !== input) {
            suggestions.classList.add('hidden');
        }
    });
}

// ---------- 页面初始化 ----------
window.addEventListener('DOMContentLoaded', async () => {
    setupSuggestions();

    // 事件委托：点击带 data-word 的候选词时填入并查询
    document.addEventListener('click', (e) => {
        const item = e.target.closest('[data-word]');
        if (item) {
            const input = document.getElementById('searchInput');
            if (input) {
                input.value = item.dataset.word;
                searchWord();
            }
        }
    });

    // 词典由 common.js 自动加载到 window.dictData，这里同步状态
    function onDictReady(e) {
        const count = e && e.detail ? e.detail.count : 0;
        if (count > 0) {
            setDictStatus('词典已加载：' + count + ' 个单词');
            document.getElementById('searchBtn').disabled = false;
        } else {
            setDictStatus('词典未加载');
        }
    }

    if (window.dictLoaded) {
        onDictReady({ detail: { count: window.dictData.size } });
    } else if (window.dictLoading) {
        setDictStatus('正在从本地加载词典...');
        window.addEventListener('dictReady', onDictReady, { once: true });
    } else {
        const imported = await isDictLoaded();
        if (imported) {
            setDictStatus('正在从本地加载词典...');
            window.addEventListener('dictReady', onDictReady, { once: true });
        }
    }
});
