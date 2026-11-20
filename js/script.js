// ========== 背单词核心逻辑 ==========
// 职责：WordMemorizer.html 页面
//   - 侧边栏词表管理（增删改查、拖动排序、批量删除、添加词表）
//   - 随机抽词（普通 / 单轮循环 / 记忆队列）、认识/不认识判定、选择题模式
//   - 单词详细弹窗、拆分/合并词表、Excel 导入（依赖 js/lib/xlsx.core.min.js）

// ---------- 侧边栏菜单 ----------
function openSidebar() {
    document.getElementById('sidebarMenu').classList.add('open');
    document.getElementById('overlayLayer').classList.add('visible');
    document.body.style.overflow = 'hidden';
    const fmb = document.getElementById('floatingMenuBtn');
    if (fmb) fmb.classList.add('hidden');
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebarMenu');
    if (!sidebar || !sidebar.classList.contains('open')) return; // 未打开时不做无谓的重渲染
    // 关闭侧边栏时若处于批量删除模式，自动退出
    if (_batchDeleteMode) {
        exitBatchMode();
        renderSidebarLists();
    }
    sidebar.classList.remove('open');
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
// openModal / closeModal 由 common.js 提供（各页面共用）

// ---------- 工具函数 ----------
// escapeHtml / showToast / showConfirm / showPrompt / makeList / uniqueListName 等由 common.js 提供
// 词表存储核心（openWordDB/loadWordData/writeWordData/getWordData/saveWordData/getActiveList/
// initWordDataCache）已移至 common.js，供各页面共享 ----------
async function initStorage() {
    await initWordDataCache();
    // 异步从词典加载释义（IndexedDB 中不存 meaning），不阻塞首屏
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
    // 给内存中的单词对象填充 meaning：有自定义释义(customMeaning)优先，否则链接词典查询
    const apply = (w) => {
        if (!w) return;
        if (w.customMeaning) {
            w.meaning = normalizeNewlines(w.customMeaning);
            return;
        }
        const e = entries.get(String(w.word).toLowerCase());
        if (e) {
            w.meaning = normalizeNewlines(e.translation || e.definition || '(无释义)');
        } else if (!w.meaning) {
            w.meaning = '(无释义)';
        }
    };
    _wordDataCache.lists.forEach(list => {
        (list.words || []).forEach(apply);
        (list.pendingWords || []).forEach(apply);
        apply(list.selectedWord);
    });
    // 释义加载完成后刷新显示与列表，不调用 updateDraw（避免清空记忆队列/打断当前抽词）
    renderSidebarLists();
    refreshCurrentList();
    renderCurrentWord();
    createOptions(); // 选项文案依赖 meaning，补齐后需重新渲染
    showOption();
}

// ---------- 列表管理 ----------
function createList() {
    const input = document.getElementById('newListName');
    const baseName = input.value.trim();
    if (!baseName) {
        showToast('请输入词表名称', 'error');
        return;
    }
    const data = getWordData();
    if (!data) return;
    const newList = makeList(uniqueListName(baseName));
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
    showConfirm('确定删除词表"' + list.name + '"吗？该词表下的所有单词将被删除，无法恢复！' + tip, async () => {
        data.lists = data.lists.filter(l => l.id !== id);
        if (data.lists.length === 0) {
            // 删除最后一个列表后，自动生成一个空的默认列表
            data.lists.push(makeList('默认词表'));
        }
        if (!data.lists.some(l => l.id === data.activeListId)) {
            data.activeListId = data.lists[0].id;
        }
        saveWordData(data);
        await removeDailyTasksByListIds([id]); // 每日任务：级联删除该词表的全部任务
        renderSidebarLists();
        updateDraw();
        refreshCurrentList();
    });
}

// 拖动词表后短暂抑制随后的 click，避免拖动结束时误切换词表
let _justDragged = false;

function switchList(id) {
    if (_justDragged) { _justDragged = false; return; }
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
    if (!sel || !current) return;
    const prev = sel.value;
    const others = data.lists.filter(l => l.id !== current.id);
    sel.innerHTML = '<option value="">选择要合并的词表...</option>' +
        others.map(l => '<option value="' + l.id + '"' + (l.id === prev ? ' selected' : '') + '>' +
            escapeHtml(l.name) + '（' + l.words.length + '词）</option>').join('');
}

// 合并词表：将所选词表的单词并入当前词表（按单词去重），并删除所选词表
async function mergeList() {
    const data = getWordData();
    const current = getActiveList(data);
    if (!current) return;
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
    const existing = new Set(current.words.map(w => String(w.word).toLowerCase()));
    let added = 0;
    target.words.forEach(w => {
        const key = String(w.word).toLowerCase();
        if (existing.has(key)) return;
        existing.add(key);
        current.words.push(w);
        added++;
    });
    const targetName = target.name;
    data.lists = data.lists.filter(l => l.id !== target.id);
    saveWordData(data);
    await removeDailyTasksByListIds([target.id]); // 每日任务：源词表被并掉，其任务一并删除
    renderSidebarLists();
    refreshMergeSelect();
    updateDraw();
    // 合并结束后对当前词表自动重置抽取记录（内部会保存并刷新列表/剩余数量）
    applyResetDraw();
    showToast('已将「' + targetName + '」的单词合并到「' + current.name + '」，新增 ' + added + ' 个单词', 'success');
}

// ---------- 单词详细弹窗（点击"上一个单词"/当前单词/词表详细里的单词行查看完整释义） ----------
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

    // 判定状态区（单轮循环标记：被标记为认识/不认识时，允许翻转标记）
    let extra = '';
    const activeList = getActiveList();
    if (activeList) {
        const lower = String(word).toLowerCase();
        const inKnown = (activeList.roundKnown || []).some(w => String(w).toLowerCase() === lower);
        const inUnknown = (activeList.roundUnknown || []).some(w => String(w).toLowerCase() === lower);
        if (inKnown || inUnknown) {
            const stateText = inKnown ? '认识' : '不认识';
            const btnText = inKnown ? '标记为不认识' : '标记为认识';
            extra += '<div class="dict-section-title">判定（单轮循环）</div>';
            extra += '<div class="dict-translation">当前标记：' + stateText + '</div>';
            extra += '<button class="word-mark-toggle" data-word="' + escapeHtml(String(word)) + '" onclick="toggleWordMark(this)">' + btnText + '</button>';
        }
    }
    // 渲染格式与查单词页结果一致（dict-word / dict-phonetic / dict-section-title / dict-translation）
    document.getElementById('wdDetailContent').innerHTML = buildWordDetailHtml(hit.w, hit.listName, extra);
    window._detailWord = String(word); // 供弹窗右上角"查看详细"跳转查词典页使用
    openModal('wordDetailModal');
    // 详细弹窗里的单词也能点击发音（朗读的就是该词本身，不依赖当前抽中的词）
    bindSpeakEl(document.querySelector('#wdDetailContent .dict-word'), () => String(hit.w.word || ''));
}

// 弹窗内翻转单轮循环判定：认识 ↔ 不认识
function toggleWordMark(btn) {
    const word = btn.dataset.word;
    const list = getActiveList();
    if (!list || !word) return;
    list.roundKnown = list.roundKnown || [];
    list.roundUnknown = list.roundUnknown || [];
    const lower = String(word).toLowerCase();
    const inKnown = list.roundKnown.some(w => String(w).toLowerCase() === lower);
    const inUnknown = list.roundUnknown.some(w => String(w).toLowerCase() === lower);
    if (inKnown) {
        list.roundKnown = list.roundKnown.filter(w => String(w).toLowerCase() !== lower);
        if (!list.roundUnknown.some(w => String(w).toLowerCase() === lower)) list.roundUnknown.push(word);
    } else if (inUnknown) {
        list.roundUnknown = list.roundUnknown.filter(w => String(w).toLowerCase() !== lower);
        if (!list.roundKnown.some(w => String(w).toLowerCase() === lower)) list.roundKnown.push(word);
    } else {
        return; // 未被标记时不动作（按钮仅在已标记时显示）
    }
    saveWordData(getWordData());
    showWordDetail(word); // 重渲染弹窗，刷新状态与按钮
    updateDraw();
}

function viewListWords(id) {
    switchList(id);
    openModal('listModal');
    refreshMergeSelect();
    refreshCurrentList(true); // 打开弹窗时强制渲染（弹窗关着时渲染会被跳过）
}

// 将当前词表复制一份保存到「我的词典」（写入独立 key savedLists，与背单词词表分开、互不影响）
async function saveListToDict() {
    const data = getWordData();
    const list = getActiveList(data);
    if (!list) return;
    const saved = await initSavedListsCache();
    if (!Array.isArray(saved.lists)) saved.lists = [];
    // 在「我的词典」词表内去重命名（与背单词词表使用同一套命名规则）
    const copy = makeList(uniqueListNameIn(list.name, saved.lists), list.words.map(w => ({
        word: w.word,
        meaning: w.meaning || '',
        mnemonic: w.mnemonic || null,
        phonetic: w.phonetic || ''
    })));
    saved.lists.push(copy);
    saveSavedListsData(saved);
    showToast('已复制到「我的词典」，可在我的词典页查看', 'success');
}

let _listDragFrom = -1;

// ---------- 批量删除词表 ----------
let _batchDeleteMode = false;
let _batchSelected = new Set();

function toggleBatchDelete() {
    setBatchMode(!_batchDeleteMode);
    renderSidebarLists();
    updateBatchFooter();
}

// 进入/退出批量删除模式（统一处理按钮文案与底部区域显隐）
function setBatchMode(on) {
    _batchDeleteMode = !!on;
    _batchSelected.clear();
    const btn = document.getElementById('batchToggleBtn');
    if (btn) btn.textContent = on ? '取消批量删除' : '批量删除';
    const foot = document.getElementById('batchFooterRow');
    if (foot) foot.classList.toggle('hidden', !on);
    document.querySelectorAll('.sidebar-footer-buttons').forEach(el => el.classList.toggle('hidden', !!on));
}

// 仅退出批量删除（若未处于该模式则不产生任何渲染）
function exitBatchMode() {
    if (!_batchDeleteMode) return;
    setBatchMode(false);
}

function toggleBatchSelect(id) {
    if (_batchSelected.has(id)) _batchSelected.delete(id);
    else _batchSelected.add(id);
    renderSidebarLists();
    updateBatchFooter();
}

function updateBatchFooter() {
    const btn = document.getElementById('batchDeleteBtn');
    if (btn) {
        btn.textContent = '删除选中(' + _batchSelected.size + ')';
        btn.disabled = _batchSelected.size === 0;
    }
}

function batchDeleteSelected() {
    if (_batchSelected.size === 0) return;
    const data = getWordData();
    const n = _batchSelected.size;
    const ids = Array.from(_batchSelected); // 先留存 id，退出批量模式后集合会清空
    showConfirm('确定删除选中的 ' + n + ' 个词表吗？词表内所有单词将被删除，无法恢复！', async () => {
        data.lists = data.lists.filter(l => !_batchSelected.has(l.id));
        if (data.lists.length === 0) {
            // 全部删除后自动生成一个空的默认列表
            data.lists.push(makeList('默认词表'));
        }
        if (!data.lists.some(l => l.id === data.activeListId)) {
            data.activeListId = data.lists[0].id;
        }
        saveWordData(data);
        await removeDailyTasksByListIds(ids); // 每日任务：级联删除被删词表的全部任务
        exitBatchMode();
        renderSidebarLists();
        updateDraw();
        refreshCurrentList();
        showToast('已删除 ' + n + ' 个词表', 'success');
    });
}

// ---------- 只显示今日任务：按「每日任务」的排期过滤侧边栏词表 ----------
let _onlyTodayTasks = false;       // 开关状态：true = 只看今日任务
let _onlyTodayFilterBusy = false;  // 读取排期数据期间的防抖
let _scheduledListIds = null;      // 已建任务的词表 id
let _todayListIds = null;          // 今天有复习节点的词表 id

// 本地日期字符串 YYYY-MM-DD，避免时区偏移
function wmDateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function wmTodayStr() {
    return wmDateStr(new Date());
}

function wmAddDaysStr(str, n) {
    const p = String(str).split('-');
    if (p.length !== 3) return '';
    return wmDateStr(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + Number(n)));
}

// 读取每日任务数据，算出「已排期」与「今天要复习」两份词表 id
async function refreshTodayTaskSets() {
    const daily = await loadDailyTasks();
    const today = wmTodayStr();
    const gaps = (daily && Array.isArray(daily.intervals)) ? daily.intervals : [];
    const scheduled = new Set();
    const due = new Set();
    ((daily && daily.tasks) || []).forEach(t => {
        if (!t || !t.startDate) return;
        scheduled.add(String(t.listId));
        // 第 n 次复习日 = 首次学习日期 + 第 n 次间隔，命中今天即为今日任务
        if (gaps.some(g => wmAddDaysStr(t.startDate, g) === today)) due.add(String(t.listId));
    });
    _scheduledListIds = scheduled;
    _todayListIds = due;
}

async function toggleOnlyTodayTasks() {
    if (_onlyTodayFilterBusy) return;
    const btn = document.getElementById('onlyTodayTasksBtn');
    _onlyTodayTasks = !_onlyTodayTasks;
    if (btn) {
        btn.classList.toggle('active', _onlyTodayTasks);
        btn.setAttribute('aria-pressed', _onlyTodayTasks ? 'true' : 'false');
    }
    if (!_onlyTodayTasks) {
        renderSidebarLists();   // 关闭后按 data.lists 原顺序重绘，顺序自然复原
        return;
    }
    _onlyTodayFilterBusy = true;
    try {
        await refreshTodayTaskSets();
        renderSidebarLists();
        if (_todayListIds.size === 0) {
            showToast('今天没有需要复习的词表，未排期的词表已变暗', 'warning');
        } else {
            const hidden = _scheduledListIds.size - _todayListIds.size;
            showToast('已只看今日任务：' + _todayListIds.size + ' 个词表今天要复习' + (hidden > 0 ? '，隐藏 ' + hidden + ' 个非今日任务' : ''));
        }
    } finally {
        _onlyTodayFilterBusy = false;
    }
}

function renderSidebarLists() {
    const data = getWordData();
    const container = document.getElementById('sidebarLists');
    if (!data || !container) return;
    const onlyToday = _onlyTodayTasks === true;
    const scheduled = onlyToday ? (_scheduledListIds || new Set()) : null;
    const due = onlyToday ? (_todayListIds || new Set()) : null;
    let html = '';
    let shown = 0;
    data.lists.forEach((list, index) => {
        const isActive = list.id === data.activeListId;
        const listId = String(list.id);
        // 有任务但今天没有复习节点 → 隐藏；没排期的词表 → 变暗但保留
        if (onlyToday && scheduled.has(listId) && !due.has(listId)) return;
        const dim = (onlyToday && !scheduled.has(listId)) ? ' dim' : '';
        shown++;
        if (_batchDeleteMode) {
            const checked = _batchSelected.has(list.id) ? ' checked' : '';
            html += '<div class="sidebar-list-item batch-mode' + (isActive ? ' active' : '') + dim + '" onclick="toggleBatchSelect(\'' + list.id + '\')">';
            html += '  <input type="checkbox" class="batch-check"' + checked + '>';
            html += '  <div class="list-item-info">';
            html += '    <span class="list-item-name">' + escapeHtml(list.name) + '</span>';
            html += '    <span class="list-item-count">' + list.words.length + ' 词</span>';
            html += '  </div>';
            html += '</div>';
        } else {
            const dragAttrs = onlyToday
                ? 'draggable="false"'
                : 'draggable="true" ondragstart="listDragStart(event)" ondragover="listDragOver(event)" ondrop="listDrop(event)" ondragend="listDragEnd(event)"';
            html += '<div class="sidebar-list-item' + (isActive ? ' active' : '') + dim + '" ' + dragAttrs + ' data-index="' + index + '">';
            html += '  <div class="list-item-info" onclick="switchList(\'' + list.id + '\')">';
            html += '    <span class="list-item-name">' + escapeHtml(list.name) + '</span>';
            html += '    <span class="list-item-count">' + list.words.length + ' 词</span>';
            html += '  </div>';
            html += '  <div class="list-item-actions" draggable="false">';
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
        }
    });
    if (onlyToday && shown === 0) html = '<div class="sidebar-empty-tip">今天没有需要复习的词表</div>';
    container.innerHTML = html;
}

function listDragStart(e) {
    const item = e.target.closest('.sidebar-list-item');
    if (!item) return;
    _listDragFrom = parseInt(item.getAttribute('data-index'), 10);
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(_listDragFrom)); } catch (err) {}
}

function listDragOver(e) {
    e.preventDefault();
    const item = e.target.closest('.sidebar-list-item');
    if (!item) return;
    e.dataTransfer.dropEffect = 'move';
    // 只高亮当前悬停项，先清掉其他项的高亮
    document.querySelectorAll('#sidebarLists .sidebar-list-item').forEach(el => {
        if (el !== item) el.classList.remove('drag-over-before', 'drag-over-after');
    });
    const rect = item.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    item.classList.remove('drag-over-before', 'drag-over-after');
    item.classList.add(before ? 'drag-over-before' : 'drag-over-after');
}

function listDrop(e) {
    e.preventDefault();
    const target = e.target.closest('.sidebar-list-item');
    if (!target) return;
    const toIndex = parseInt(target.getAttribute('data-index'), 10);
    const fromIndex = _listDragFrom;
    _listDragFrom = -1;
    if (fromIndex < 0 || fromIndex === toIndex) return;
    const data = getWordData();
    const arr = data.lists;
    if (fromIndex >= arr.length || toIndex >= arr.length) return;
    const [moved] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, moved);
    saveWordData(data);
    renderSidebarLists();
}

function listDragEnd(e) {
    const item = e.target.closest('.sidebar-list-item');
    if (item) item.classList.remove('dragging');
    document.querySelectorAll('#sidebarLists .sidebar-list-item').forEach(el => {
        el.classList.remove('drag-over-before', 'drag-over-after');
    });
    _listDragFrom = -1;
    // 拖动结束：短暂抑制随后的 click（防止拖动后误触发 switchList 切换词表）
    _justDragged = true;
    setTimeout(() => { _justDragged = false; }, 300);
}

function updateActiveListName() {
    const list = getActiveList();
    const name = list ? list.name : '无';
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    setText('activeListName', '当前列表：' + name);
    setText('addModalListName', name);
    setText('listModalName', name);
}

// ---------- UI 更新辅助函数 ----------
function updateRemainCount() {
    const el = document.getElementById('remainCount');
    const list = getActiveList();
    if (!el || !list) return;
    // 记忆队列中的单词视为未抽取，计入剩余个数；当前正在显示的单词也算未完成
    let remain = list.pendingWords.length + (isQueueOn() ? _memoryQueue.length : 0);
    if (list.selectedWord) remain += 1;
    el.textContent = '剩余单词：' + remain;
}

// 主显示区显示占位文案（无当前单词时统一清空释义/音标）
function showPlaceholder(text) {
    const wordEl = document.getElementById('currentWord');
    const meaningEl = document.getElementById('currentMeaning');
    if (wordEl) wordEl.textContent = text;
    if (meaningEl) {
        meaningEl.textContent = '';
        meaningEl.classList.add('hidden');
    }
    updatePhoneticDisplay();
}

// 主显示区渲染当前单词（词意互换时“意思在上、单词在下”）
function renderCurrentWord() {
    const list = getActiveList();
    const wordEl = document.getElementById('currentWord');
    const meaningEl = document.getElementById('currentMeaning');
    if (!list || !list.selectedWord || !wordEl || !meaningEl) return false;
    const swap = isSwapOn();
    const meaningText = flattenNewlines(list.selectedWord.meaning);
    wordEl.textContent = swap ? meaningText : list.selectedWord.word;
    meaningEl.textContent = swap ? list.selectedWord.word : meaningText;
    meaningEl.classList.add('hidden');
    syncPhoneticPlacement();
    updatePhoneticDisplay();
    return true;
}

// 认识/不认识按钮的可用状态
function setJudgementEnabled(enabled) {
    ['checkButton1', 'checkButton2'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !enabled;
    });
}

// ---------- 可播种随机：种子 = 当前时间（YYYYMMDDHHMMSS），用于随机抽词/选项 ----------
let _rng = Math.random;
let _seedStr = '';
function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
function _pad2(n) { return (n < 10 ? '0' : '') + n; }
// 用当前时间（精确到秒）生成种子并重置随机数发生器
function initRandomSeed() {
    const now = new Date();
    _seedStr = '' + now.getFullYear() + _pad2(now.getMonth() + 1) + _pad2(now.getDate()) +
        _pad2(now.getHours()) + _pad2(now.getMinutes()) + _pad2(now.getSeconds());
    _rng = mulberry32(parseInt(_seedStr, 10));
    return _seedStr;
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
    setStored('optionCount', sel.value);
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
    setStoredFlag('detailMeaningMode', d.checked);
    createOptions();
    showOption();
}

// ---------- 关闭手动确认（选项对错自动判定，1 秒后跳下一个） ----------
let _autoConfirmTimer = null;
function isCloseManualConfirmOn() {
    const b = document.getElementById('closeManualConfirmBtn');
    return !!(b && b.checked);
}
// 隐藏/显示 认识/不认识 与 显示意思 按钮（仅"开启选择"且"关闭手动确认"开启时隐藏）
function updateManualConfirmUI() {
    const sb = document.getElementById('switchBtn');
    const hide = isCloseManualConfirmOn() && !!(sb && sb.checked);
    ['checkButton1', 'checkButton2', 'showButton'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', hide);
    });
}
function applyCloseManualConfirm() {
    const b = document.getElementById('closeManualConfirmBtn');
    if (!b) return;
    setStoredFlag('autoConfirmMode', b.checked);
    clearTimeout(_autoConfirmTimer);
    setOptionButtonsClickable(true); // 取消待定跳转后解锁选项，避免残留禁用
    updateManualConfirmUI();
    showOption();
}

function showOption() {
    const optionDiv = document.getElementById('optionDiv');
    if (!optionDiv) return;
    const list = getActiveList();
    // 互斥：开启选择题时自动关闭拼写
    const switchBtn = document.getElementById('switchBtn');
    const spellBtn = document.getElementById('spellBtn');
    if (switchBtn && spellBtn && switchBtn.checked && spellBtn.checked) {
        spellBtn.checked = false;
        setStoredFlag('spellMode', false);
        updateSpellInput();
    }
    const switchOn = !!(switchBtn && switchBtn.checked);
    const enoughWords = !!(list && list.words && list.words.length >= getOptionCount());
    optionDiv.classList.toggle('hidden', !(switchOn && enoughWords));
    // 开启选项时显示"选项个数 / 详细释义 / 关闭手动确认"详细设置分组
    const subBox = document.getElementById('optionSubBox');
    if (subBox) subBox.classList.toggle('hidden', !switchOn);
    updateManualConfirmUI();
}


// 记录当前显示的词表 id，用于在切换词表时清空"上一个单词"等瞬时信息
let _lastActiveListId = null;

function updateDraw() {
    clearTimeout(_autoConfirmTimer); // 切换词表时取消待定的自动跳转
    updateActiveListName();
    createOptions();
    showOption();

    const list = getActiveList();
    if (!list) return;
    // 恢复当前词表的记忆队列（刷新/切换后待抽取个数与流转状态保持一致）
    _memoryQueue = (list.queueWords || []).map(word => list.words.find(w => w.word === word)).filter(Boolean);
    updateRemainCount();
    setJudgementEnabled(false); // showButton 常开，不设置 disabled

    if (!renderCurrentWord()) {
        // 词表尚未开始抽取：清空主显示区，避免残留上一词表的单词/释义
        showPlaceholder('点击开始抽取单词');
    }
    document.getElementById('startButton').disabled = !!list.selectedWord;

    // 切换词表时更新"上一个单词"为该词表自己的判定词（无则显示占位），并清空拼写输入
    if (_lastActiveListId !== list.id) {
        _lastActiveListId = list.id;
        const lastEl = document.getElementById('lastWord');
        if (lastEl) lastEl.textContent = list.lastJudged || '上一个单词';
        const spellInputEl = document.getElementById('spellInput');
        if (spellInputEl) {
            spellInputEl.value = '';
            spellInputEl.style.color = '';
        }
    }
}

// ---------- 单词列表渲染 ----------
let _wordListSearch = '';   // 单词列表弹窗搜索关键词
let _wordSearchTimer = null;

function renderWordList(wordArray) {
    const displayEl = document.getElementById('wordListDisplay');
    const countEl = document.getElementById('wordCount');
    if (!displayEl || !countEl) return;
    // 与我的词典页共用同一套列表渲染（排序 / 搜索 / 删除按钮 / 点击查看详情）
    const markup = buildWordListMarkup(wordArray, _wordListSearch, 'deleteWordFromList');
    countEl.textContent = markup.countText;
    displayEl.innerHTML = markup.html;
    // 补查缺失释义（词典链接单词，异步查询后刷新）
    ensureWordMeanings(markup.missing);
}

// 异步补查缺失释义：只处理既无 meaning 也无自定义释义的单词
async function ensureWordMeanings(missing) {
    if (!missing || missing.length === 0) return;
    await fillMissingMeanings(missing);
    const modal = document.getElementById('listModal');
    if (modal && modal.classList.contains('visible')) refreshCurrentList(true);
}

// 单词列表弹窗搜索（防抖：避免每次击键都对整张词表排序 + 重建 DOM）
function onWordListSearch() {
    clearTimeout(_wordSearchTimer);
    _wordSearchTimer = setTimeout(() => {
        const input = document.getElementById('wordListSearch');
        _wordListSearch = input ? input.value : '';
        const list = getActiveList();
        if (list) renderWordList(list.words);
    }, 120);
}

// 从词表彻底移除单词（同步清理待抽取 / 当前选中 / 单轮判定 / 记忆队列）
function removeWordEverywhere(list, lower) {
    if (!list) return;
    list.words = list.words.filter(w => w.word.toLowerCase() !== lower);
    list.pendingWords = list.pendingWords.filter(w => w.word.toLowerCase() !== lower);
    if (list.selectedWord && list.selectedWord.word.toLowerCase() === lower) list.selectedWord = null;
    if (Array.isArray(list.roundKnown)) list.roundKnown = list.roundKnown.filter(w => String(w).toLowerCase() !== lower);
    if (Array.isArray(list.roundUnknown)) list.roundUnknown = list.roundUnknown.filter(w => String(w).toLowerCase() !== lower);
    list.queueWords = (list.queueWords || []).filter(w => String(w).toLowerCase() !== lower);
    _memoryQueue = _memoryQueue.filter(w => w.word.toLowerCase() !== lower);
}

// 从当前词表删除单个单词（同步清理待抽取/选中/循环判定记录）
function deleteWordFromList(word) {
    const data = getWordData();
    const list = getActiveList(data);
    if (!list) return;
    const lower = String(word).toLowerCase();
    const target = list.words.find(w => w.word.toLowerCase() === lower);
    if (!target) return;
    showConfirm('确定要从「' + list.name + '」中删除单词「' + target.word + '」吗？', () => {
        removeWordEverywhere(list, lower);
        saveWordData(data);
        refreshCurrentList(true);
        updateRemainCount();
        showToast('已删除单词「' + target.word + '」', 'success');
    });
}

// 背单词时删除当前单词（确认提示后从词表移除并跳到下一个）
function deleteCurrentWord() {
    const data = getWordData();
    const list = getActiveList(data);
    if (!list || !list.selectedWord) return;
    const word = list.selectedWord.word;
    const lower = String(word).toLowerCase();
    showConfirm('确定要从「' + list.name + '」中删除单词「' + word + '」吗？', () => {
        const curData = getWordData();
        removeWordEverywhere(getActiveList(curData), lower);
        saveWordData(curData);
        drawWord(1); // selectedWord 已清空：跳过判定，直接抽取/显示下一个
        updateRemainCount();
        showToast('已删除单词「' + word + '」', 'success');
    });
}

// 刷新单词列表弹窗；弹窗未打开时直接跳过，避免每次抽词都排序并重建整张列表
function refreshCurrentList(force) {
    const modal = document.getElementById('listModal');
    if (!force && !(modal && modal.classList.contains('visible'))) return;
    const list = getActiveList();
    if (list) renderWordList(list.words);
}

// ---------- 选项相关逻辑 ----------
let optionsText = [];
let _optionsLocked = false; // 「关闭手动确认」等待期内锁定选项；不用 disabled，避免丢失对错配色

// 重置全部选项按钮：文案恢复占位、清空内联样式、按选项个数显隐、可选禁用
function resetOptionButtons(disabled) {
    setOptionButtonsClickable(true); // 重建选项即解锁，避免上一轮等待期的锁定残留到下一词
    const count = getOptionCount();
    for (let i = 1; i <= 6; i++) {
        const btn = document.getElementById('optionButton' + i);
        if (!btn) continue;
        btn.textContent = '选项' + i;
        btn.disabled = !!disabled;
        btn.style.backgroundColor = '';
        btn.style.whiteSpace = '';
        btn.style.wordBreak = '';
        btn.style.display = (i <= count) ? '' : 'none';
        btn.classList.remove('detail');
    }
}

// 临时锁定/解锁全部选项按钮（关闭手动确认作答后，1 秒等待期内禁止重复点击改写判定）
// 这里不设置 disabled：全局 button:disabled 的 !important 背景会盖掉正确/错误的绿红色块
function setOptionButtonsClickable(clickable) {
    _optionsLocked = !clickable;
    const optionDiv = document.getElementById('optionDiv');
    if (optionDiv) optionDiv.classList.toggle('locked', !clickable);
    for (let i = 1; i <= 6; i++) {
        const btn = document.getElementById('optionButton' + i);
        if (btn) btn.setAttribute('aria-disabled', clickable ? 'false' : 'true');
    }
}

// 按当前“词意互换 / 详细释义”设置渲染已生成的选项
function renderOptionTexts() {
    const swap = isSwapOn();
    const full = isDetailMeaningOn();
    optionsText.forEach((item, i) => {
        const btn = document.getElementById('optionButton' + (i + 1));
        if (!btn) return;
        btn.innerText = swap ? item.word : flattenNewlines(item.meaning);
        btn.classList.toggle('detail', !swap && full);
    });
}

function createOptions() {
    const list = getActiveList();
    const count = getOptionCount();
    optionsText = [];
    resetOptionButtons(false);

    if (!list || !list.words || list.words.length < count) {
        document.getElementById('optionDiv').classList.add('hidden');
        resetOptionButtons(true);
        return;
    }
    // 未抽取单词时禁用选项按钮并清空残留文本，避免切换词表后串词
    if (!list.selectedWord) {
        resetOptionButtons(true);
        return;
    }
    const switchBtn = document.getElementById('switchBtn');
    if (switchBtn && switchBtn.checked) {
        document.getElementById('optionDiv').classList.remove('hidden');
    }

    // 干扰项：排除当前单词后的唯一单词集合（用 Set 去重，避免“重复单词导致取不满”的死循环）
    const seen = new Set([String(list.selectedWord.word).toLowerCase()]);
    const pool = [];
    list.words.forEach(w => {
        const key = String(w.word).toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        pool.push(w);
    });
    // 部分洗牌：只随机取出需要的数量
    const need = Math.min(count - 1, pool.length);
    for (let i = 0; i < need; i++) {
        const j = i + Math.floor(_rng() * (pool.length - i));
        const tmp = pool[i];
        pool[i] = pool[j];
        pool[j] = tmp;
    }
    optionsText = pool.slice(0, need);
    optionsText.splice(Math.floor(_rng() * (need + 1)), 0, list.selectedWord);
    renderOptionTexts();
    // 词表唯一单词不足时，隐藏没有内容的按钮，避免出现“选项N”占位
    for (let i = optionsText.length + 1; i <= 6; i++) {
        const btn = document.getElementById('optionButton' + i);
        if (btn) btn.style.display = 'none';
    }
}

function isOptionCorrect(num) {
    if (_optionsLocked) return; // 等待期内禁止重复作答，避免覆盖已判定的对错
    const list = getActiveList();
    const selectedOption = optionsText[num - 1];
    if (!list || !list.selectedWord || !selectedOption) return;

    // 先重置所有选项样式（允许重新选择）
    renderOptionTexts();
    optionsText.forEach((item, i) => {
        const btn = document.getElementById('optionButton' + (i + 1));
        if (!btn) return;
        btn.style.backgroundColor = '';
        btn.style.whiteSpace = '';
        btn.style.wordBreak = '';
    });

    // 标记当前选中项
    const markedBtn = document.getElementById('optionButton' + num);
    if (!markedBtn) return;
    const correct = selectedOption.word === list.selectedWord.word;
    markedBtn.innerText = (correct ? '√ ' : '× ') + selectedOption.word + '-' + flattenNewlines(selectedOption.meaning);
    markedBtn.style.backgroundColor = correct ? '#67c23a' : '#f56c6c';
    // 作答后按"详细释义"开关决定是否展开完整释义（未开启时保持缩略省略）
    markedBtn.style.whiteSpace = isDetailMeaningOn() ? 'normal' : '';
    markedBtn.style.wordBreak = isDetailMeaningOn() ? 'break-word' : '';

    // 点击选项后显示当前单词的意思（选择题模式）
    const meaningEl = document.getElementById('currentMeaning');
    if (meaningEl) meaningEl.classList.remove('hidden');
    updatePhoneticDisplay(); // 词意互换时单词随选项结果揭示，音标同步出现
    // 自动播放（词意互换 + 关闭手动确认）：点选项后朗读
    if (isAutoSpeakOn() && isSwapOn() && isCloseManualConfirmOn()) speakWord();
    if (isCloseManualConfirmOn()) {
        // 关闭手动确认：以选项对错作为认识/不认识判定，1 秒后自动跳到下一个
        setOptionButtonsClickable(false); // 等待期内锁定选项，防止连点覆盖对错判定
        clearTimeout(_autoConfirmTimer);
        _autoConfirmTimer = setTimeout(() => drawWord(correct ? 1 : 0), 1000);
    } else {
        setJudgementEnabled(true);
    }
}

// ---------- 核心抽取逻辑 ----------
// 按队列长度补齐记忆队列（从待抽取中随机取词，出队后立即补位）
function fillQueue() {
    const list = getActiveList();
    if (!list) return;
    const target = getQueueSize();
    while (_memoryQueue.length < target && list.pendingWords.length > 0) {
        const idx = Math.floor(_rng() * list.pendingWords.length);
        _memoryQueue.push(list.pendingWords.splice(idx, 1)[0]);
    }
}

function drawWord(num) {
    // 判定后清空拼写输入框并复原颜色
    const spellInputEl = document.getElementById('spellInput');
    if (spellInputEl) {
        spellInputEl.value = '';
        spellInputEl.style.color = '';
    }

    const data = getWordData();
    const list = getActiveList(data);
    if (!list) return;
    const roundBtn = document.getElementById('roundBtn');
    const roundOn = !!(roundBtn && roundBtn.checked);
    const queueMode = isQueueOn();

    // ---- 记录当前选中词的判定 ----
    if (list.selectedWord) {
        if (roundOn) {
            // 单轮循环：记录本轮判定（与记忆队列可共存）
            list.roundKnown = list.roundKnown || [];
            list.roundUnknown = list.roundUnknown || [];
            const w = list.selectedWord.word;
            if (num === 0) {
                if (!list.roundUnknown.includes(w)) list.roundUnknown.push(w);
            } else if (!list.roundKnown.includes(w)) {
                list.roundKnown.push(w);
            }
        }
        if (queueMode) {
            // 记忆队列：不认识 → 放队列末尾（稍后再次显示）；认识 → 消费（不放回）
            if (num === 0) _memoryQueue.push(list.selectedWord);
        } else if (num === 0 && !roundOn) {
            // 普通模式：不认识放回待抽取；单轮循环模式下不放回（本轮结束后统一统计处理，否则本轮永远抽不完）
            list.pendingWords.push(list.selectedWord);
        }
        // 记住本词表的上一个判定词，切换词表后仍可显示各自的上一个单词
        list.lastJudged = list.selectedWord.word + ' — ' + (list.selectedWord.meaning || '');
        list.lastJudgedWord = list.selectedWord.word;
        const lastEl = document.getElementById('lastWord');
        if (lastEl) lastEl.textContent = list.lastJudged;
    }

    // ---- 待抽取为空：单轮循环结束统计，或提示用户重置 ----
    if (!queueMode && list.pendingWords.length === 0) {
        list.selectedWord = null;
        saveWordData(data);
        updateRemainCount();
        const hasResult = (list.roundKnown || []).length + (list.roundUnknown || []).length > 0;
        if (roundOn && hasResult) {
            finishRound();
            return;
        }
        showToast('待抽取为空，请重置抽取或添加新单词', 'warning');
        showPlaceholder('待抽取为空');
        setJudgementEnabled(false);
        document.getElementById('startButton').disabled = false;
        return;
    }

    // ---- 抽下一个 ----
    if (queueMode) {
        // 首次进入 / 队列耗尽时按队列长度建立，出队后再补位
        fillQueue();
        if (_memoryQueue.length === 0) {
            // 队列与待抽取都为空：全部消耗完
            list.selectedWord = null;
            saveWordData(data);
            showToast('待抽取为空，请重置抽取或添加新单词', 'warning');
            showPlaceholder('待抽取为空');
            setJudgementEnabled(false);
            document.getElementById('startButton').disabled = false;
            updateRemainCount();
            return;
        }
        list.selectedWord = _memoryQueue.shift();
        // 认识 = 消费掉一个 → 补一个；不认识 = 放回队尾 → 长度不变，不会补
        fillQueue();
    } else {
        // 普通/单轮：抽新词（尽量不与上一个抽出的单词相同）
        const prev = list.selectedWord;
        let pool = list.pendingWords;
        if (pool.length > 1 && prev) {
            const pw = String(prev.word || '').toLowerCase();
            const filtered = pw ? pool.filter(w => String(w.word || '').toLowerCase() !== pw) : [];
            if (filtered.length > 0) pool = filtered;
        }
        const picked = pool[Math.floor(_rng() * pool.length)];
        list.selectedWord = list.pendingWords.splice(list.pendingWords.indexOf(picked), 1)[0];
    }
    // 记忆队列引用持久化到词表（刷新后仍可恢复，待抽取个数准确）
    list.queueWords = _memoryQueue.map(w => w.word);
    saveWordData(data);

    renderCurrentWord();
    // 显示意思按钮常开；认识/不认识需先点一次显示意思
    setJudgementEnabled(false);
    createOptions();
    refreshCurrentList();
    updateRemainCount();
    // 自动播放（未开词意互换）：新词一出现就朗读
    if (isAutoSpeakOn() && !isSwapOn()) speakWord();
}

function startDraw() {
    document.getElementById('startButton').disabled = true;
    drawWord(1);
}

function toggleMeaning() {
    const list = getActiveList();
    if (!list || !list.selectedWord) return;
    const meaningEl = document.getElementById('currentMeaning');
    if (!meaningEl) return;
    if (meaningEl.classList.contains('hidden')) {
        meaningEl.classList.remove('hidden');
        // 首次显示时激活认识/不认识
        setJudgementEnabled(true);
        // 词意互换 + 拼写同时开启：点击显示单词时比对拼写输入框并着色
        const spellInputEl = document.getElementById('spellInput');
        const spellBtn = document.getElementById('spellBtn');
        if (spellInputEl && isSwapOn() && spellBtn && spellBtn.checked) {
            const typed = (spellInputEl.value || '').trim().toLowerCase();
            const target = String(list.selectedWord.word || '').toLowerCase();
            spellInputEl.style.color = (typed === target) ? '#67c23a' : '#f56c6c';
        }
        // 自动播放（词意互换）：点「显示单词」揭示后朗读
        if (isAutoSpeakOn() && isSwapOn()) speakWord();
    } else {
        meaningEl.classList.add('hidden');
    }
    // 音标跟随单词显现：词意互换时随单词一起出现/一起隐藏
    updatePhoneticDisplay();
}

// ---------- 批量添加单词 ----------
// 词表追加逻辑与我的词典页共用（见 common.js 的 appendWordsToList）

// 添加/导入完成后同步“开始抽取”按钮可用状态
function syncStartButton() {
    const list = getActiveList();
    const btn = document.getElementById('startButton');
    if (!list || !btn) return;
    if (!list.selectedWord && list.pendingWords.length > 0) btn.disabled = false;
}

// 每行一个单词；行内可用 # 指定自定义意思（# 后为释义），无 # 则查词典，词典无此词视为失败
async function addWords() {
    const inputEl = document.getElementById('wordInput');
    const parsed = parseWordInput(inputEl ? inputEl.value : '');
    if (parsed.length === 0) {
        showToast('请输入单词内容', 'error');
        return;
    }

    const data = getWordData();
    const list = getActiveList(data);
    if (!list) return;

    // 无 # 的单词需要查词典；有 # 的单词直接用自定义释义
    const { words, failed, dictMissing } = await buildWordObjects(parsed);
    if (dictMissing) {
        showToast('词典未下载，请先到「我的词典」页面下载词典；或用 word#释义 填写自定义意思', 'error');
        return;
    }

    const addedCount = appendWordsToList(list, words);
    list.words.sort((a, b) => a.word.localeCompare(b.word));
    list.pendingWords.sort((a, b) => a.word.localeCompare(b.word));

    saveWordData(data);
    if (inputEl) inputEl.value = '';

    // 失败单词显示在添加单词区域下方（与我的词典页共用同一套展示）
    renderAddFailed('addFailedList', failed);

    let msg = '成功添加' + addedCount + '个新单词';
    if (failed.length > 0) msg += '，' + failed.length + '个失败';
    showToast(msg, failed.length > 0 ? 'error' : 'success');

    renderSidebarLists();
    refreshCurrentList();
    updateRemainCount();
    syncStartButton();
}

// ---------- 从 Excel/CSV 导入单词 ----------
// 第一列为单词、第二列为意思、第三列 mnemonic、第四列 phonetic（后续列允许为空）
function triggerExcelImport() {
    const input = document.getElementById('excelFileInput');
    if (input) input.click();
}

async function handleExcelFile(file) {
    if (!file) return;
    const data = getWordData();
    const list = getActiveList(data);
    if (!list) return;
    let result;
    try {
        // 与我的词典页共用同一套导入逻辑（表头跳过、按单词去重、words/pendingWords 同步）
        result = await importWordsFromFile(file, list);
    } catch (e) {
        console.warn('导入词表文件失败', e);
        showToast(e && e.message ? e.message : '读取文件失败', 'error');
        return;
    }

    if (result.added === 0) {
        showToast('未导入任何单词（请检查第 1 列为单词、第 2 列为意思）', 'error');
        return;
    }
    saveWordData(data);
    renderSidebarLists();
    refreshCurrentList();
    updateRemainCount();
    syncStartButton();
    showToast('成功导入 ' + result.added + ' 个单词' + (result.skipped ? '，跳过 ' + result.skipped + ' 个' : ''), 'success');
}

// ---------- 设置项小问号说明 ----------
function showHelp(text) {
    showToast(text, 'info');
}

// 添加失败单词展示与我的词典页共用（见 common.js 的 renderAddFailed）

// ---------- 预设词表（已移至「我的词典」页，每本词典行下拉框创建） ----------

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
    setStoredFlag('swapMeaning', swap);
    // 1) 字体互换：意思用小字号（绿）、单词用大字号（白），元素位置保持不变
    //    （currentWord 在上显示意思、currentMeaning 在下显示单词，即"意思上、单词下"）
    wordEl.classList.toggle('swap-mode', swap);
    meaningEl.classList.toggle('swap-mode', swap);
    // 2) 逻辑互换：显示按钮文字
    const showBtn = document.getElementById('showButton');
    if (showBtn) showBtn.textContent = swap ? '显示单词' : '显示意思';
    // 3) 逻辑互换：刷新当前显示内容与选项（若正在抽词）
    renderCurrentWord();
    createOptions();
    showOption();
}

// ---------- 记忆队列（开始抽取后建立队列，不认识放队尾、不抽新词） ----------
const QUEUE_SIZE_DEFAULT = 5; // 默认队列长度
let _memoryQueue = []; // 队列中的单词对象（已从待抽取中移出；视为未抽取，重置时放回）
function isQueueOn() {
    const b = document.getElementById('queueBtn');
    return !!(b && b.checked);
}
function getQueueSize() {
    const sel = document.getElementById('queueSizeSelect');
    if (sel) {
        const v = parseInt(sel.value, 10);
        if (v >= 3 && v <= 10) return v;
    }
    return getStoredInt('queueSize', 3, 10, QUEUE_SIZE_DEFAULT);
}
function applyQueueSize() {
    const sel = document.getElementById('queueSizeSelect');
    if (!sel) return;
    setStored('queueSize', sel.value);
    applyResetDraw();
    showToast('队列长度已设为 ' + getQueueSize(), 'success');
}
function applyQueue() {
    const b = document.getElementById('queueBtn');
    if (!b) return;
    const on = b.checked;
    setStoredFlag('queueMode', on);
    // 与单轮循环互斥：开启记忆队列时自动关闭单轮循环
    if (on) {
        const roundBtn = document.getElementById('roundBtn');
        if (roundBtn && roundBtn.checked) {
            roundBtn.checked = false;
            setStoredFlag('roundMode', false);
        }
    }
    // 开启时显示"队列长度"详细设置分组
    const sub = document.getElementById('queueSubBox');
    if (sub) sub.classList.toggle('hidden', !on);
    applyResetDraw(); // 会同时清空 roundKnown/roundUnknown、记忆队列并保存
    showToast(on ? '已开启记忆队列（不认识放入队尾，不抽取新单词）' : '已关闭记忆队列', 'success');
}

// ---------- 单轮循环 ----------
function applyRound() {
    const roundBtn = document.getElementById('roundBtn');
    if (!roundBtn) return;
    const on = roundBtn.checked;
    setStoredFlag('roundMode', on);
    // 与记忆队列互斥：开启单轮循环时自动关闭记忆队列
    if (on) {
        const queueBtn = document.getElementById('queueBtn');
        if (queueBtn && queueBtn.checked) {
            queueBtn.checked = false;
            setStoredFlag('queueMode', false);
            const queueSub = document.getElementById('queueSubBox');
            if (queueSub) queueSub.classList.add('hidden');
        }
    }
    // 切换时清空本轮判定记录并重置抽取
    if (getActiveList()) applyResetDraw();
    showToast(on ? '已开启单轮循环（不放回抽词）' : '已关闭单轮循环', 'success');
}

function finishRound() {
    const list = getActiveList();
    const known = ((list && list.roundKnown) || []).length;
    const unknown = ((list && list.roundUnknown) || []).length;
    const summary = document.getElementById('roundSummary');
    if (summary) summary.textContent = '本轮认识 ' + known + ' 个，不认识 ' + unknown + ' 个';
    showPlaceholder('本轮抽完，请处理结果');
    document.getElementById('startButton').disabled = true;
    setJudgementEnabled(false);
    openModal('roundModal');
}

// 单轮循环结果处理：三个操作都会回到“本轮结束并重置抽取”的同一状态
function finishRoundAndReset() {
    closeModal('roundModal');
    renderSidebarLists();
    applyResetDraw();
}

function roundDeleteKnown() {
    const data = getWordData();
    const list = getActiveList(data);
    if (!list) return;
    const known = list.roundKnown || [];
    if (known.length === 0) { showToast('本轮没有认识的单词', 'warning'); return; }
    const delSet = new Set(known.map(w => String(w).toLowerCase()));
    list.words = list.words.filter(w => !delSet.has(String(w.word).toLowerCase()));
    finishRoundAndReset();
    showToast('已删除 ' + known.length + ' 个认识的单词', 'success');
}

async function roundCreateUnknownList() {
    const data = getWordData();
    const list = getActiveList(data);
    if (!list) return;
    const unknownSet = new Set((list.roundUnknown || []).map(w => String(w).toLowerCase()));
    if (unknownSet.size === 0) { showToast('本轮没有不认识的单词', 'warning'); return; }
    // 拆分：从当前词表取出不认识的单词（不再复制留底）
    const splitOut = list.words.filter(w => unknownSet.has(String(w.word).toLowerCase()));
    if (splitOut.length === 0) { showToast('未找到不认识的单词', 'warning'); return; }
    // 查词典补齐缺失释义（之前标记为“无释义”的也重试一次）
    splitOut.forEach(w => { if (w.meaning === '(无释义)') w.meaning = ''; });
    await fillMissingMeanings(splitOut);
    const newList = makeList(uniqueListNameIn(list.name + '-不认识', data.lists), splitOut);
    data.lists.push(newList);
    // 从原词表移除这些词（拆分语义）
    list.words = list.words.filter(w => !unknownSet.has(String(w.word).toLowerCase()));
    finishRoundAndReset();
    showToast('已拆分 ' + splitOut.length + ' 个不认识的单词到列表「' + newList.name + '」', 'success');
}

function roundFinishClose() {
    const list = getActiveList();
    if (list) {
        list.roundKnown = [];
        list.roundUnknown = [];
    }
    finishRoundAndReset();
    showToast('已结束本轮，未做处理', 'info');
}

// ---------- 显示音标 ----------
function isPhoneticOn() {
    const b = document.getElementById('phoneticBtn');
    return !!(b && b.checked);
}
function getWordPhonetic(w) {
    return (w && w.phonetic) ? w.phonetic : '';
}
const _phoneticLoading = new Set(); // 正在补查音标的单词（去重）
const _phoneticMissing = new Set(); // 词典中也查不到音标的单词，避免反复查询
// 当前单词是否已对用户揭示：词意互换时单词藏在 currentMeaning 中，未互换时单词常显
function isWordRevealed() {
    if (!isSwapOn()) return true;
    const meaningEl = document.getElementById('currentMeaning');
    return !!(meaningEl && !meaningEl.classList.contains('hidden'));
}
// 音标跟随单词：词意互换时单词在 currentMeaning（大白字），音标要落在它下面；未互换时回到单词与释义之间
function syncPhoneticPlacement() {
    const el = document.getElementById('currentPhonetic');
    const meaningEl = document.getElementById('currentMeaning');
    if (!el || !meaningEl || !meaningEl.parentNode) return;
    if (isSwapOn()) {
        if (meaningEl.nextSibling !== el) meaningEl.parentNode.insertBefore(el, meaningEl.nextSibling);
    } else if (el.nextSibling !== meaningEl) {
        meaningEl.parentNode.insertBefore(el, meaningEl);
    }
}
function updatePhoneticDisplay() {
    const el = document.getElementById('currentPhonetic');
    if (!el) return;
    syncPhoneticPlacement(); // 先按词意互换状态摆好位置，再决定是否显示
    const list = getActiveList();
    const w = list && list.selectedWord;
    if (!isPhoneticOn() || !w) {
        el.textContent = '';
        el.classList.add('hidden');
        el.style.visibility = '';
        return;
    }
    const ph = getWordPhonetic(w);
    if (!ph) ensurePhoneticAsync(w); // 缺音标时从词典异步补查（无论是否已揭示都先预查）
    if (!ph) {
        el.textContent = '';
        el.classList.add('hidden');
        el.style.visibility = '';
        return;
    }
    el.textContent = '/' + ph + '/';
    el.classList.remove('hidden');
    // 词意互换时音标随单词显现：单词未揭示则不可见，但保留占位（避免揭示时单词位置上下跳）
    el.style.visibility = isWordRevealed() ? '' : 'hidden';
}
// 从词典（IndexedDB）异步补查音标，查到后写回词表并刷新显示
async function ensurePhoneticAsync(w) {
    if (!w || w.phonetic || !isPhoneticOn()) return;
    const key = String(w.word || '').toLowerCase();
    if (!key || _phoneticLoading.has(key) || _phoneticMissing.has(key)) return;
    _phoneticLoading.add(key);
    try {
        const e = (await lookupWords([w.word])).get(key);
        if (e && e.phonetic) {
            w.phonetic = e.phonetic;
            saveWordData(getWordData());
            updatePhoneticDisplay();
        } else {
            _phoneticMissing.add(key);
        }
    } catch (e) {
        _phoneticMissing.add(key);
    } finally {
        _phoneticLoading.delete(key);
    }
}
// ---------- 点击显示区的单词：朗读一次（Web Speech API，语言由设置决定） ----------
// 语音总开关：关闭后点击单词与自动播放都不发声
function isSpeakEnabled() {
    const btn = document.getElementById('speakEnabledBtn');
    if (btn) return !!btn.checked;
    return getStoredFlag('speakEnabled', true);
}
function applySpeakEnabled() {
    const btn = document.getElementById('speakEnabledBtn');
    if (!btn) return;
    setStoredFlag('speakEnabled', btn.checked);
    const row = document.getElementById('autoSpeakRow');
    const auto = document.getElementById('autoSpeakBtn');
    if (row) row.classList.toggle('disabled', !btn.checked);
    if (auto) auto.disabled = !btn.checked;
    if (!btn.checked && window.speechSynthesis) {
        try { window.speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
    }
}
// 自动播放：未开词意互换时换词即读；开词意互换时揭示后读
function isAutoSpeakOn() {
    const btn = document.getElementById('autoSpeakBtn');
    if (btn) return !!btn.checked;
    return getStoredFlag('autoSpeak', false);
}
function applyAutoSpeak() {
    const btn = document.getElementById('autoSpeakBtn');
    if (!btn) return;
    setStoredFlag('autoSpeak', btn.checked);
}
// 语音语言白名单，与设置弹窗 #speakLangSelect 的选项一一对应
const SPEAK_LANGS = ['en-US', 'en-GB', 'zh-CN', 'fr-FR', 'ru-RU', 'es-ES', 'ar-SA', 'ja-JP', 'ko-KR'];
const SPEAK_LANG_NAMES = { 'en-US': '英语（美）', 'en-GB': '英语（英）', 'zh-CN': '汉语', 'fr-FR': '法语', 'ru-RU': '俄语', 'es-ES': '西班牙语', 'ar-SA': '阿拉伯语', 'ja-JP': '日语', 'ko-KR': '韩语' };
let _voiceCache = {}; // { "语言|音色": 语音对象 }，语音列表可能异步加载，取不到时下次再试
function getSpeakLang() {
    try {
        const v = localStorage.getItem('speakLang');
        if (v && SPEAK_LANGS.indexOf(v) >= 0) return v;
    } catch (e) { /* 隐私模式等场景忽略 */ }
    return 'en-US';
}
// 手动选中的音色：存 voiceURI + name + lang；切语言后若语种不符自动作废
function getSpeakVoice() {
    try {
        const uri = localStorage.getItem('speakVoiceURI') || '';
        const name = localStorage.getItem('speakVoiceName') || '';
        if (!uri && !name) return null;
        const vlang = localStorage.getItem('speakVoiceLang') || '';
        const base = String(getSpeakLang()).toLowerCase().split('-')[0];
        if (String(vlang).replace('_', '-').toLowerCase().split('-')[0] !== base) return null;
        return { uri: uri, name: name, lang: vlang };
    } catch (e) { return null; }
}
function setSpeakVoice(v) {
    try {
        if (!v) {
            localStorage.removeItem('speakVoiceURI');
            localStorage.removeItem('speakVoiceName');
            localStorage.removeItem('speakVoiceLang');
        } else {
            localStorage.setItem('speakVoiceURI', String(v.voiceURI || ''));
            localStorage.setItem('speakVoiceName', String(v.name || ''));
            localStorage.setItem('speakVoiceLang', String(v.lang || ''));
        }
    } catch (e) { /* 隐私模式等场景忽略 */ }
    _voiceCache = {}; // 换了音色，缓存作废
}
// 在系统语音列表里找回已保存的那个音色（voiceURI 优先，退回名称比对）
function findVoiceByStored(voices, sv) {
    if (!sv || !voices || !voices.length) return null;
    if (sv.uri) {
        for (let i = 0; i < voices.length; i++) {
            if (String(voices[i].voiceURI || '') === sv.uri) return voices[i];
        }
    }
    if (sv.name) {
        for (let i = 0; i < voices.length; i++) {
            if (String(voices[i].name || '') === sv.name) return voices[i];
        }
    }
    return null;
}
// 音色列表当前一组（供点击时按下标取对象）
let _voiceHits = [];
// 点击列表里的某条音色：保存选择 → 重渲染 → 试听一次
function selectVoice(i) {
    const v = _voiceHits[i];
    if (!v) return;
    setSpeakVoice(v);
    renderVoiceList();
    const list = getActiveList();
    const word = list && list.selectedWord ? String(list.selectedWord.word || '') : '';
    speakRaw(word || String(v.name || '')); // 试听不受「开启语音」总开关限制
}
function applySpeakLang() {
    const sel = document.getElementById('speakLangSelect');
    if (!sel || SPEAK_LANGS.indexOf(sel.value) < 0) return;
    setStored('speakLang', sel.value);
    setSpeakVoice(null); // 音色跨语种不通用：切语言即清空手选
    _voiceCache = {}; // 语言换了，重新挑语音
    if (!hasVoiceForLang(sel.value)) {
        showToast('当前设备没有「' + (SPEAK_LANG_NAMES[sel.value] || sel.value) + '」语音，只能用系统默认语音朗读', 'warning');
    }
    renderVoiceList();
}
// 系统是否装了该语言的语音；语音列表还没加载时返回 true，避免误报
function hasVoiceForLang(lang) {
    const synth = window.speechSynthesis;
    if (!synth || typeof synth.getVoices !== 'function') return false;
    const voices = synth.getVoices() || [];
    if (!voices.length) return true;
    const base = String(lang || '').replace('_', '-').toLowerCase().split('-')[0];
    return voices.some(function (v) {
        return String(v.lang || '').replace('_', '-').toLowerCase().split('-')[0] === base;
    });
}
// 设置弹窗分页切换（单词设置 / 语音设置）
function switchSettingsTab(name) {
    const tabs = document.querySelectorAll('.settings-tab');
    for (let i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === name);
    }
    const word = document.getElementById('settingsPaneWord');
    const voice = document.getElementById('settingsPaneVoice');
    if (word) word.classList.toggle('hidden', name !== 'word');
    if (voice) voice.classList.toggle('hidden', name !== 'voice');
    if (name === 'voice') renderVoiceList();
}
// 语音设置：列出当前语言可用的系统音色（点击即可选中并试听）
function renderVoiceList() {
    const listEl = document.getElementById('voiceList');
    if (!listEl) return;
    const countEl = document.getElementById('voiceCount');
    const synth = window.speechSynthesis;
    if (!synth || typeof synth.getVoices !== 'function') {
        if (countEl) countEl.textContent = '不支持';
        listEl.innerHTML = '<span class="voice-empty">当前浏览器不支持语音朗读</span>';
        return;
    }
    const lang = getSpeakLang();
    const key = String(lang).replace('_', '-').toLowerCase();
    const base = key.split('-')[0];
    const all = synth.getVoices() || [];
    const exact = [];
    const same = [];
    for (let i = 0; i < all.length; i++) {
        const vl = String(all[i].lang || '').replace('_', '-').toLowerCase();
        if (vl === key) exact.push(all[i]);
        else if (vl.split('-')[0] === base) same.push(all[i]);
    }
    const hits = exact.length ? exact : same; // 有同地区音色就用它们，否则退回同语种
    _voiceHits = hits; // 点击音色时按下标取对象
    if (countEl) {
        let txt;
        if (exact.length) {
            txt = exact.length + ' 个（' + lang + '）';
            if (same.length) txt += '，另有 ' + same.length + ' 个其他变体';
        } else if (same.length) {
            txt = '无 ' + lang + ' 专用音色，退回 ' + same.length + ' 个同语种音色';
        } else {
            txt = '0 个（' + lang + '）';
        }
        countEl.textContent = txt;
    }
    if (!hits.length) {
        listEl.innerHTML = '<span class="voice-empty">' + (all.length
            ? '当前语言没有可用音色，可点「检测」查看安装方法'
            : '未检测到语音，点上面「检测」唤醒后会自动刷新') + '</span>';
        return;
    }
    const sv = getSpeakVoice();
    const picked = findVoiceByStored(hits, sv);
    listEl.innerHTML = hits.map(function (v, i) {
        const name = escapeHtml(String(v.name || '未命名'));
        const lg = escapeHtml(String(v.lang || ''));
        // 手选过就标在手选那条上；没手选时第一条即自动挑选的结果
        const isOn = picked ? v === picked : i === 0;
        const mark = isOn ? (picked ? '使用中' : '默认') : '';
        return '<button type="button" class="voice-item' + (isOn ? ' on' : '') + '" onclick="selectVoice(' + i + ')">' +
            '<span class="voice-name">' + (i + 1) + '. ' + name + '</span>' +
            '<span class="voice-meta">' + lg + (v.localService ? '' : ' · 在线') +
            (mark ? ' · <span class="voice-cur">' + mark + '</span>' : '') + '</span></button>';
    }).join('');
}
// 手动检测：当前语言是否装了对应语音包（语音列表异步加载，最多等 2 秒）
function checkVoicePack() {
    const lang = getSpeakLang();
    const name = SPEAK_LANG_NAMES[lang] || lang;
    const synth = window.speechSynthesis;
    if (!synth || typeof synth.getVoices !== 'function' || typeof window.SpeechSynthesisUtterance !== 'function') {
        showToast('当前浏览器不支持语音朗读，无法检测语音包', 'error');
        return;
    }
    const base = String(lang).toLowerCase().split('-')[0];
    const deadline = Date.now() + 2000;
    const report = function (voices) {
        const hits = voices.filter(function (v) {
            return String(v.lang || '').replace('_', '-').toLowerCase().split('-')[0] === base;
        });
        if (hits.length) {
            showToast('已检测到「' + name + '」语音：' + hits[0].name + '（' + hits[0].lang + '），系统共 ' + voices.length + ' 个语音', 'success');
        } else if (!voices.length) {
            showToast('系统没有返回任何语音数据。安卓：设置 → 文字转语音 → 安装语音数据；iPhone：设置 → 辅助功能 → 朗读内容 → 声音', 'warning');
        } else {
            showToast('未检测到「' + name + '」语音（系统共 ' + voices.length + ' 个语音）。安卓：设置 → 文字转语音 → 安装语音数据；iPhone：设置 → 辅助功能 → 朗读内容 → 声音', 'warning');
        }
    };
    const tick = function () {
        const voices = synth.getVoices() || [];
        if (voices.length || Date.now() >= deadline) { report(voices); return; }
        setTimeout(tick, 200);
    };
    tick();
}
function pickVoiceFor(lang) {
    const synth = window.speechSynthesis;
    if (!synth || typeof synth.getVoices !== 'function') return null;
    const voices = synth.getVoices() || [];
    const chosen = findVoiceByStored(voices, getSpeakVoice());
    if (chosen) return chosen; // 用户手选的音色优先
    const key = String(lang || '').replace('_', '-').toLowerCase();
    const base = key.split('-')[0];
    let sameBase = null;
    for (const v of voices) {
        const vl = String(v.lang || '').replace('_', '-').toLowerCase();
        if (vl === key) return v; // 精确匹配优先（en-US / zh-CN …）
        if (!sameBase && vl.split('-')[0] === base) sameBase = v; // 同语种兜底（en-GB / en-AU …）
    }
    return sameBase;
}
// 朗读任意文本（显示区、上一个单词详细弹窗都用这里）
function speakText(text) {
    if (!isSpeakEnabled()) return; // 语音总开关关闭时一律不发声
    speakRaw(text);
}
// 真正发声：试听音色也走这里（不受「开启语音」总开关限制）
function speakRaw(text) {
    const synth = window.speechSynthesis;
    if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') return;
    const w = String(text || '').trim();
    if (!w) return;
    const lang = getSpeakLang();
    const u = new SpeechSynthesisUtterance(w);
    u.lang = lang;
    u.rate = 1;
    u.pitch = 1;
    // 缓存键带音色：手选音色与自动挑选分开缓存，切换后不会串音
    const sv = getSpeakVoice();
    const cacheKey = lang + '|' + (sv ? (sv.uri || sv.name || '') : 'auto');
    if (!_voiceCache[cacheKey]) _voiceCache[cacheKey] = pickVoiceFor(lang);
    if (_voiceCache[cacheKey]) u.voice = _voiceCache[cacheKey];
    // 仅在确实正在朗读时打断，避免每次点击都重启语音引擎（这是之前那 60ms 延迟的来源）
    if (synth.speaking || synth.pending) {
        try { synth.cancel(); } catch (e) { /* 忽略 */ }
    }
    try { if (synth.paused) synth.resume(); } catch (e) { /* 忽略 */ }
    try { synth.speak(u); } catch (e) { /* 忽略 */ }
}

// 朗读当前抽中的单词（显示区点击 / 自动播放）
function speakWord() {
    const list = getActiveList();
    speakText(list && list.selectedWord ? String(list.selectedWord.word || '') : '');
}

// 让任意元素可点击发音：可点手势 + 点击缩放动画 + 朗读 getText() 返回的文本
function bindSpeakEl(el, getText) {
    if (!el) return;
    el.classList.add('speakable');
    let lastPointerUp = 0;
    const fire = () => {
        // 点击缩放动画：先移除再重排，保证连续点击也能重播
        el.classList.remove('word-tap');
        void el.offsetWidth;
        el.classList.add('word-tap');
        speakText(getText());
    };
    el.addEventListener('pointerup', () => {
        lastPointerUp = Date.now();
        fire();
    });
    el.addEventListener('click', () => {
        if (Date.now() - lastPointerUp < 400) return; // 同一次触摸的 click 不重复朗读
        fire();
    });
    // 动画结束后清掉类名，避免残留（下次点击会重新移除并触发）
    el.addEventListener('animationend', () => el.classList.remove('word-tap'));
}

function applyPhonetic() {
    const b = document.getElementById('phoneticBtn');
    if (!b) return;    setStoredFlag('phoneticMode', b.checked);
    updatePhoneticDisplay();
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
        setStoredFlag('optionMode', false);
    }
    setStoredFlag('spellMode', on);
    updateSpellInput();
    showOption();
}

// ---------- 拆分词表（随机抽取 X 个词组成新词表，并从原词表删除） ----------
function splitWords() {
    const data = getWordData();
    const list = getActiveList(data);
    if (!list) return;
    const input = document.getElementById('splitCount');
    const n = input ? parseInt(input.value, 10) : NaN;
    if (!n || n < 1 || n > list.words.length) {
        showToast('请输入有效的拆分数量（1 ~ ' + list.words.length + '）', 'error');
        return;
    }
    // 随机抽取 n 个不重复的词
    const pool = list.words.slice();
    const picked = [];
    for (let i = 0; i < n; i++) {
        picked.push(pool.splice(Math.floor(_rng() * pool.length), 1)[0]);
    }
    const pickedSet = new Set(picked.map(w => String(w.word).toLowerCase()));

    // 自动生成新词表名称（避免重名：名称-拆分、名称-拆分1、...）
    const newList = makeList(uniqueListNameIn(list.name + '-拆分', data.lists), picked);
    // 从原词表删除被抽中的词，并同步清理队列/判定记录，避免残留已不存在的单词
    list.words = list.words.filter(w => !pickedSet.has(String(w.word).toLowerCase()));
    list.pendingWords = list.pendingWords.filter(w => !pickedSet.has(String(w.word).toLowerCase()));
    if (list.selectedWord && pickedSet.has(String(list.selectedWord.word).toLowerCase())) {
        list.selectedWord = null;
    }
    list.queueWords = (list.queueWords || []).filter(w => !pickedSet.has(String(w).toLowerCase()));
    if (Array.isArray(list.roundKnown)) list.roundKnown = list.roundKnown.filter(w => !pickedSet.has(String(w).toLowerCase()));
    if (Array.isArray(list.roundUnknown)) list.roundUnknown = list.roundUnknown.filter(w => !pickedSet.has(String(w).toLowerCase()));

    data.lists.push(newList);
    data.activeListId = newList.id;
    saveWordData(data);
    closeModal('listModal');
    renderSidebarLists();
    updateDraw();
    // 拆分结束后对当前（新）词表自动重置抽取记录
    applyResetDraw();
    showToast('已从「' + list.name + '」随机拆分出 ' + picked.length + ' 个单词，组成新词表「' + newList.name + '」', 'success');
}

// ---------- 重置抽取 ----------
// 执行重置抽取（无确认弹窗），供重置按钮、拆分、合并后自动调用
function applyResetDraw() {
    const data = getWordData();
    const list = getActiveList(data);
    if (!list) return;

    clearTimeout(_autoConfirmTimer); // 取消待定的自动跳转
    _memoryQueue = []; // 清空记忆队列
    list.selectedWord = null;
    list.pendingWords = [...list.words];
    list.lastJudged = null; // 先清空再保存，确保刷新后"上一个单词"不残留
    list.lastJudgedWord = null;
    list.queueWords = []; // 同步清空持久化队列引用
    // 清空单轮循环判定记录：必须放在保存之前，否则刷新后仍会残留
    list.roundKnown = [];
    list.roundUnknown = [];
    saveWordData(data);

    showPlaceholder('已重置，请开始抽取');
    const lastEl = document.getElementById('lastWord');
    if (lastEl) lastEl.textContent = '上一个单词';

    // 清空选项（按选项个数显隐、全部禁用）
    resetOptionButtons(true);
    // 按选择题开关状态决定选项区显隐（开启选项时重置后不应隐藏）
    showOption();

    const startBtn = document.getElementById('startButton');
    if (startBtn) startBtn.disabled = false;
    setJudgementEnabled(false);

    refreshCurrentList();
    updateRemainCount();
}

function resetDraw() {
    showConfirm('确定要重置抽取记录吗？待抽取将重置为全部单词', () => {
        initRandomSeed(); // 重置为新会话，种子更新为当前时间
        applyResetDraw();
        showToast('抽取记录已重置完成', 'success');
    });
}

// ---------- 清空当前词表 ----------
function clearAllWords() {
    showConfirm('⚠️ 警告：此操作将永久删除当前词表的所有单词，无法恢复！确定继续吗？', () => {
        const data = getWordData();
        const list = getActiveList(data);
        if (!list) return;

        list.words = [];
        list.pendingWords = [];
        list.selectedWord = null;
        list.lastJudged = null; // 先清空再保存，避免刷新后残留
        list.lastJudgedWord = null;
        list.queueWords = [];
        list.roundKnown = [];
        list.roundUnknown = [];
        _memoryQueue = [];
        _wordListSearch = '';
        saveWordData(data);

        showPlaceholder('请添加单词');
        const lastEl = document.getElementById('lastWord');
        if (lastEl) lastEl.textContent = '上一个单词';
        const wlSearch = document.getElementById('wordListSearch');
        if (wlSearch) wlSearch.value = '';
        const displayEl = document.getElementById('wordListDisplay');
        if (displayEl) displayEl.innerHTML = '<div class="word-item">暂无单词</div>';
        const countEl = document.getElementById('wordCount');
        if (countEl) countEl.textContent = '单词总数：0';

        resetOptionButtons(true);
        showOption();
        const startBtn = document.getElementById('startButton');
        if (startBtn) startBtn.disabled = false;
        setJudgementEnabled(false);

        renderSidebarLists();
        updateRemainCount();
        showToast('✅ 已清空当前词表！', 'success');
    });
}

// ---------- 页面初始化（脚本在body末尾，DOM已就绪） ----------
(async function init() {
    if (!document.getElementById('remainCount')) return;

    const setChecked = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.checked = !!value;
        return el;
    };

    await initStorage();
    initRandomSeed(); // 种子 = 当前时间（YYYYMMDDHHMMSS）
    renderSidebarLists();
    refreshCurrentList();
    updateDraw();

    // 恢复全部设置项（统一由 getStoredFlag / getStoredInt 读取，失败时使用默认值）
    const switchBtn = setChecked('switchBtn', getStoredFlag('optionMode', true));
    setChecked('swapBtn', getStoredFlag('swapMeaning', false));
    const roundBtn = setChecked('roundBtn', getStoredFlag('roundMode', false));
    const queueBtn = setChecked('queueBtn', getStoredFlag('queueMode', false));
    setChecked('phoneticBtn', getStoredFlag('phoneticMode', false));
    const spellBtn = setChecked('spellBtn', getStoredFlag('spellMode', false));
    setChecked('detailMeaningBtn', getStoredFlag('detailMeaningMode', false));
    setChecked('closeManualConfirmBtn', getStoredFlag('autoConfirmMode', false));
    setChecked('speakEnabledBtn', getStoredFlag('speakEnabled', true));
    setChecked('autoSpeakBtn', getStoredFlag('autoSpeak', false));

    const queueSizeSel = document.getElementById('queueSizeSelect');
    if (queueSizeSel) queueSizeSel.value = String(getStoredInt('queueSize', 3, 10, QUEUE_SIZE_DEFAULT));
    const optionCountSelect = document.getElementById('optionCountSelect');
    if (optionCountSelect) optionCountSelect.value = String(getStoredInt('optionCount', 3, 6, 4));
    const speakLangSel = document.getElementById('speakLangSelect');
    if (speakLangSel) speakLangSel.value = getSpeakLang();

    // 互斥兜底：记忆队列与单轮循环、拼写与选项不同时开启
    if (queueBtn && queueBtn.checked && roundBtn && roundBtn.checked) {
        roundBtn.checked = false;
        setStoredFlag('roundMode', false);
    }
    if (switchBtn && spellBtn && spellBtn.checked && switchBtn.checked) {
        switchBtn.checked = false;
        setStoredFlag('optionMode', false);
    }
    // 恢复时同步"队列长度"子框显隐
    const queueSub = document.getElementById('queueSubBox');
    if (queueSub) queueSub.classList.toggle('hidden', !(queueBtn && queueBtn.checked));

    // 应用设置：词意互换（含字体/按钮文案/选项）、拼写框、音标、选项区
    applySwap();
    applySpeakEnabled(); // 同步「自动播放」行的可用状态
    updateSpellInput();
    updatePhoneticDisplay();
    createOptions();
    showOption();

    // 选择题开关：用户切换时持久化 optionMode
    if (switchBtn) {
        switchBtn.addEventListener('change', () => setStoredFlag('optionMode', switchBtn.checked));
    }

    // 点击"上一个单词"/当前单词/当前意思 查看详细（弹窗，不再跳转查单词页）
    // 同时监听 pointerup 与 click：移动端触摸环境下 click 可能丢失，pointerup 兜底；
    // pointerup 后 400ms 内到达的 click 视为同一次触摸，避免弹窗被打开两次
    function bindWordDetailClick(el, getWord) {
        if (!el) return;
        let lastPointerUp = 0;
        el.addEventListener('pointerup', () => {
            lastPointerUp = Date.now();
            const w = getWord();
            if (w) showWordDetail(w);
        });
        el.addEventListener('click', () => {
            if (Date.now() - lastPointerUp < 400) return;
            const w = getWord();
            if (w) showWordDetail(w);
        });
    }
    // 只有「上一个单词」可点开详细；显示区的单词与释义不弹详细
    bindWordDetailClick(document.getElementById('lastWord'), () => {
        const list = getActiveList();
        return list && (list.lastJudgedWord || (list.lastJudged ? list.lastJudged.split(' — ')[0] : ''));
    });

    // 点击显示区的“单词”朗读一次（美式发音）：词意互换时单词在 currentMeaning，未互换时在 currentWord
    function bindSpeakOnDisplay(el) {
        if (!el) return;
        let lastPointerUp = 0;
        const fire = () => {
            const showingWordId = isSwapOn() ? 'currentMeaning' : 'currentWord';
            if (el.id !== showingWordId) return;
            // 点击缩放动画：先移除再重排，保证连续点击也能重播
            el.classList.remove('word-tap');
            void el.offsetWidth;
            el.classList.add('word-tap');
            speakWord();
        };
        el.addEventListener('pointerup', () => {
            lastPointerUp = Date.now();
            fire();
        });
        el.addEventListener('click', () => {
            if (Date.now() - lastPointerUp < 400) return; // 同一次触摸的 click 不重复朗读
            fire();
        });
        // 动画结束后清掉类名，避免残留（下次点击会重新移除并触发）
        el.addEventListener('animationend', () => el.classList.remove('word-tap'));
    }
    bindSpeakOnDisplay(document.getElementById('currentWord'));
    bindSpeakOnDisplay(document.getElementById('currentMeaning'));
    // 语音列表异步加载（手机首次常返回空），加载完成后清缓存，下次点击重新挑语音
    if (window.speechSynthesis && typeof window.speechSynthesis.addEventListener === 'function') {
        window.speechSynthesis.addEventListener('voiceschanged', function () {
            _voiceCache = {};
            renderVoiceList();
        });
    }

    // 绑定底部按钮事件
    const footerBtns = document.querySelectorAll('.footer-icon-btn');
    if (footerBtns[0]) {
        footerBtns[0].addEventListener('click', function(e) {
            e.stopPropagation();
            openModal('settingsModal');
            renderVoiceList(); // 打开设置时刷新音色数量
            setTimeout(renderVoiceList, 600); // 语音列表异步加载，稍后再补一次
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

    // 初始化全部完成后再隐藏加载遮罩（避免遮罩提前消失、页面短暂空白）
    hideLoading();
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

