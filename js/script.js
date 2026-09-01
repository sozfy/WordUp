// ========== 背单词核心逻辑 ==========

// ---------- 侧边栏菜单 ----------
function openSidebar() {
    document.getElementById('sidebarMenu').classList.add('open');
    document.getElementById('overlayLayer').classList.add('visible');
    document.body.style.overflow = 'hidden';
    const fmb = document.getElementById('floatingMenuBtn');
    if (fmb) fmb.classList.add('hidden');
}

function closeSidebar() {
    document.getElementById('sidebarMenu').classList.remove('open');
    document.getElementById('overlayLayer').classList.remove('visible');
    document.body.style.overflow = '';
    const fmb = document.getElementById('floatingMenuBtn');
    if (fmb) fmb.classList.remove('hidden');
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebarMenu');
    if (sidebar.classList.contains('open')) {
        closeSidebar();
    } else {
        openSidebar();
    }
}

// ---------- 弹窗 ----------
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.add('visible');
        document.body.style.overflow = 'hidden';
        if (id === 'newListModal') {
            loadPresetOptions();
        }
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.remove('visible');
        const anyOpen = document.querySelector('.modal-overlay.visible');
        if (!anyOpen) {
            document.body.style.overflow = '';
        }
    }
}

// ---------- 工具函数 ----------
// escapeHtml / showToast / showConfirm / showPrompt 等由 common.js 提供
function genListId() {
    return 'list_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

// ---------- 存储相关函数 ----------
// 内存缓存：包含完整单词对象（含 meaning），保存到 IndexedDB 时剥离 meaning
let _wordDataCache = null;

// ---------- IndexedDB 单词数据存储（词表/单词持久化） ----------
const WORD_DB_NAME = 'WordMemorizerData';
const WORD_DB_STORE = 'wordData';
const WORD_DB_VERSION = 1;
const WORD_DB_KEY = 'main';

function openWordDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(WORD_DB_NAME, WORD_DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(WORD_DB_STORE)) {
                db.createObjectStore(WORD_DB_STORE); // 无 keyPath，用 put(value, key)
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// 读取单词数据；首次运行时自动从旧版 localStorage 迁移
async function loadWordData() {
    try {
        const db = await openWordDB();
        const stored = await new Promise((resolve) => {
            const tx = db.transaction(WORD_DB_STORE, 'readonly');
            const req = tx.objectStore(WORD_DB_STORE).get(WORD_DB_KEY);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
        if (stored) return stored;

        // 无 IndexedDB 数据：尝试从旧版 localStorage 迁移 wordData
        try {
            const raw = localStorage.getItem('wordData');
            if (raw) {
                let legacy = JSON.parse(raw);
                // 数据迁移：旧格式 { allWords, pendingWords, selectedWord }
                if (legacy.allWords !== undefined && !legacy.lists) {
                    const migratedList = {
                        id: genListId(),
                        name: '我的单词',
                        words: legacy.allWords || [],
                        pendingWords: legacy.pendingWords || [],
                        selectedWord: legacy.selectedWord || null
                    };
                    legacy = { activeListId: migratedList.id, lists: [migratedList] };
                }
                const ok = await writeWordData(legacy);
                if (ok) {
                    try { localStorage.removeItem('wordData'); } catch (e) {} // 迁移成功后再清除旧数据
                }
                return legacy;
            }
        } catch (e) { /* localStorage 数据损坏则忽略 */ }

        return null; // 无历史数据
    } catch (e) {
        return null;
    }
}

// 写入 IndexedDB（传入的 data 已剥离 meaning）
async function writeWordData(data) {
    try {
        const db = await openWordDB();
        return await new Promise((resolve) => {
            const tx = db.transaction(WORD_DB_STORE, 'readwrite');
            const req = tx.objectStore(WORD_DB_STORE).put(data, WORD_DB_KEY);
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
        });
    } catch (e) {
        return false;
    }
}

async function initStorage() {
    _wordDataCache = await loadWordData();
    if (!_wordDataCache) {
        const defaultList = {
            id: genListId(),
            name: '默认词表',
            words: [],
            pendingWords: [],
            selectedWord: null
        };
        _wordDataCache = { activeListId: defaultList.id, lists: [defaultList] };
        saveWordData(_wordDataCache);
    }
    // 异步从词典加载释义（IndexedDB 中不存 meaning）
    loadAllMeanings();
}

// 从词典批量查询所有单词的释义，填充到内存缓存
async function loadAllMeanings() {
    if (!_wordDataCache) return;
    const allWords = new Set();
    _wordDataCache.lists.forEach(list => {
        (list.words || []).forEach(w => allWords.add(w.word));
        (list.pendingWords || []).forEach(w => allWords.add(w.word));
        if (list.selectedWord) allWords.add(list.selectedWord.word);
    });
    if (allWords.size === 0) return;
    const entries = await lookupWords(Array.from(allWords));
    _wordDataCache.lists.forEach(list => {
        (list.words || []).forEach(w => {
            const e = entries.get(w.word.toLowerCase());
            if (e) {
                w.meaning = normalizeNewlines(e.translation || e.definition || '(无释义)');
            } else if (!w.meaning) {
                w.meaning = '(无释义)';
            }
        });
        (list.pendingWords || []).forEach(w => {
            const e = entries.get(w.word.toLowerCase());
            if (e) {
                w.meaning = normalizeNewlines(e.translation || e.definition || '(无释义)');
            } else if (!w.meaning) {
                w.meaning = '(无释义)';
            }
        });
        if (list.selectedWord) {
            const e = entries.get(list.selectedWord.word.toLowerCase());
            if (e) {
                list.selectedWord.meaning = normalizeNewlines(e.translation || e.definition || '(无释义)');
            } else if (!list.selectedWord.meaning) {
                list.selectedWord.meaning = '(无释义)';
            }
        }
    });
    // 释义加载完成后刷新 UI
    renderSidebarLists();
    refreshCurrentList();
    updateDraw();
}

function getWordData() {
    return _wordDataCache;
}

function saveWordData(data) {
    _wordDataCache = data;
    // 剥离 meaning 后保存（只存 word + mnemonic）
    const stripped = JSON.parse(JSON.stringify(data));
    stripped.lists.forEach(list => {
        (list.words || []).forEach(w => { delete w.meaning; });
        (list.pendingWords || []).forEach(w => { delete w.meaning; });
        if (list.selectedWord) { delete list.selectedWord.meaning; }
    });
    writeWordData(stripped); // 写入 IndexedDB
}

function getActiveList(data) {
    const d = data || getWordData();
    return d.lists.find(l => l.id === d.activeListId) || d.lists[0];
}

// ---------- 列表管理 ----------
// 生成不重复的词表名称：已存在则加序号（中考、中考1、中考2...）
// excludeId：改名场景下排除自身，避免改回原名被误判重名
function uniqueListName(baseName, excludeId) {
    const data = getWordData();
    let name = baseName;
    let seq = 1;
    while (data.lists.some(l => l.name === name && l.id !== excludeId)) {
        name = baseName + seq;
        seq++;
    }
    return name;
}
function createList() {
    const input = document.getElementById('newListName');
    const baseName = input.value.trim();
    if (!baseName) {
        showToast('请输入词表名称', 'error');
        return;
    }
    const data = getWordData();
    const name = uniqueListName(baseName);
    const newList = {
        id: genListId(),
        name: name,
        words: [],
        pendingWords: [],
        selectedWord: null
    };
    data.lists.push(newList);
    data.activeListId = newList.id;
    saveWordData(data);
    input.value = '';
    closeModal('newListModal');
    renderSidebarLists();
    updateDraw();
    closeSidebar();
}

function renameList(id) {
    const data = getWordData();
    const list = data.lists.find(l => l.id === id);
    if (!list) return;
    showPrompt('请输入新的词表名称：', list.name, (val) => {
        const trimmed = (val || '').trim();
        if (!trimmed) {
            showToast('词表名称不能为空', 'error');
            return;
        }
        list.name = uniqueListName(trimmed, list.id);
        saveWordData(data);
        renderSidebarLists();
        updateActiveListName();
    });
}

function deleteList(id) {
    const data = getWordData();
    const list = data.lists.find(l => l.id === id);
    if (!list) return;
    const isLast = data.lists.length <= 1;
    const tip = isLast ? '这是最后一个词表，删除后将自动创建一个空的默认词表。' : '';
    showConfirm('确定删除词表"' + list.name + '"吗？该词表下的所有单词将被删除，无法恢复！' + tip, () => {
        data.lists = data.lists.filter(l => l.id !== id);
        if (data.lists.length === 0) {
            // 删除最后一个列表后，自动生成一个空的默认列表
            data.lists.push({
                id: genListId(),
                name: '默认列表',
                words: [],
                pendingWords: [],
                selectedWord: null
            });
        }
        if (data.activeListId === id) {
            data.activeListId = data.lists[0].id;
        }
        saveWordData(data);
        renderSidebarLists();
        updateDraw();
        refreshCurrentList();
    });
}

function switchList(id) {
    const data = getWordData();
    if (data.activeListId === id) {
        closeSidebar();
        return;
    }
    data.activeListId = id;
    saveWordData(data);
    renderSidebarLists();
    updateDraw();
    refreshCurrentList();
    closeSidebar();
}

// 刷新合并词表下拉框（列出除当前词表外的所有词表）
function refreshMergeSelect() {
    const data = getWordData();
    const current = getActiveList(data);
    const sel = document.getElementById('mergeSelect');
    if (!sel) return;
    const prev = sel.value;
    const others = data.lists.filter(l => l.id !== current.id);
    sel.innerHTML = '<option value="">选择要合并的词表...</option>' +
        others.map(l => '<option value="' + l.id + '"' + (l.id === prev ? ' selected' : '') + '>' +
            escapeHtml(l.name) + '（' + l.words.length + '词）</option>').join('');
}

// 合并词表：将所选词表的单词并入当前词表（按单词去重），并删除所选词表
function mergeList() {
    const data = getWordData();
    const current = getActiveList(data);
    const sel = document.getElementById('mergeSelect');
    const targetId = sel ? sel.value : '';
    if (!targetId) {
        showToast('请先选择要合并的词表', 'error');
        return;
    }
    const target = data.lists.find(l => l.id === targetId);
    if (!target) {
        showToast('所选词表不存在', 'error');
        return;
    }
    // 将目标词表的单词并入当前词表（按单词去重）
    const existing = new Set(current.words.map(w => w.word.toLowerCase()));
    let added = 0;
    target.words.forEach(w => {
        if (!existing.has(w.word.toLowerCase())) {
            current.words.push(w);
            existing.add(w.word.toLowerCase());
            added++;
        }
    });
    const targetName = target.name;
    data.lists = data.lists.filter(l => l.id !== target.id);
    saveWordData(data);
    renderSidebarLists();
    refreshCurrentList();
    refreshMergeSelect();
    updateDraw();
    updateRemainCount();
    // 合并结束后对当前词表自动重置抽取记录
    applyResetDraw();
    showToast('已将"' + targetName + '"的单词合并到"' + current.name + '"，新增 ' + added + ' 个单词', 'success');
}

function viewListWords(id) {
    switchList(id);
    openModal('listModal');
    refreshMergeSelect();
}

function renderSidebarLists() {
    const data = getWordData();
    const container = document.getElementById('sidebarLists');
    let html = '';
    data.lists.forEach(list => {
        const isActive = list.id === data.activeListId;
        html += '<div class="sidebar-list-item' + (isActive ? ' active' : '') + '">';
        html += '  <div class="list-item-info" onclick="switchList(\'' + list.id + '\')">';
        html += '    <span class="list-item-name">' + escapeHtml(list.name) + '</span>';
        html += '    <span class="list-item-count">' + list.words.length + ' 词</span>';
        html += '  </div>';
        html += '  <div class="list-item-actions">';
        html += '    <button class="list-action-btn" title="查看单词" onclick="viewListWords(\'' + list.id + '\')">';
        html += '      <svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor"><path d="M512 256c-141.4 0-260.8 82.2-320 200.5C251.2 574.2 370.6 656 512 656s260.8-82.2 320-200.5C772.8 338.2 653.4 256 512 256zm0 320c-66.3 0-120-53.7-120-120s53.7-120 120-120 120 53.7 120 120-53.7 120-120 120z"/></svg>';
        html += '    </button>';
        html += '    <button class="list-action-btn" title="重命名" onclick="renameList(\'' + list.id + '\')">';
        html += '      <svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor"><path d="M853.333 128a149.333 149.333 0 00-210.667 0L164.267 632.533a130.133 130.133 0 00-34.134 61.867L52.267 885.333a31.25 31.25 0 0037.333 37.333l190.934-45.867a130.133 130.133 0 0061.866-34.133L853.333 337.067a149.333 149.333 0 000-210.667zm-166.4 44.8a86.4 86.4 0 11122.134 122.134l-37.333 37.333L669.867 213.333l17.067-17.067zM625.067 252.8l121.6 121.6-416 416a66.133 66.133 0 01-31.467 17.067l-142.933 34.133 34.133-142.933a66.133 66.133 0 0117.067-31.467l416-416z"/></svg>';
        html += '    </button>';
        html += '    <button class="list-action-btn danger" title="删除词表" onclick="deleteList(\'' + list.id + '\')">';
        html += '      <svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor"><path d="M360 184h-8c4.4 0 8-3.6 8-8v8h304v-8c0 4.4 3.6 8 8 8h-8v72h72v-80c0-35.3-28.7-64-64-64H352c-35.3 0-64 28.7-64 64v80h72v-72zm504 72H160c-17.7 0-32 14.3-32 32v32c0 4.4 3.6 8 8 8h60.4l24.7 523c1.6 34.1 29.8 61 63.9 61h454c34.2 0 62.3-26.9 63.9-61l24.7-523H888c4.4 0 8-3.6 8-8v-32c0-17.7-14.3-32-32-32zM731.3 840H292.7l-24.2-512h487l-24.2 512z"/></svg>';
        html += '    </button>';
        html += '  </div>';
        html += '</div>';
    });
    container.innerHTML = html;
}

function updateActiveListName() {
    const list = getActiveList();
    const name = list ? list.name : '无';
    document.getElementById('activeListName').textContent = '当前列表：' + name;
    document.getElementById('addModalListName').textContent = name;
    document.getElementById('listModalName').textContent = name;
}

// ---------- UI 更新辅助函数 ----------
function updateRemainCount() {
    const list = getActiveList();
    document.getElementById('remainCount').textContent = '待抽取个数：' + list.pendingWords.length;
}

// ---------- 选项设置：个数（3~6）与详细释义 ----------
function getOptionCount() {
    const sel = document.getElementById('optionCountSelect');
    let n = sel ? parseInt(sel.value, 10) : 4;
    if (!n || n < 3 || n > 6) n = 4;
    return n;
}

function applyOptionCount() {
    const sel = document.getElementById('optionCountSelect');
    if (!sel) return;
    try { localStorage.setItem('optionCount', sel.value); } catch (e) {}
    createOptions();
    showOption();
}

function isDetailMeaningOn() {
    const d = document.getElementById('detailMeaningBtn');
    return !!(d && d.checked);
}

function applyDetailMeaning() {
    const d = document.getElementById('detailMeaningBtn');
    if (!d) return;
    try { localStorage.setItem('detailMeaningMode', d.checked ? '1' : '0'); } catch (e) {}
    createOptions();
    showOption();
}

function showOption() {
    const optionDiv = document.getElementById('optionDiv');
    const list = getActiveList();
    // 互斥：开启选择题时自动关闭拼写
    const switchBtn = document.getElementById('switchBtn');
    const spellBtn = document.getElementById('spellBtn');
    if (switchBtn && spellBtn && switchBtn.checked && spellBtn.checked) {
        spellBtn.checked = false;
        try { localStorage.setItem('spellMode', '0'); } catch (e) {}
        updateSpellInput();
    }
    const switchOn = !!(switchBtn && switchBtn.checked);
    const enoughWords = list.words && list.words.length >= getOptionCount();
    if (switchOn && enoughWords) {
        optionDiv.classList.remove('hidden');
    } else {
        optionDiv.classList.add('hidden');
    }
    // 开启选项时显示"选项个数 / 详细释义"详细设置分组
    const subBox = document.getElementById('optionSubBox');
    if (subBox) subBox.classList.toggle('hidden', !switchOn);
}

// 记录当前显示的词表 id，用于在切换词表时清空"上一个单词"等瞬时信息
let _lastActiveListId = null;

function updateDraw() {
    updateActiveListName();
    updateRemainCount();
    createOptions();
    showOption();

    const list = getActiveList();
    document.getElementById('startButton').disabled = true;
    // showButton 常开，不设置 disabled
    document.getElementById('checkButton1').disabled = true;
    document.getElementById('checkButton2').disabled = true;

    if (list.selectedWord) {
        const swap = isSwapOn();
        const meaningText = flattenNewlines(list.selectedWord.meaning);
        document.getElementById('currentWord').textContent = swap ? meaningText : list.selectedWord.word;
        document.getElementById('currentMeaning').textContent = swap ? list.selectedWord.word : meaningText;
        document.getElementById('currentMeaning').classList.add('hidden');
    } else {
        document.getElementById('startButton').disabled = false;
        // 词表尚未开始抽取：清空主显示区，避免残留上一词表的单词/释义
        document.getElementById('currentWord').textContent = '点击开始抽取单词';
        document.getElementById('currentMeaning').textContent = '';
        document.getElementById('currentMeaning').classList.add('hidden');
    }
    // 切换词表时更新"上一个单词"为该词表自己的判定词（无则显示占位），并清空拼写输入
    if (_lastActiveListId !== list.id) {
        _lastActiveListId = list.id;
        document.getElementById('lastWord').textContent = list.lastJudged || '上一个单词';
        const spellInputEl = document.getElementById('spellInput');
        if (spellInputEl) {
            spellInputEl.value = '';
            spellInputEl.style.color = '';
        }
    }
}

// ---------- 单词列表渲染 ----------
function renderWordList(wordArray) {
    const displayEl = document.getElementById('wordListDisplay');
    const countEl = document.getElementById('wordCount');

    // 按字典顺序排列显示（复制排序，不改变存储顺序）
    const sorted = wordArray.slice().sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()));

    countEl.textContent = '单词总数：' + sorted.length;

    if (sorted.length === 0) {
        displayEl.innerHTML = '<div class="word-item">暂无单词</div>';
        return;
    }

    let html = '';
    sorted.forEach((item, index) => {
        html += '<div class="word-item">' + (index + 1) + '. ' + escapeHtml(item.word) + ' —— ' + escapeHtml(normalizeNewlines(item.meaning)) + '</div>';
    });
    displayEl.innerHTML = html;
}

function refreshCurrentList() {
    const list = getActiveList();
    renderWordList(list.words);
}

// ---------- 选项相关逻辑 ----------
let optionsText = [];

function disableOptionButtons() {
    for (let i = 1; i <= 6; i++) {
        const btn = document.getElementById("optionButton" + i);
        if (btn) btn.disabled = true;
    }
}

// 将选项按钮恢复为占位文本（切换词表/未开始抽取时清空残留选项）
function resetOptionText() {
    for (let i = 1; i <= 6; i++) {
        const btn = document.getElementById("optionButton" + i);
        if (btn) btn.textContent = '选项' + i;
    }
}

function createOptions() {
    const count = getOptionCount();
    for (let i = 1; i <= 6; i++) {
        const btn = document.getElementById("optionButton" + i);
        if (!btn) continue;
        btn.style.backgroundColor = '';
        btn.style.whiteSpace = '';
        btn.style.wordBreak = '';
        btn.style.display = (i <= count) ? '' : 'none';
        btn.classList.remove('detail');
        btn.disabled = false;
    }

    const list = getActiveList();
    if (!list.words || list.words.length < count) {
        document.getElementById('optionDiv').classList.add('hidden');
        resetOptionText();
        disableOptionButtons();
        return;
    }
    // 未抽取单词时禁用选项按钮并清空残留文本，避免切换词表后串词
    if (!list.selectedWord) {
        resetOptionText();
        disableOptionButtons();
        return;
    }

    if (document.getElementById('switchBtn').checked) {
        document.getElementById('optionDiv').classList.remove('hidden');
    }

    const rightPos = Math.floor(Math.random() * count);

    const wrong = [];
    while (wrong.length < count - 1) {
        const candidate = list.words[Math.floor(Math.random() * list.words.length)];
        if (candidate.word !== list.selectedWord.word && !wrong.includes(candidate)) {
            wrong.push(candidate);
        }
    }

    optionsText = wrong.slice(0, count - 1);
    optionsText.splice(rightPos, 0, list.selectedWord);

    const swap = isSwapOn();
    const full = isDetailMeaningOn();
    for (let i = 1; i <= count; i++) {
        const btn = document.getElementById("optionButton" + i);
        const item = optionsText[i - 1];
        if (swap) {
            btn.innerText = item.word;
        } else {
            btn.innerText = flattenNewlines(item.meaning);
            btn.classList.toggle('detail', full);
        }
    }
}

function isOptionCorrect(num) {
    const list = getActiveList();
    const selectedOption = optionsText[num - 1];
    const count = getOptionCount();

    // 先重置所有选项样式（允许重新选择）
    const full = isDetailMeaningOn();
    const swap = isSwapOn();
    for (let i = 1; i <= count; i++) {
        const btn = document.getElementById("optionButton" + i);
        btn.style.backgroundColor = '';
        btn.style.whiteSpace = '';
        btn.style.wordBreak = '';
        btn.classList.toggle('detail', full);
        const item = optionsText[i - 1];
        btn.innerText = swap ? item.word : flattenNewlines(item.meaning);
    }

    // 标记当前选中项
    const btnId = "optionButton" + num;
    const markedBtn = document.getElementById(btnId);
    if (selectedOption.word === list.selectedWord.word) {
        markedBtn.innerText = '√ ' + selectedOption.word + '-' + flattenNewlines(selectedOption.meaning);
        markedBtn.style.backgroundColor = '#67c23a';
    } else {
        markedBtn.innerText = '× ' + selectedOption.word + '-' + flattenNewlines(selectedOption.meaning);
        markedBtn.style.backgroundColor = '#f56c6c';
    }
    // 作答后允许换行显示完整内容，避免窄屏截断释义
    markedBtn.style.whiteSpace = 'normal';
    markedBtn.style.wordBreak = 'break-word';

    // 点击选项后显示当前单词的意思（选择题模式）
    const meaningEl = document.getElementById('currentMeaning');
    if (meaningEl) meaningEl.classList.remove('hidden');
    document.getElementById('checkButton1').disabled = false;
    document.getElementById('checkButton2').disabled = false;
}

// ---------- 核心抽取逻辑 ----------
function drawWord(num) {
    // 判定后清空拼写输入框并复原颜色
    const spellInputEl = document.getElementById('spellInput');
    if (spellInputEl) {
        spellInputEl.value = '';
        spellInputEl.style.color = '';
    }

    const data = getWordData();
    const list = getActiveList(data);
    const roundBtn = document.getElementById('roundBtn');
    const roundOn = !!(roundBtn && roundBtn.checked);

    // ---- 记录当前选中词的判定 ----
    if (list.selectedWord) {
        if (roundOn) {
            // 单轮循环：认识/不认识均不放回，仅记录判定
            list.roundKnown = list.roundKnown || [];
            list.roundUnknown = list.roundUnknown || [];
            const w = list.selectedWord.word;
            if (num === 0) {
                if (!list.roundUnknown.includes(w)) list.roundUnknown.push(w);
            } else {
                if (!list.roundKnown.includes(w)) list.roundKnown.push(w);
            }
        } else if (num === 0) {
            // 普通模式：不认识放回待抽取
            list.pendingWords.push(list.selectedWord);
        }
        // 记住本词表的上一个判定词，切换词表后仍可显示各自的上一个单词
        list.lastJudged = list.selectedWord.word + ' — ' + list.selectedWord.meaning;
        document.getElementById('lastWord').textContent = list.lastJudged;
    }

    // ---- 单轮循环：本轮已抽完 ----
    if (roundOn && list.pendingWords.length === 0) {
        list.selectedWord = null;
        saveWordData(data);
        const hasResult = (list.roundKnown || []).length + (list.roundUnknown || []).length > 0;
        if (hasResult) {
            finishRound();
        } else {
            showToast('待抽取为空，请重置抽取或添加新单词', 'warning');
            document.getElementById('currentWord').textContent = "待抽取为空";
            document.getElementById('currentMeaning').textContent = "";
            document.getElementById('currentMeaning').classList.add('hidden');
            document.getElementById('startButton').disabled = false;
            document.getElementById('checkButton1').disabled = true;
            document.getElementById('checkButton2').disabled = true;
        }
        return;
    }

    // ---- 普通模式：待抽取为空 ----
    if (list.pendingWords.length === 0) {
        list.selectedWord = null;
        showToast('待抽取为空，请重置抽取或添加新单词', 'warning');
        document.getElementById('currentWord').textContent = "待抽取为空";
        document.getElementById('currentMeaning').textContent = "";
        document.getElementById('currentMeaning').classList.add('hidden');
        document.getElementById('startButton').disabled = false;
        document.getElementById('checkButton1').disabled = true;
        document.getElementById('checkButton2').disabled = true;
        saveWordData(data);
        return;
    }

    // ---- 抽新词 ----
    const randomIndex = Math.floor(Math.random() * list.pendingWords.length);
    list.selectedWord = list.pendingWords.splice(randomIndex, 1)[0];
    saveWordData(data);

    const swap = isSwapOn();
    const meaningText = flattenNewlines(list.selectedWord.meaning);
    document.getElementById('currentWord').textContent = swap ? meaningText : list.selectedWord.word;
    document.getElementById('currentMeaning').textContent = swap ? list.selectedWord.word : meaningText;
    document.getElementById('currentMeaning').classList.add('hidden');

    // 显示意思按钮常开；认识/不认识需先点一次显示意思
    document.getElementById('checkButton1').disabled = true;
    document.getElementById('checkButton2').disabled = true;

    // 重新激活选项按钮（多余按钮由 createOptions 隐藏）
    for (let i = 1; i <= 6; i++) {
        const btn = document.getElementById("optionButton" + i);
        if (btn) btn.disabled = false;
    }

    createOptions();
    refreshCurrentList();
    updateRemainCount();
}

function startDraw() {
    document.getElementById('startButton').disabled = true;
    drawWord(1);
}

function toggleMeaning() {
    const list = getActiveList();
    if (!list || !list.selectedWord) return;
    const meaningEl = document.getElementById('currentMeaning');
    const wasHidden = meaningEl.classList.contains('hidden');
    if (wasHidden) {
        meaningEl.classList.remove('hidden');
        // 首次显示时激活认识/不认识
        document.getElementById('checkButton1').disabled = false;
        document.getElementById('checkButton2').disabled = false;
        // 词意互换 + 拼写同时开启：点击显示单词时比对拼写输入框并着色
        const spellInputEl = document.getElementById('spellInput');
        const spellBtn = document.getElementById('spellBtn');
        if (spellInputEl && isSwapOn() && spellBtn && spellBtn.checked) {
            const typed = (spellInputEl.value || '').trim().toLowerCase();
            const target = String(list.selectedWord.word || '').toLowerCase();
            spellInputEl.style.color = (typed === target) ? '#67c23a' : '#f56c6c';
        }
    } else {
        meaningEl.classList.add('hidden');
    }
}

// ---------- 批量添加单词（纯英文输入，自动查单词） ----------
async function addWords() {
    const input = document.getElementById('wordInput').value.trim();
    if (!input) {
        showToast('请输入单词内容', 'error');
        return;
    }

    const loaded = await isDictLoaded();
    if (!loaded) {
        showToast('词典未导入，请先到"查单词"页面导入 ecdict.csv', 'error');
        return;
    }

    const lines = input.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length === 0) {
        showToast('请输入至少一个单词', 'error');
        return;
    }

    try {
        const result = await lookupWords(lines);
        const data = getWordData();
        const list = getActiveList(data);
        let addedCount = 0;
        const notFound = [];

        lines.forEach(w => {
            const entry = result.get(w.toLowerCase());
            if (entry) {
                const wordObj = {
                    word: entry.word,
                    meaning: normalizeNewlines(entry.translation || entry.definition || '(无释义)'),
                    mnemonic: null
                };
                const isExist = list.words.some(item => item.word.toLowerCase() === wordObj.word.toLowerCase());
                if (!isExist) {
                    list.words.push(wordObj);
                    list.pendingWords.push(wordObj);
                    addedCount++;
                }
            } else {
                notFound.push(w);
            }
        });

        list.words.sort((a, b) => a.word.localeCompare(b.word));
        list.pendingWords.sort((a, b) => a.word.localeCompare(b.word));

        saveWordData(data);
        document.getElementById('wordInput').value = '';

        let msg = '成功添加' + addedCount + '个新单词';
        if (notFound.length > 0) {
            msg += '\n以下单词未在词典中找到：\n' + notFound.join(', ');
        }
        showToast(msg, 'success');

        renderSidebarLists();
        refreshCurrentList();
        updateRemainCount();
        const updatedList = getActiveList();
        if (!updatedList.selectedWord && updatedList.pendingWords.length > 0) {
            document.getElementById('startButton').disabled = false;
        }
    } catch (err) {
        console.error(err);
        showToast('添加失败：' + err.message, 'error');
    }
}

// ---------- 预设词表 ----------
function loadPresetOptions() {
    const container = document.getElementById('presetListOptions');
    if (!container) return;
    const lists = getPresetLists();
    if (lists.length === 0) {
        container.innerHTML = '<span style="color:#909399;font-size:0.85rem;">暂无预设词表</span>';
        return;
    }
    container.innerHTML = lists.map(l =>
        '<button class="preset-btn" onclick="createListFromPreset(\'' + l.tag + '\')">' +
        escapeHtml(l.name) + ' (' + l.count + '词)</button>'
    ).join('');
}

function createListFromPreset(tag) {
    const preset = getPresetListByTag(tag);
    if (!preset) {
        showToast('预设词表不存在', 'error');
        return;
    }
    const data = getWordData();
    const words = preset.words.map(w => ({
        word: w.word,
        meaning: normalizeNewlines(w.translation || '(无释义)'),
        mnemonic: null
    }));
    const name = uniqueListName(preset.name);
    const newList = {
        id: genListId(),
        name: name,
        words: words,
        pendingWords: [...words],
        selectedWord: null
    };
    data.lists.push(newList);
    data.activeListId = newList.id;
    saveWordData(data);
    closeModal('newListModal');
    renderSidebarLists();
    updateDraw();
    closeSidebar();
    showToast('已创建词表"' + name + '"，共' + words.length + '个单词', 'success');
}

// ---------- 词意互换（位置互换 + 逻辑互换） ----------
// 开启后：主显示区显示"意思"、选项显示"单词"、"显示意思"按钮变"显示单词"、点击后显示单词
function isSwapOn() {
    const sb = document.getElementById('swapBtn');
    return !!(sb && sb.checked);
}

function applySwap() {
    const wordEl = document.getElementById('currentWord');
    const meaningEl = document.getElementById('currentMeaning');
    const swapBtn = document.getElementById('swapBtn');
    if (!wordEl || !meaningEl || !swapBtn) return;
    const swap = swapBtn.checked;
    try { localStorage.setItem('swapMeaning', swap ? '1' : '0'); } catch (e) {}
    // 1) 字体互换：意思用小字号（绿）、单词用大字号（白），元素位置保持不变
    //    （currentWord 在上显示意思、currentMeaning 在下显示单词，即"意思上、单词下"）
    wordEl.classList.toggle('swap-mode', swap);
    meaningEl.classList.toggle('swap-mode', swap);
    // 2) 逻辑互换：显示按钮文字
    const showBtn = document.getElementById('showButton');
    if (showBtn) showBtn.textContent = swap ? '显示单词' : '显示意思';
    // 3) 逻辑互换：刷新当前显示内容与选项（若正在抽词）
    const list = getActiveList();
    if (list && list.selectedWord) {
        const meaningText = flattenNewlines(list.selectedWord.meaning);
        document.getElementById('currentWord').textContent = swap ? meaningText : list.selectedWord.word;
        document.getElementById('currentMeaning').textContent = swap ? list.selectedWord.word : meaningText;
        document.getElementById('currentMeaning').classList.add('hidden');
    }
    createOptions();
    showOption();
}

// ---------- 单轮循环 ----------
function applyRound() {
    const roundBtn = document.getElementById('roundBtn');
    if (!roundBtn) return;
    const on = roundBtn.checked;
    try { localStorage.setItem('roundMode', on ? '1' : '0'); } catch (e) {}
    // 切换时清空本轮判定记录
    const list = getActiveList();
    if (list) {
        list.roundKnown = [];
        list.roundUnknown = [];
        saveWordData(getWordData());
        applyResetDraw();
    }
    showToast(on ? '已开启单轮循环（不放回抽词）' : '已关闭单轮循环', 'success');
}

function finishRound() {
    const list = getActiveList();
    const known = (list.roundKnown || []).length;
    const unknown = (list.roundUnknown || []).length;
    const summary = document.getElementById('roundSummary');
    if (summary) summary.textContent = '本轮认识 ' + known + ' 个，不认识 ' + unknown + ' 个';
    openModal('roundModal');
    document.getElementById('currentWord').textContent = '本轮抽完，请处理结果';
    document.getElementById('currentMeaning').textContent = '';
    document.getElementById('currentMeaning').classList.add('hidden');
    document.getElementById('startButton').disabled = true;
    document.getElementById('checkButton1').disabled = true;
    document.getElementById('checkButton2').disabled = true;
}

function roundDeleteKnown() {
    const data = getWordData();
    const list = getActiveList(data);
    const known = list.roundKnown || [];
    if (known.length === 0) { showToast('本轮没有认识的单词', 'warning'); return; }
    const delSet = new Set(known.map(w => w.toLowerCase()));
    list.words = list.words.filter(w => !delSet.has(w.word.toLowerCase()));
    list.pendingWords = [...list.words];
    list.selectedWord = null;
    list.roundKnown = [];
    list.roundUnknown = [];
    saveWordData(data);
    closeModal('roundModal');
    renderSidebarLists();
    applyResetDraw();
    showToast('已删除 ' + known.length + ' 个认识的单词', 'success');
}

async function roundCreateUnknownList() {
    const data = getWordData();
    const list = getActiveList(data);
    const unknownWords = list.roundUnknown || [];
    if (unknownWords.length === 0) { showToast('本轮没有不认识的单词', 'warning'); return; }
    const unknownSet = new Set(unknownWords.map(w => String(w).toLowerCase()));
    // 拆分：从当前词表取出不认识的单词（不再复制留底）
    const splitOut = list.words.filter(w => unknownSet.has(String(w.word).toLowerCase()));
    if (splitOut.length === 0) { showToast('未找到不认识的单词', 'warning'); return; }
    // 查词典补齐缺失释义
    let result = new Map();
    try { result = await lookupWords(splitOut.map(w => w.word)); } catch (e) {}
    const newWords = splitOut.map(w => {
        if (w.meaning && w.meaning !== '(无释义)') return w;
        const e = result.get(String(w.word).toLowerCase());
        return { ...w, meaning: e ? normalizeNewlines(e.translation || e.definition || '(无释义)') : '(无释义)' };
    });
    // 新词表名称（避免重名）
    let baseName = list.name + '-不认识';
    let name = baseName;
    let seq = 2;
    while (data.lists.some(l => l.name === name)) { name = baseName + seq; seq++; }
    const newList = {
        id: genListId(),
        name: name,
        words: newWords,
        pendingWords: newWords.slice(),
        selectedWord: null
    };
    data.lists.push(newList);
    // 从原词表移除这些词（拆分语义）
    list.words = list.words.filter(w => !unknownSet.has(String(w.word).toLowerCase()));
    list.pendingWords = [...list.words];
    list.selectedWord = null;
    list.roundKnown = [];
    list.roundUnknown = [];
    saveWordData(data);
    closeModal('roundModal');
    renderSidebarLists();
    applyResetDraw();
    showToast('已拆分 ' + splitOut.length + ' 个不认识的单词到列表"' + name + '"', 'success');
}

function roundFinishClose() {
    const data = getWordData();
    const list = getActiveList(data);
    list.pendingWords = [...list.words];
    list.selectedWord = null;
    list.roundKnown = [];
    list.roundUnknown = [];
    saveWordData(data);
    closeModal('roundModal');
    applyResetDraw();
    showToast('已结束本轮，未做处理', 'info');
}

// ---------- 开启拼写 ----------
function updateSpellInput() {
    const spellBtn = document.getElementById('spellBtn');
    const spellInput = document.getElementById('spellInput');
    if (!spellBtn || !spellInput) return;
    spellInput.classList.toggle('hidden', !spellBtn.checked);
}

function applySpell() {
    const spellBtn = document.getElementById('spellBtn');
    const switchBtn = document.getElementById('switchBtn');
    if (!spellBtn || !switchBtn) return;
    const on = spellBtn.checked;
    // 与选择题互斥：开启拼写时自动关闭选项
    if (on && switchBtn.checked) {
        switchBtn.checked = false;
        try { localStorage.setItem('optionMode', '0'); } catch (e) {}
    }
    try { localStorage.setItem('spellMode', on ? '1' : '0'); } catch (e) {}
    updateSpellInput();
    showOption();
}

// ---------- 拆分词表（随机抽取 X 个词组成新词表，并从原词表删除） ----------
function splitWords() {
    const data = getWordData();
    const list = getActiveList(data);
    const input = document.getElementById('splitCount');
    const n = parseInt(input.value, 10);
    if (!n || n < 1 || n > list.words.length) {
        showToast('请输入有效的拆分数量（1 ~ ' + list.words.length + '）', 'error');
        return;
    }
    // 随机抽取 n 个不重复的词
    const pool = list.words.slice();
    const picked = [];
    for (let i = 0; i < n; i++) {
        picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    const pickedSet = new Set(picked.map(w => w.word.toLowerCase()));

    // 自动生成新词表名称（避免重名：名称-拆分、名称-拆分2、...）
    let baseName = list.name + '-拆分';
    let name = baseName;
    let seq = 2;
    while (data.lists.some(l => l.name === name)) {
        name = baseName + seq;
        seq++;
    }

    const newList = {
        id: genListId(),
        name: name,
        words: picked,
        pendingWords: picked.slice(),
        selectedWord: null
    };
    // 从原词表删除被抽中的词
    list.words = list.words.filter(w => !pickedSet.has(w.word.toLowerCase()));
    list.pendingWords = list.pendingWords.filter(w => !pickedSet.has(w.word.toLowerCase()));
    if (list.selectedWord && pickedSet.has(list.selectedWord.word.toLowerCase())) {
        list.selectedWord = null;
    }

    data.lists.push(newList);
    data.activeListId = newList.id;
    saveWordData(data);
    closeModal('listModal');
    renderSidebarLists();
    refreshCurrentList();
    updateDraw();
    updateRemainCount();
    // 拆分结束后对当前（新）词表自动重置抽取记录
    applyResetDraw();
    showToast('已从"' + list.name + '"随机拆分出 ' + picked.length + ' 个单词，组成新词表"' + name + '"', 'success');
}

// ---------- 重置抽取 ----------
// 执行重置抽取（无确认弹窗），供重置按钮、拆分、合并后自动调用
function applyResetDraw() {
    const data = getWordData();
    const list = getActiveList(data);

    list.selectedWord = null;
    list.pendingWords = [...list.words];

    saveWordData(data);

    document.getElementById('currentWord').textContent = '已重置，请开始抽取';
    document.getElementById('currentMeaning').classList.add('hidden');
    list.lastJudged = null;
    document.getElementById('lastWord').textContent = '上一个单词';

    // 清空选项
    resetOptionText();
    for (let i = 1; i <= 6; i++) {
        const btn = document.getElementById('optionButton' + i);
        if (!btn) continue;
        btn.style.backgroundColor = '';
        btn.style.whiteSpace = '';
        btn.style.wordBreak = '';
        btn.style.display = (i <= getOptionCount()) ? '' : 'none';
        btn.classList.remove('detail');
        btn.disabled = true;
    }
    // 按选择题开关状态决定选项区显隐（修复：开启选项时重置后不应隐藏）
    showOption();

    document.getElementById('startButton').disabled = false;
    // showButton 常开
    document.getElementById('checkButton1').disabled = true;
    document.getElementById('checkButton2').disabled = true;

    // 清空单轮循环判定记录
    list.roundKnown = [];
    list.roundUnknown = [];

    refreshCurrentList();
    updateRemainCount();
}

function resetDraw() {
    showConfirm('确定要重置抽取记录吗？待抽取将重置为全部单词', () => {
        applyResetDraw();
        showToast('抽取记录已重置完成', 'success');
    });
}

// ---------- 清空当前词表 ----------
function clearAllWords() {
    showConfirm('⚠️ 警告：此操作将永久删除当前词表的所有单词，无法恢复！确定继续吗？', () => {
        const data = getWordData();
        const list = getActiveList(data);

        list.words = [];
        list.pendingWords = [];
        list.selectedWord = null;

        saveWordData(data);

        document.getElementById('currentWord').textContent = '请添加单词';
        document.getElementById('currentMeaning').classList.add('hidden');
        list.lastJudged = null;
        document.getElementById('lastWord').textContent = '上一个单词';
        document.getElementById('wordListDisplay').innerHTML = '<div class="word-item">暂无单词</div>';
        document.getElementById('wordCount').textContent = '单词总数：0';
        document.getElementById('startButton').disabled = false;
        // showButton 常开
        document.getElementById('checkButton1').disabled = true;
        document.getElementById('checkButton2').disabled = true;
        renderSidebarLists();
        updateRemainCount();
        showToast('✅ 已清空当前词表！', 'success');
    });
}

// ---------- 页面初始化（脚本在body末尾，DOM已就绪） ----------
(async function init() {
    if (!document.getElementById('remainCount')) return;

    await initStorage();
    renderSidebarLists();
    refreshCurrentList();
    updateDraw();

    // 恢复"选择题模式"设置
    const switchBtn = document.getElementById('switchBtn');
    if (switchBtn) {
        try { switchBtn.checked = localStorage.getItem('optionMode') !== '0'; } catch (e) {}
    }
    // 恢复"词意互换"设置并应用
    const swapBtn = document.getElementById('swapBtn');
    if (swapBtn) {
        try { swapBtn.checked = localStorage.getItem('swapMeaning') === '1'; } catch (e) {}
        applySwap();
    }
    // 恢复"单轮循环"设置
    const roundBtn = document.getElementById('roundBtn');
    if (roundBtn) {
        try { roundBtn.checked = localStorage.getItem('roundMode') === '1'; } catch (e) {}
    }
    // 恢复"开启拼写"设置
    const spellBtn = document.getElementById('spellBtn');
    if (spellBtn) {
        try { spellBtn.checked = localStorage.getItem('spellMode') === '1'; } catch (e) {}
        updateSpellInput();
    }
    // 互斥兜底：拼写与选项不同时开启
    if (switchBtn && spellBtn && spellBtn.checked && switchBtn.checked) {
        switchBtn.checked = false;
        try { localStorage.setItem('optionMode', '0'); } catch (e) {}
    }
    // 选择题开关：用户切换时持久化 optionMode（修复：此前只写 '0' 不写 '1'，
    // 导致曾被互斥置为 '0' 后，重新开启选项刷新即被恢复为关闭）
    if (switchBtn) {
        switchBtn.addEventListener('change', () => {
            try { localStorage.setItem('optionMode', switchBtn.checked ? '1' : '0'); } catch (e) {}
        });
    }
    // 恢复"选项个数"设置
    const optionCountSelect = document.getElementById('optionCountSelect');
    if (optionCountSelect) {
        try {
            const v = localStorage.getItem('optionCount');
            if (v === '3' || v === '4' || v === '5' || v === '6') optionCountSelect.value = v;
        } catch (e) {}
    }
    // 恢复"详细释义"设置
    const detailMeaningBtn = document.getElementById('detailMeaningBtn');
    if (detailMeaningBtn) {
        try { detailMeaningBtn.checked = localStorage.getItem('detailMeaningMode') === '1'; } catch (e) {}
    }
    // 应用选项设置后刷新选项区与详细设置行显隐
    createOptions();
    showOption();

    // 绑定底部按钮事件
    const footerBtns = document.querySelectorAll('.footer-icon-btn');
    if (footerBtns[0]) {
        footerBtns[0].addEventListener('click', function(e) {
            e.stopPropagation();
            openModal('settingsModal');
        });
    }
    if (footerBtns[1]) {
        footerBtns[1].addEventListener('click', function(e) {
            e.stopPropagation();
            openModal('addModal');
        });
    }

    // 点击弹窗遮罩关闭弹窗
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal(overlay.id);
            }
        });
    });

    // ESC 键关闭侧边栏和弹窗
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSidebar();
            document.querySelectorAll('.modal-overlay.visible').forEach(m => {
                closeModal(m.id);
            });
        }
    });

    // 新建词表弹窗回车创建
    const newListInput = document.getElementById('newListName');
    if (newListInput) {
        newListInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') createList();
        });
    }
})();

// ---------- 浮动菜单按钮可拖动（点击仍开菜单，拖动移动位置并记忆） ----------
(function initDraggableMenuBtn() {
    const btn = document.getElementById('floatingMenuBtn');
    if (!btn) return;

    // 恢复上次保存的位置（限制在视口内，顶部不低于导航栏）
    try {
        const pos = JSON.parse(localStorage.getItem('floatingMenuPos') || 'null');
        if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
            const maxX = Math.max(0, window.innerWidth - btn.offsetWidth);
            const maxY = Math.max(0, window.innerHeight - btn.offsetHeight);
            btn.style.left = Math.min(Math.max(pos.x, 0), maxX) + 'px';
            btn.style.top = Math.min(Math.max(pos.y, 76), maxY) + 'px';
        }
    } catch (e) {}

    let startX = 0, startY = 0, origLeft = 0, origTop = 0, moved = false;

    btn.addEventListener('pointerdown', (e) => {
        startX = e.clientX;
        startY = e.clientY;
        origLeft = btn.offsetLeft;
        origTop = btn.offsetTop;
        moved = false;
        try { btn.setPointerCapture(e.pointerId); } catch (err) {}

        const onMove = (ev) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (!moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return; // 阈值内视为点击
            moved = true;
            const maxX = Math.max(0, window.innerWidth - btn.offsetWidth);
            const maxY = Math.max(0, window.innerHeight - btn.offsetHeight);
            btn.style.left = Math.min(Math.max(origLeft + dx, 0), maxX) + 'px';
            btn.style.top = Math.min(Math.max(origTop + dy, 76), maxY) + 'px';
        };
        const onUp = () => {
            btn.removeEventListener('pointermove', onMove);
            btn.removeEventListener('pointerup', onUp);
            if (moved) {
                try {
                    localStorage.setItem('floatingMenuPos', JSON.stringify({ x: btn.offsetLeft, y: btn.offsetTop }));
                } catch (err) {}
            }
        };
        btn.addEventListener('pointermove', onMove);
        btn.addEventListener('pointerup', onUp);
    });

    // 去掉内联 onclick，统一在此处理：拖动过则拦截，否则开菜单
    btn.removeAttribute('onclick');
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (moved) { moved = false; return; }
        if (typeof toggleSidebar === 'function') toggleSidebar();
    });
})();

