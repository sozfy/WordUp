// ========== 词典查询逻辑 ==========
// 词典由 common.js 统一导入并按词典独立存于 IndexedDB（WordMemorizerDict_<id>），
// 本页通过下拉框选择要查询的词典，查询直接读对应数据库，不加载全量到内存
let _dictReady = false;          // 当前所选词典是否已导入
let _currentDictId = '';         // 当前选中的词典 id（'' = 未选择，默认"请选择词典"）

// ---------- UI 更新 ----------
function setDictStatus(text) {
    const el = document.getElementById('dictStatus');
    if (!el) return;
    el.textContent = text;
    // 未选择词典（请选择词典）时不显示状态小字
    el.style.display = (text === '请选择词典') ? 'none' : '';
}

// ---------- 刷新当前词典状态（请选择词典 / 加载中... / 已加载 / 未下载） ----------
async function refreshStatus() {
    // 未选择词典
    if (!_currentDictId) {
        _dictReady = false;
        setDictStatus('请选择词典');
        const searchBtn = document.getElementById('searchBtn');
        if (searchBtn) searchBtn.disabled = true;
        return;
    }
    // 导入进行中：显示"加载中..."
    if (window.dictAutoImporting || window.dictLoading) {
        _dictReady = false;
        setDictStatus('加载中...');
        const searchBtn = document.getElementById('searchBtn');
        if (searchBtn) searchBtn.disabled = true;
        return;
    }
    const count = await countDictEntries(_currentDictId);
    const searchBtn = document.getElementById('searchBtn');
    if (count > 0) {
        _dictReady = true;
        setDictStatus('已加载');
        if (searchBtn) searchBtn.disabled = false;
    } else {
        _dictReady = false;
        setDictStatus('未下载');
        if (searchBtn) searchBtn.disabled = true;
    }
}

// ---------- 渲染词典下拉框（默认"请选择词典"） ----------
function renderDictSelect() {
    const sel = document.getElementById('dictSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">请选择词典</option>' + DICT_CATALOG.map(d =>
        '<option value="' + d.id + '">' + escapeHtml(d.name) + '</option>'
    ).join('');
    sel.value = _currentDictId;
}

// ---------- 切换词典 ----------
function onDictSelect() {
    const sel = document.getElementById('dictSelect');
    if (sel) _currentDictId = sel.value;
    // 清空结果与建议，立即显示"加载中..."，再异步刷新所选词典状态
    const resultEl = document.getElementById('dictResult');
    if (resultEl) resultEl.innerHTML = '<div class="dict-empty">输入单词进行查询</div>';
    const suggestions = document.getElementById('suggestions');
    if (suggestions) suggestions.classList.add('hidden');
    if (_currentDictId) {
        _dictReady = false;
        setDictStatus('加载中...');
        const searchBtn = document.getElementById('searchBtn');
        if (searchBtn) searchBtn.disabled = true;
        refreshStatus();
    } else {
        refreshStatus();
    }
}

// ---------- 查询单词（按当前所选词典） ----------
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

    if (!_currentDictId) {
        resultEl.innerHTML = '<div class="dict-empty">请先在下拉框选择要查询的词典</div>';
        return;
    }

    if (!_dictReady) {
        resultEl.innerHTML = '<div class="dict-empty">当前词典尚未下载，请到「我的词典」页面下载后查询</div>';
        return;
    }

    // 直接从当前词典的 IndexedDB 查询
    const entry = await lookupWord(word, _currentDictId);
    if (entry) {
        renderResult(entry);
    } else {
        // 尝试模糊匹配（前缀），按词频排序，词频高优先，跳过词频为0的
        const matches = await searchDictPrefix(word, 10, _currentDictId);
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
            const matches = await searchDictPrefix(val, 8, _currentDictId);
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
    renderDictSelect();
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

    await refreshStatus();
    // 导入完成事件后刷新状态
    window.addEventListener('dictReady', refreshStatus);
});
