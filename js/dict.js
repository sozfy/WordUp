// ========== 词典查询逻辑 ==========
// 词典由 common.js 统一导入并存于 IndexedDB，本页直接查询数据库，不加载全量到内存
let _dictReady = false; // 词典是否已导入（从 IndexedDB 统计判断）

// ---------- UI 更新 ----------
function setDictStatus(text) {
    const el = document.getElementById('dictStatus');
    if (el) el.textContent = text;
}

// ---------- 词典已加载状态文案：共 实际/应有 个单词 ----------
function getDictLoadedText(actual) {
    const expectedEl = document.getElementById('dictExpectedCount');
    const expected = expectedEl ? expectedEl.textContent : '';
    return '词典已加载，共 ' + Number(actual).toLocaleString('en-US') + '/' + expected + ' 个单词';
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
            // 更新状态（直接从 IndexedDB 统计）
            const cnt = await countDictEntries();
            if (cnt > 0) {
                _dictReady = true;
                setDictStatus(getDictLoadedText(cnt));
                if (searchBtn) searchBtn.disabled = false;
            } else {
                _dictReady = false;
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

// ---------- 查询单词 ----------
async function searchWord() {
    const input = document.getElementById('searchInput');
    const word = input.value.trim().toLowerCase();
    const resultEl = document.getElementById('dictResult');
    const suggestions = document.getElementById('suggestions');

    suggestions.classList.add('hidden');

    if (!word) {
        resultEl.innerHTML = '<div class="dict-empty">请输入要查询的单词</div>';
        return;
    }

    if (!_dictReady) {
        resultEl.innerHTML = '<div class="dict-empty">词典正在加载，请稍候再试</div>';
        return;
    }

    // 直接从 IndexedDB 查询（不依赖内存全量词典）
    const entry = await lookupWord(word);
    if (entry) {
        renderResult(entry);
    } else {
        // 尝试模糊匹配（前缀），按词频排序，词频高优先，跳过词频为0的
        const matches = await searchDictPrefix(word, 10);
        if (matches.length > 0) {
            let html = `<div class="dict-empty">未找到 "${escapeHtml(word)}"，您是不是想找：</div><div style="margin-top:0.5rem;">`;
            matches.forEach(m => {
                html += `<div class="word-item" style="cursor:pointer;" data-word="${escapeHtml(m.word)}">${escapeHtml(m.word)} — ${escapeHtml((m.translation || '').substring(0, 50))}</div>`;
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
        if (!val || !_dictReady) {
            suggestions.classList.add('hidden');
            return;
        }

        // 防抖：避免每次击键都触发数据库查询
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            const matches = await searchDictPrefix(val, 8);
            const topKeys = matches.map(m => m.word);

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

    // 词典存储于 IndexedDB，页面打开时同步状态（统计词条数）
    async function refreshStatus() {
        const count = await countDictEntries();
        if (count > 0) {
            _dictReady = true;
            setDictStatus(getDictLoadedText(count));
            const btn = document.getElementById('searchBtn');
            if (btn) btn.disabled = false;
        } else {
            _dictReady = false;
            setDictStatus('词典未加载');
        }
    }
    await refreshStatus();
    // 导入完成事件后刷新状态
    window.addEventListener('dictReady', refreshStatus);
});
