// ========== 词典查询逻辑 ==========
// 职责：DictLookup.html 页面
//   - 下拉框选择词典（默认"请选择词典"）
//   - 查询：词典命中显示详情；未命中回退到用户词表（自定义词）；再无则前缀联想
// 词典由 common.js 统一导入并按词典独立存于 IndexedDB（WordMemorizerDict_<id>），
// 本页通过下拉框选择要查询的词典，查询直接读对应数据库，不加载全量到内存
let _dictReady = false;          // 当前所选词典是否已导入
let _currentDictId = '';         // 当前选中的词典 id（'' = 未选择，默认"请选择词典"）
let _queryToken = 0;             // 查询/联想的序号，用于丢弃过期的异步结果

// ---------- UI 更新 ----------
function setDictStatus(text) {
    const el = document.getElementById('dictStatus');
    if (!el) return;
    el.textContent = text;
    // 未选择词典（请选择词典）时不显示状态小字
    el.style.display = (text === '请选择词典') ? 'none' : '';
}

// 查询按钮可用状态（refreshStatus / onDictSelect / searchWord 共用）
function setSearchEnabled(enabled) {
    const btn = document.getElementById('searchBtn');
    if (btn) btn.disabled = !enabled;
}

// 立即显示"加载中..."（切换词典/词典尚未就绪时的过渡状态）
function showDictLoading() {
    _dictReady = false;
    setDictStatus('加载中...');
    setSearchEnabled(false);
}

// ---------- 刷新当前词典状态（请选择词典 / 加载中... / 已加载 / 未下载） ----------
async function refreshStatus() {
    if (!_currentDictId) {
        _dictReady = false;
        setDictStatus('请选择词典');
        setSearchEnabled(false);
        return;
    }
    if (window.dictAutoImporting) {
        showDictLoading();
        return;
    }
    const id = _currentDictId;
    const count = await countDictEntries(id);
    if (id !== _currentDictId) return; // 等待期间用户又切换了词典/切回“请选择词典”
    _dictReady = count > 0;
    setDictStatus(_dictReady ? '已加载' : '未下载');
    setSearchEnabled(_dictReady);
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
    if (_currentDictId) showDictLoading();
    refreshStatus();
}

// ---------- 查询单词（按当前所选词典） ----------
async function searchWord() {
    const input = document.getElementById('searchInput');
    const resultEl = document.getElementById('dictResult');
    const suggestions = document.getElementById('suggestions');
    if (!input || !resultEl) return;
    const word = input.value.trim().toLowerCase();
    if (suggestions) suggestions.classList.add('hidden');

    if (!word) {
        resultEl.innerHTML = '<div class="dict-empty">请输入要查询的单词</div>';
        return;
    }

    const token = ++_queryToken;

    // 未选择词典或词典不可用时：先尝试从用户词表中查找（自定义词/词表词）
    if (!_currentDictId || !_dictReady) {
        const listHit = await lookupWordInLists(word);
        if (token !== _queryToken) return;
        if (listHit) {
            renderListWordResult(listHit);
            return;
        }
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
    if (token !== _queryToken) return;
    if (entry) {
        renderResult(entry);
        return;
    }

    // 词典未命中：从用户词表中查找（自定义词/词表词，如背单词页添加的 # 自定义意思）
    const listHit = await lookupWordInLists(word);
    if (token !== _queryToken) return;
    if (listHit) {
        renderListWordResult(listHit);
        return;
    }

    // 仍未命中：做前缀联想（按词频排序，词频高优先，跳过词频为 0 的）
    const matches = await searchDictPrefix(word, 10, _currentDictId);
    if (token !== _queryToken) return;
    if (matches.length === 0) {
        resultEl.innerHTML = '<div class="dict-empty">未找到单词 "' + escapeHtml(word) + '"</div>';
        return;
    }
    let html = '<div class="dict-empty">未找到 "' + escapeHtml(word) + '"，您是不是想找：</div><div style="margin-top:0.5rem;">';
    matches.forEach(m => {
        const brief = flattenNewlines(m.translation || '').substring(0, 50);
        html += '<div class="word-item" style="cursor:pointer;" data-word="' + escapeHtml(m.word) + '">' +
            escapeHtml(m.word) + (brief ? ' — ' + escapeHtml(brief) : '') + '</div>';
    });
    html += '</div>';
    resultEl.innerHTML = html;
}

// 从用户词表中查找单词（自定义词/词表词，词典中查不到时兜底显示）
async function lookupWordInLists(word) {
    try {
        await initWordDataCache();
    } catch (e) {
        return null;
    }
    const data = getWordData();
    if (!data || !Array.isArray(data.lists)) return null;
    const lower = String(word).toLowerCase();
    for (const list of data.lists) {
        const w = (list.words || []).find(x => String(x.word).toLowerCase() === lower);
        if (w) {
            return {
                word: w.word,
                meaning: w.customMeaning || w.meaning || '',
                phonetic: w.phonetic || '',
                mnemonic: w.mnemonic || null,
                _listName: list.name
            };
        }
    }
    return null;
}

// 渲染词表命中结果
function renderListWordResult(hit) {
    const resultEl = document.getElementById('dictResult');
    if (!resultEl) return;
    const meaning = hit.meaning || '(无释义)';
    let html = '<div class="dict-word">' + escapeHtml(hit.word) + '</div>';
    if (hit.phonetic) html += '<div class="dict-phonetic">/' + escapeHtml(hit.phonetic) + '/</div>';
    html += '<div class="dict-section-title">词表释义（来源：' + escapeHtml(hit._listName) + '）</div>';
    html += '<div class="dict-translation">' + escapeHtml(normalizeNewlines(String(meaning))) + '</div>';
    if (hit.mnemonic) {
        html += '<div class="dict-section-title">助记</div>';
        html += '<div class="dict-translation">' + escapeHtml(String(hit.mnemonic)) + '</div>';
    }
    resultEl.innerHTML = html;
}

// ---------- 渲染查询结果 ----------
function renderResult(entry) {
    const resultEl = document.getElementById('dictResult');
    if (!resultEl) return;
    // 日语词条按 JMdict 自身结构渲染（写法 / 读音 / 义项 / 例句），不套英汉词典版式
    if (entry && entry.lang === 'ja') { renderJaResult(entry); return; }

    let tagsHtml = '';
    const tags = formatTags(entry.tag);
    if (tags.length > 0) {
        tagsHtml = '<div class="dict-tags">' + tags.map(t =>
            '<span class="dict-tag" title="' + escapeHtml(t.key) + '">' + escapeHtml(t.label) + '</span>'
        ).join('') + '</div>';
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

// ---------- 日语词条（JMdict 结构） ----------
// 版式：主表记 → 读音（多个用「、」连接）→ 其他写法 → 等级/词性 → 逐条义项（中译 + 英文原义 + 语境）→ 例句
function renderJaResult(entry) {
    const resultEl = document.getElementById('dictResult');
    if (!resultEl) return;

    const forms = entry.forms || { kanji: [], kana: [] };
    const kanjiAll = (forms.kanji || []).map(k => k.text).filter(Boolean);
    const kanaAll = (forms.kana || []).map(k => k.text).filter(Boolean);
    const senses = entry.senses || [];
    const examples = entry.examples || [];

    let html = '';
    html += '<div class="dict-word">' + escapeHtml(entry.word) + '</div>';
    // 读音行：有汉字表记时显示假名；纯假名词条把其余变体标为「其他读音」
    const hasKanji = kanjiAll.length > 0;
    const kanaShow = kanaAll.filter(k => k !== entry.word);
    if (kanaShow.length > 0) {
        html += hasKanji
            ? '<div class="dict-phonetic ja-kana">' + escapeHtml(kanaAll.join('、')) + '</div>'
            : '<div class="ja-forms">其他读音　' + escapeHtml(kanaShow.join('、')) + '</div>';
    }
    // 其他汉字写法（主表记之外的）
    const otherKanji = kanjiAll.filter(k => k !== entry.word);
    if (otherKanji.length > 0) {
        html += '<div class="ja-forms">其他写法　' + escapeHtml(otherKanji.join('、')) + '</div>';
    }

    // 等级行（JMdict 词条级字段只有 jlpt；词性属于单条义项，放在义项行内）
    if (entry.jlpt) html += '<div class="ja-meta">' + escapeHtml(entry.jlpt) + '</div>';

    // 义项
    if (senses.length > 0) {
        html += '<div class="dict-section-title">释义</div><div class="ja-senses">';
        senses.forEach((s, i) => {
            const zh = (s.zh || []).join('；');
            const en = (s.en || []).join('; ');
            const pos = (s.pos || []).join(', ');
            html += '<div class="ja-sense">';
            html += '<div class="ja-sense-zh">' + (i + 1) + '. ';
            if (pos) html += '<span class="ja-pos">' + escapeHtml(pos) + '</span> ';
            html += escapeHtml(zh || '—');
            if (s.context) html += '<span class="ja-context">（' + escapeHtml(s.context) + '）</span>';
            html += '</div>';
            if (en) html += '<div class="ja-sense-en">' + escapeHtml(en) + '</div>';
            html += '</div>';
        });
        html += '</div>';
    }

    // 例句
    if (examples.length > 0) {
        html += '<div class="dict-section-title">例句</div><div class="ja-examples">';
        examples.forEach((x, i) => {
            html += '<div class="ja-example">';
            html += '<div class="ja-example-jp">' + (i + 1) + '. ' + escapeHtml(x.jp);
            if (x.level) html += '<span class="ja-example-lv">' + escapeHtml(x.level) + '</span>';
            html += '</div>';
            if (x.zh) html += '<div class="ja-example-zh">' + escapeHtml(x.zh) + '</div>';
            html += '</div>';
        });
        html += '</div>';
    }

    if (entry.entryId) {
        html += '<div class="ja-entry-id">JMdict ' + escapeHtml(entry.entryId) + ' · jmdict-cn · CC BY-SA 4.0</div>';
    }
    resultEl.innerHTML = html;
}

// ---------- 输入建议 ----------
function setupSuggestions() {
    const input = document.getElementById('searchInput');
    const suggestions = document.getElementById('suggestions');
    if (!input || !suggestions) return;

    let debounceTimer = null;
    let requestToken = 0;

    input.addEventListener('input', () => {
        const val = input.value.trim().toLowerCase();
        if (!val || !_dictReady) {
            suggestions.classList.add('hidden');
            return;
        }

        // 防抖：避免每次击键都触发数据库查询
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            const token = ++requestToken;
            const matches = await searchDictPrefix(val, 8, _currentDictId);
            // 输入已变化时丢弃过期结果，避免联想列表“倒序覆盖”
            if (token !== requestToken || input.value.trim().toLowerCase() !== val) return;

            if (matches.length === 0) {
                suggestions.classList.add('hidden');
                return;
            }
            suggestions.innerHTML = matches.map(m =>
                '<div class="word-item" style="cursor:pointer;" data-word="' + escapeHtml(m.word) + '">' + escapeHtml(m.word) + '</div>'
            ).join('');
            suggestions.classList.remove('hidden');
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

    // 支持 ?word=xxx：从背单词弹窗「查看详细」跳转而来，只填入输入框，不自动查询
    const params = new URLSearchParams(location.search);
    const urlWord = params.get('word');
    if (urlWord) {
        const input = document.getElementById('searchInput');
        if (input) {
            input.value = urlWord;
        }
    }

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
    hideLoading(); // 初始化完成，隐藏加载遮罩
    // 导入完成事件后刷新状态
    window.addEventListener('dictReady', refreshStatus);
});
