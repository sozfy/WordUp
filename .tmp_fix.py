# -*- coding: utf-8 -*-
import io, re

root = r'C:\Users\30746\Desktop\背单词'

def read_raw(p):
    with io.open(p, 'r', encoding='utf-8', newline='') as f:
        return f.read()
def write_raw(p, t, crlf):
    if crlf:
        t = t.replace('\r\n', '\n').replace('\n', '\r\n')
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(t)
def is_crlf(t):
    return '\r\n' in t

# ============ 1. script.js（LF） ============
p_js = root + r'\js\script.js'
j = read_raw(p_js)
assert '\r' not in j, 'script.js should be LF'
assert 'v=35' not in j  # 版本号只存在于 HTML

# 1.1 switchList 抑制拖后点击
old_sw = """function switchList(id) {
    const data = getWordData();"""
new_sw = """let _justDragged = false; // 拖动词表后短暂抑制随后的 click，避免拖动结束时误切换词表

function switchList(id) {
    if (_justDragged) { _justDragged = false; return; }
    const data = getWordData();"""
assert old_sw in j, 'MISS switchList'
j = j.replace(old_sw, new_sw, 1)

# 1.2 listDragEnd 设置 _justDragged
old_de = """function listDragEnd(e) {
    const item = e.target.closest('.sidebar-list-item');
    if (item) item.classList.remove('dragging');
    document.querySelectorAll('#sidebarLists .sidebar-list-item').forEach(el => {
        el.classList.remove('drag-over-before', 'drag-over-after');
    });
    _listDragFrom = -1;
}"""
new_de = """function listDragEnd(e) {
    const item = e.target.closest('.sidebar-list-item');
    if (item) item.classList.remove('dragging');
    document.querySelectorAll('#sidebarLists .sidebar-list-item').forEach(el => {
        el.classList.remove('drag-over-before', 'drag-over-after');
    });
    _listDragFrom = -1;
    // 拖动结束：短暂抑制随后的 click（防止拖动后误触发 switchList 切换词表）
    _justDragged = true;
    setTimeout(() => { _justDragged = false; }, 300);
}"""
assert old_de in j, 'MISS listDragEnd'
j = j.replace(old_de, new_de, 1)

# 1.3 drawWord 提前 return 分支补 updateRemainCount
# 917 单轮结束分支
old_917 = """        const hasResult = (list.roundKnown || []).length + (list.roundUnknown || []).length > 0;
        if (hasResult) {
            finishRound();
        } else {
            showToast('待抽取为空，请重置抽取或添加新单词', 'warning');
            document.getElementById('currentWord').textContent = "待抽取为空";
            document.getElementById('currentMeaning').textContent = "";
            document.getElementById('currentMeaning').classList.add('hidden');
            updatePhoneticDisplay();
            document.getElementById('startButton').disabled = false;
            document.getElementById('checkButton1').disabled = true;
            document.getElementById('checkButton2').disabled = true;
        }
        return;
    }"""
new_917 = """        const hasResult = (list.roundKnown || []).length + (list.roundUnknown || []).length > 0;
        updateRemainCount();
        if (hasResult) {
            finishRound();
        } else {
            showToast('待抽取为空，请重置抽取或添加新单词', 'warning');
            document.getElementById('currentWord').textContent = "待抽取为空";
            document.getElementById('currentMeaning').textContent = "";
            document.getElementById('currentMeaning').classList.add('hidden');
            updatePhoneticDisplay();
            document.getElementById('startButton').disabled = false;
            document.getElementById('checkButton1').disabled = true;
            document.getElementById('checkButton2').disabled = true;
        }
        return;
    }"""
assert old_917 in j, 'MISS 917'
j = j.replace(old_917, new_917, 1)

# 937 普通待抽取空分支
old_937 = """        updatePhoneticDisplay();
        document.getElementById('startButton').disabled = false;
        document.getElementById('checkButton1').disabled = true;
        document.getElementById('checkButton2').disabled = true;
        saveWordData(data);
        return;
    }

    // ---- 抽下一个 ----"""
new_937 = """        updatePhoneticDisplay();
        document.getElementById('startButton').disabled = false;
        document.getElementById('checkButton1').disabled = true;
        document.getElementById('checkButton2').disabled = true;
        saveWordData(data);
        updateRemainCount();
        return;
    }

    // ---- 抽下一个 ----"""
assert old_937 in j, 'MISS 937'
j = j.replace(old_937, new_937, 1)

# 961 队列空分支
old_961 = """            updatePhoneticDisplay();
            document.getElementById('startButton').disabled = false;
            document.getElementById('checkButton1').disabled = true;
            document.getElementById('checkButton2').disabled = true;
            return;
        }"""
new_961 = """            updatePhoneticDisplay();
            document.getElementById('startButton').disabled = false;
            document.getElementById('checkButton1').disabled = true;
            document.getElementById('checkButton2').disabled = true;
            updateRemainCount();
            return;
        }"""
assert old_961 in j, 'MISS 961'
j = j.replace(old_961, new_961, 1)

# 1003 抽词后单轮结束分支
old_1003 = """    // 单轮循环：本轮全部单词已抽完并显示（最后一个词刚显示），立即结束本轮弹出统计
    if (roundOn && !queueMode && list.pendingWords.length === 0) {
        finishRound();
        return;
    }"""
new_1003 = """    // 单轮循环：本轮全部单词已抽完并显示（最后一个词刚显示），立即结束本轮弹出统计
    if (roundOn && !queueMode && list.pendingWords.length === 0) {
        updateRemainCount();
        finishRound();
        return;
    }"""
assert old_1003 in j, 'MISS 1003'
j = j.replace(old_1003, new_1003, 1)

# 1.4 deleteCurrentWord 回调末尾补 updateRemainCount
old_del = """        if (list2.selectedWord && list2.selectedWord.word.toLowerCase() === lower) list2.selectedWord = null;
        saveWordData(data2);
        drawWord(1); // selectedWord 已清空：跳过判定，直接抽取/显示下一个
        showToast('已删除单词「' + word + '」', 'success');"""
new_del = """        if (list2.selectedWord && list2.selectedWord.word.toLowerCase() === lower) list2.selectedWord = null;
        saveWordData(data2);
        drawWord(1); // selectedWord 已清空：跳过判定，直接抽取/显示下一个
        updateRemainCount();
        showToast('已删除单词「' + word + '」', 'success');"""
assert old_del in j, 'MISS deleteCurrentWord'
j = j.replace(old_del, new_del, 1)

# 1.5 记录 lastJudgedWord（供点击"上一个单词"查看详细）
old_lj = """        // 记住本词表的上一个判定词，切换词表后仍可显示各自的上一个单词
        list.lastJudged = list.selectedWord.word + ' — ' + list.selectedWord.meaning;
        document.getElementById('lastWord').textContent = list.lastJudged;"""
new_lj = """        // 记住本词表的上一个判定词，切换词表后仍可显示各自的上一个单词
        list.lastJudged = list.selectedWord.word + ' — ' + list.selectedWord.meaning;
        list.lastJudgedWord = list.selectedWord.word;
        document.getElementById('lastWord').textContent = list.lastJudged;"""
assert old_lj in j, 'MISS lastJudged'
j = j.replace(old_lj, new_lj, 1)

# 1.6 applyResetDraw 清 lastJudgedWord
old_reset = """    list.lastJudged = null; // 先清空再保存，确保刷新后"上一个单词"不残留
    clearTimeout(_autoConfirmTimer); // 取消待定的自动跳转"""
new_reset = """    list.lastJudged = null; // 先清空再保存，确保刷新后"上一个单词"不残留
    list.lastJudgedWord = null;
    clearTimeout(_autoConfirmTimer); // 取消待定的自动跳转"""
assert old_reset in j, 'MISS reset'
j = j.replace(old_reset, new_reset, 1)

# 1.7 clearAllWords 清 lastJudgedWord
old_clr = """        list.lastJudged = null; // 先清空再保存，避免刷新后残留
        _memoryQueue = [];"""
new_clr = """        list.lastJudged = null; // 先清空再保存，避免刷新后残留
        list.lastJudgedWord = null;
        _memoryQueue = [];"""
assert old_clr in j, 'MISS clearAllWords'
j = j.replace(old_clr, new_clr, 1)

# 1.8 updateDraw 恢复 lastJudgedWord 点击目标（lastJudged 显示逻辑不变，lastJudgedWord 自动持久化）

# 1.9 单词详细弹窗函数（加在 viewListWords 之前）
old_vlw = """function viewListWords(id) {"""
new_vlw = """// ---------- 单词详细弹窗（点击"上一个单词"/当前单词/词表详细里的单词行查看完整释义） ----------
function showWordDetail(word) {
    const data = getWordData();
    if (!data) return;
    let hit = null;
    data.lists.forEach(list => {
        if (hit) return;
        const w = (list.words || []).find(x => String(x.word).toLowerCase() === String(word).toLowerCase());
        if (w) hit = { w: w, listName: list.name };
    });
    if (!hit) { showToast('未在词表中找到该单词', 'warning'); return; }
    document.getElementById('wdWord').textContent = hit.w.word;
    const phEl = document.getElementById('wdPhonetic');
    if (hit.w.phonetic) { phEl.textContent = '/' + hit.w.phonetic + '/'; phEl.classList.remove('hidden'); }
    else { phEl.textContent = ''; phEl.classList.add('hidden'); }
    const meaning = hit.w.meaning || hit.w.customMeaning || '(无释义)';
    document.getElementById('wdMeaning').textContent = normalizeNewlines(String(meaning));
    const mnEl = document.getElementById('wdMnemonic');
    if (hit.w.mnemonic) { mnEl.textContent = '助记：' + hit.w.mnemonic; mnEl.classList.remove('hidden'); }
    else { mnEl.textContent = ''; mnEl.classList.add('hidden'); }
    document.getElementById('wdSource').textContent = '来源词表：' + hit.listName;
    openModal('wordDetailModal');
}

function viewListWords(id) {"""
assert old_vlw in j, 'MISS viewListWords anchor'
j = j.replace(old_vlw, new_vlw, 1)

# 1.10 renderWordList 单词行可点击查看详细 + 删除按钮阻止冒泡
old_row = """        html += '<div class="word-item">';
        html += '  <div class="word-item-text">';"""
new_row = """        html += '<div class="word-item" onclick="showWordDetail(' + jsQuoteStr(item.word) + ')">';
        html += '  <div class="word-item-text">';"""
assert old_row in j, 'MISS word-item row'
j = j.replace(old_row, new_row, 1)

old_delbtn = """        html += '  <button class="word-item-del" title="删除单词" onclick="deleteWordFromList(' + jsQuoteStr(item.word) + ')">';"""
new_delbtn = """        html += '  <button class="word-item-del" title="删除单词" onclick="event.stopPropagation();deleteWordFromList(' + jsQuoteStr(item.word) + ')">';"""
assert old_delbtn in j, 'MISS word-item-del'
j = j.replace(old_delbtn, new_delbtn, 1)

# 1.11 init 绑定 lastWord / currentWord 点击查看详细（加在 footerBtns 绑定之后）
old_foot = """    // 绑定底部按钮事件
    const footerBtns = document.querySelectorAll('.footer-icon-btn');"""
new_foot = """    // 点击"上一个单词"查看详细（弹窗，不再跳转查单词页）
    const lastWordEl = document.getElementById('lastWord');
    if (lastWordEl) {
        lastWordEl.addEventListener('click', () => {
            const list = getActiveList();
            const w = list && (list.lastJudgedWord || (list.lastJudged ? list.lastJudged.split(' — ')[0] : ''));
            if (w) showWordDetail(w);
        });
    }
    // 点击当前显示单词查看详细（弹窗）
    const curWordEl = document.getElementById('currentWord');
    if (curWordEl) {
        curWordEl.addEventListener('click', () => {
            const list = getActiveList();
            if (list && list.selectedWord) showWordDetail(list.selectedWord.word);
        });
    }

    // 绑定底部按钮事件
    const footerBtns = document.querySelectorAll('.footer-icon-btn');"""
assert old_foot in j, 'MISS footer anchor'
j = j.replace(old_foot, new_foot, 1)

with io.open(p_js, 'w', encoding='utf-8', newline='') as f:
    f.write(j)
print('script.js ok')

# ============ 2. WordMemorizer.html（CRLF） ============
p_wm = root + r'\WordMemorizer.html'
h = read_raw(p_wm)
crlf = is_crlf(h)

# 2.1 sidebar-batch-bar 加"添加词表"按钮
old_bar = """        <div class="sidebar-batch-bar" id="sidebarBatchBar">
            <button type="button" class="batch-toggle-btn" id="batchToggleBtn" onclick="toggleBatchDelete()">批量删除</button>
        </div>"""
new_bar = """        <div class="sidebar-batch-bar" id="sidebarBatchBar">
            <button type="button" class="batch-toggle-btn" id="batchToggleBtn" onclick="toggleBatchDelete()">批量删除</button>
            <button type="button" class="new-list-side-btn" onclick="openModal('newListModal')">添加词表</button>
        </div>"""
assert old_bar in h, 'MISS sidebar batch bar'
h = h.replace(old_bar, new_bar, 1)

# 2.2 wordDetailModal（插在 listModal 结束后）
old_modal_end = """            </div>
        </div>
    </div>

    <!--中心-->
    <main class="main-content">"""
new_modal_end = """            </div>
        </div>
    </div>

    <!-- 单词详细弹窗 -->
    <div class="modal-overlay" id="wordDetailModal">
        <div class="modal">
            <div class="modal-header">
                <span>单词详细</span>
                <button class="modal-close" onclick="closeModal('wordDetailModal')"><svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M2.59 2.72l.06-.07a.5.5 0 01.63-.06l.07.06L8 7.29l4.65-4.64a.5.5 0 01.7.7L8.71 8l4.64 4.65c.18.17.2.44.06.63l-.06.07a.5.5 0 01-.63.06l-.07-.06L8 8.71l-4.65 4.64a.5.5 0 01-.7-.7L7.29 8 2.65 3.35a.5.5 0 01-.06-.63l.06-.07-.06.07z"></path></svg></button>
            </div>
            <div class="modal-body">
                <div class="wd-word" id="wdWord"></div>
                <div class="wd-phonetic" id="wdPhonetic"></div>
                <div class="wd-source" id="wdSource"></div>
                <div class="wd-section-title">完整释义</div>
                <div class="wd-meaning" id="wdMeaning"></div>
                <div class="wd-mnemonic hidden" id="wdMnemonic"></div>
            </div>
        </div>
    </div>

    <!--中心-->
    <main class="main-content">"""
assert old_modal_end in h, 'MISS wordDetailModal anchor'
h = h.replace(old_modal_end, new_modal_end, 1)

# 2.3 bump 版本
h = h.replace('js/script.js?v=35', 'js/script.js?v=36', 1)
h = h.replace('css/style.css?v=113', 'css/style.css?v=114', 1)
write_raw(p_wm, h, crlf)
print('WordMemorizer.html ok')

# ============ 3. css/style.css（LF） ============
p_css = root + r'\css\style.css'
c = read_raw(p_css).replace('\r\n', '\n')
assert '\r' not in c

old_css_bar = """.sidebar-batch-bar {
    display: flex;
    justify-content: flex-end;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    flex: 0 0 auto;
}
.batch-toggle-btn {
    flex: 0 0 auto;
    padding: 4px 10px;
    font-size: 0.8rem;
    margin: 0;
    background: transparent;
    color: var(--highlight);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
}
.batch-toggle-btn:hover {
    background-color: var(--bg-panel);
}"""
new_css_bar = """.sidebar-batch-bar {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    flex: 0 0 auto;
}
.batch-toggle-btn,
.new-list-side-btn {
    flex: 0 0 auto;
    padding: 4px 10px;
    font-size: 0.8rem;
    margin: 0;
    background: transparent;
    color: var(--danger);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
}
.batch-toggle-btn:hover,
.new-list-side-btn:hover {
    background-color: var(--bg-panel);
}"""
assert old_css_bar in c, 'MISS css bar'
c = c.replace(old_css_bar, new_css_bar, 1)

# 词表详细单词行可点击 + 单词详细弹窗样式
css_add = """
/* ---------- 单词详细弹窗 ---------- */
.word-item {
    cursor: pointer;
}
.wd-word {
    font-size: 1.4rem;
    font-weight: bold;
    color: var(--white);
}
.wd-phonetic {
    margin-top: 4px;
    font-size: 0.95rem;
    color: var(--text-secondary);
}
.wd-source {
    margin-top: 4px;
    font-size: 0.8rem;
    color: var(--text-secondary);
    opacity: .8;
}
.wd-section-title {
    margin-top: 12px;
    font-size: 0.8rem;
    color: var(--text-secondary);
}
.wd-meaning {
    margin-top: 4px;
    font-size: 1.05rem;
    color: var(--success);
    white-space: pre-wrap;
    word-break: break-word;
}
.wd-mnemonic {
    margin-top: 10px;
    font-size: 0.9rem;
    color: var(--text-secondary);
}
"""
assert c.rstrip().endswith('}')
c = c.rstrip() + '\n' + css_add
with io.open(p_css, 'w', encoding='utf-8', newline='') as f:
    f.write(c)
print('css ok')

# ============ 4. dict.js（LF）：词典未命中时查用户词表 ============
p_dict = root + r'\js\dict.js'
d = read_raw(p_dict)
assert '\r' not in d

old_search = """    // 直接从当前词典的 IndexedDB 查询
    const entry = await lookupWord(word, _currentDictId);
    if (entry) {
        renderResult(entry);
    } else {"""
new_search = """    // 直接从当前词典的 IndexedDB 查询
    const entry = await lookupWord(word, _currentDictId);
    if (entry) {
        renderResult(entry);
        return;
    }
    // 词典未命中：从用户词表中查找（自定义词/词表词，如背单词页添加的 # 自定义意思）
    const listHit = await lookupWordInLists(word);
    if (listHit) {
        renderListWordResult(listHit);
        return;
    }
    {"""
assert old_search in d, 'MISS dict search'
d = d.replace(old_search, new_search, 1)

# 加 lookupWordInLists + renderListWordResult（加在 renderResult 之前）
old_rr = """// ---------- 渲染查询结果 ----------
function renderResult(entry) {"""
new_rr = """// 从用户词表中查找单词（自定义词/词表词，词典中查不到时兜底显示）
async function lookupWordInLists(word) {
    try { if (typeof initWordDataCache === 'function') await initWordDataCache(); } catch (e) { return null; }
    if (typeof getWordData !== 'function') return null;
    const data = getWordData();
    if (!data) return null;
    const lower = String(word).toLowerCase();
    for (const list of data.lists) {
        const w = (list.words || []).find(x => String(x.word).toLowerCase() === lower);
        if (w) return { word: w.word, meaning: w.meaning || w.customMeaning || '', phonetic: w.phonetic || '', mnemonic: w.mnemonic || null, _listName: list.name };
    }
    return null;
}

// 渲染词表命中结果
function renderListWordResult(hit) {
    const resultEl = document.getElementById('dictResult');
    const meaning = hit.meaning || '(无释义)';
    let html = '<div class="dict-word">' + escapeHtml(hit.word) + '</div>';
    if (hit.phonetic) html += '<div class="dict-phonetic">/' + escapeHtml(hit.phonetic) + '/</div>';
    html += '<div class="dict-section-title">词表释义（来源：' + escapeHtml(hit._listName) + '）</div>';
    html += '<div class="dict-translation">' + escapeHtml(normalizeNewlines(String(meaning))) + '</div>';
    if (hit.mnemonic) html += '<div class="dict-section-title">助记</div><div class="dict-translation">' + escapeHtml(String(hit.mnemonic)) + '</div>';
    resultEl.innerHTML = html;
}

// ---------- 渲染查询结果 ----------
function renderResult(entry) {"""
assert old_rr in d, 'MISS renderResult anchor'
d = d.replace(old_rr, new_rr, 1)

with io.open(p_dict, 'w', encoding='utf-8', newline='') as f:
    f.write(d)
print('dict.js ok')

# ============ 5. 版本号 bump（四页 css v114、DictLookup dict.js v10） ============
for fn in ['WordMemorizer.html', 'MyLists.html', 'DictLookup.html', 'index.html']:
    fp = root + '\\' + fn
    t = read_raw(fp)
    crlf2 = is_crlf(t)
    t2 = t.replace('css/style.css?v=113', 'css/style.css?v=114')
    if fn == 'DictLookup.html':
        t2 = t2.replace('js/dict.js?v=9', 'js/dict.js?v=10')
    if t2 != t:
        write_raw(fp, t2, crlf2)
        print(fn, 'bumped', 'CRLF' if crlf2 else 'LF')
    else:
        print(fn, 'no change')
