// ==========================================================
// 每日任务页（DailyTasks.html）
// 词表绑定首次学习日期 → 按艾宾浩斯间隔自动排出后续复习日期
// 数据存 IndexedDB 与背单词词表同库（key = dailyTasks），读写见 common.js
// ==========================================================

let _daily = null;        // { intervals: number[], tasks: [] }
let _lists = [];          // 背单词页的词表（渲染时实时取名称与词数）
let _draftIntervals = []; // 设置区正在编辑的间隔，保存后才落库
let _editTaskId = null;   // 正在修改首次学习日期的任务 id

// ---------- 日期工具：统一用本地日期字符串 YYYY-MM-DD，避免时区偏移 ----------
function dtFmt(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function dtToday() {
    return dtFmt(new Date());
}

// 日期字符串 + n 天（按本地零点加减，不受时区影响）
function dtAddDays(str, n) {
    const p = String(str).split('-');
    return dtFmt(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n));
}

// b - a 的天数差
function dtDiffDays(a, b) {
    const pa = String(a).split('-'), pb = String(b).split('-');
    const da = new Date(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
    const db = new Date(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
    return Math.round((db - da) / 86400000);
}

const DT_WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function dtWeekday(str) {
    const p = String(str).split('-');
    return DT_WEEK[new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay()];
}

// 友好日期：今天 / 明天 / 昨天 +（M月D日 周X）
function dtLabel(str) {
    const diff = dtDiffDays(dtToday(), str);
    const p = String(str).split('-');
    const core = Number(p[1]) + '月' + Number(p[2]) + '日 ' + dtWeekday(str);
    const prefix = diff === 0 ? '今天' : diff === 1 ? '明天' : diff === -1 ? '昨天' : '';
    return prefix ? prefix + ' · ' + core : core;
}

// ---------- 初始化 ----------
document.addEventListener('DOMContentLoaded', initDailyPage);

async function initDailyPage() {
    _daily = await loadDailyTasks();
    _draftIntervals = _daily.intervals.slice();
    const wordData = await loadWordData();
    _lists = (wordData && Array.isArray(wordData.lists)) ? wordData.lists : [];
    await dtPurgeOrphans();

    const dateInput = document.getElementById('dtStartDate');
    if (dateInput) dateInput.value = dtToday();

    renderListSelect();
    renderAll();

    const sel = document.getElementById('dtListSelect');
    if (sel) {
        sel.addEventListener('change', renderPreview);
        // 每次展开下拉时按最新词表刷新（词表可能在别的标签页被改动）
        sel.addEventListener('focus', async () => {
            const wd = await loadWordData();
            _lists = (wd && Array.isArray(wd.lists)) ? wd.lists : [];
            renderListSelect();
            renderPreview();
        });
    }
    if (dateInput) dateInput.addEventListener('change', renderPreview);

    hideLoading();
}

// 清理指向已不存在词表的任务（词表删除时已级联删除，这里兜底历史残留）
// 词表读不到或为空时直接跳过，避免误删用户任务
async function dtPurgeOrphans() {
    if (!_lists.length) return;
    const ids = _lists.map(l => String(l.id));
    const before = _daily.tasks.length;
    _daily.tasks = _daily.tasks.filter(t => ids.indexOf(String(t.listId)) !== -1);
    const removed = before - _daily.tasks.length;
    if (removed > 0) {
        await saveDailyTasks(_daily);
        showToast('已清理 ' + removed + ' 个指向已删除词表的任务', 'warning');
    }
}

function dtListsById() {
    const map = {};
    _lists.forEach(l => { map[String(l.id)] = l; });
    return map;
}

// 某任务的全部复习节点：第 n 次复习日 = 首次日期 + 第 n 次间隔
function dtTaskOccurrences(task) {
    return _daily.intervals.map((gap, i) => {
        const n = i + 1;
        return {
            n: n,
            date: dtAddDays(task.startDate, gap),
            done: !!(task.doneKeys && task.doneKeys[String(n)])
        };
    });
}

// ---------- 添加任务 ----------
function renderListSelect() {
    const sel = document.getElementById('dtListSelect');
    const addBtn = document.getElementById('dtAddBtn');
    if (!sel) return;
    // 下拉只列还没有任务的词表：一个词表只排一次期
    const used = {};
    _daily.tasks.forEach(t => { used[String(t.listId)] = true; });
    const avail = _lists.filter(l => !used[String(l.id)]);
    if (!avail.length) {
        sel.innerHTML = '<option value="">（词表都已添加任务）</option>';
        sel.disabled = true;
        if (addBtn) addBtn.disabled = true;
        return;
    }
    const prev = sel.value;
    sel.innerHTML = avail.map(l =>
        '<option value="' + escapeHtml(String(l.id)) + '">' + escapeHtml(l.name) + '（' + l.words.length + ' 词）</option>'
    ).join('');
    if (prev && avail.some(l => String(l.id) === prev)) sel.value = prev;
    sel.disabled = false;
    if (addBtn) addBtn.disabled = false;
}

function renderPreview() {
    const box = document.getElementById('dtPreview');
    if (!box) return;
    const sel = document.getElementById('dtListSelect');
    const dateInput = document.getElementById('dtStartDate');
    const start = dateInput ? dateInput.value : '';
    if (!sel || !sel.value || !/^\d{4}-\d{2}-\d{2}$/.test(start)) { box.innerHTML = ''; return; }
    const list = _lists.find(l => String(l.id) === String(sel.value));
    if (!list) { box.innerHTML = ''; return; }

    let chips = '<span class="dt-chip dt-chip-start">首次学习 ' + dtLabel(start) + '</span>';
    _draftIntervals.forEach((gap, i) => {
        const date = dtAddDays(start, gap);
        chips += '<span class="dt-chip">第 ' + (i + 1) + ' 次 · ' + Number(date.split('-')[1]) + '/' + Number(date.split('-')[2]) + '</span>';
    });
    box.innerHTML = '<div class="dt-preview-title">「' + escapeHtml(list.name) + '」共 ' + _draftIntervals.length +
        ' 次复习，最后一次在 ' + dtAddDays(start, _draftIntervals[_draftIntervals.length - 1]) + '</div>' +
        '<div class="dt-chips">' + chips + '</div>';
}

async function addTask() {
    const sel = document.getElementById('dtListSelect');
    const dateInput = document.getElementById('dtStartDate');
    if (!sel || !dateInput) return;
    const list = _lists.find(l => String(l.id) === String(sel.value));
    if (!list) { showToast('请先选择一个词表', 'error'); return; }
    const startDate = dateInput.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) { showToast('请选择首次学习日期', 'error'); return; }

    const dup = _daily.tasks.some(t => String(t.listId) === String(list.id) && t.startDate === startDate);
    if (dup) { showToast('「' + list.name + '」在 ' + startDate + ' 已有任务', 'warning'); return; }

    const task = {
        id: 'dtask_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        listId: String(list.id),
        listName: list.name,
        startDate: startDate,
        doneKeys: {},
        createdAt: Date.now()
    };
    _daily.tasks.push(task);
    if (!(await saveDailyTasks(_daily))) {
        _daily.tasks.pop();
        showToast('保存失败，请重试', 'error');
        return;
    }
    renderAll();
    showToast('已添加：' + startDate + ' 学「' + list.name + '」，共 ' + _daily.intervals.length + ' 次复习', 'success');
}

// ---------- 间隔设置（弹窗） ----------
function openIntervalModal() {
    _draftIntervals = _daily.intervals.slice();
    renderIntervals();
    openModal('intervalModal');
}

function closeIntervalModal() {
    closeModal('intervalModal');
}

function renderIntervals() {
    const box = document.getElementById('dtIntervalInputs');
    if (!box) return;
    box.innerHTML = _draftIntervals.map((gap, i) =>
        '<label class="dt-interval-item">' +
            '<span class="dt-interval-label">第 ' + (i + 1) + ' 次</span>' +
            '<input type="number" min="1" max="365" step="1" value="' + gap + '" data-index="' + i + '" oninput="onIntervalInput(this)">' +
            '<span class="dt-interval-unit">天后</span>' +
        '</label>'
    ).join('');
    renderIntervalHint();
}

function renderIntervalHint() {
    const el = document.getElementById('dtIntervalHint');
    if (!el) return;
    el.textContent = '共 ' + _draftIntervals.length + ' 次复习，节点：首次学习后 ' + _draftIntervals.join('、') + ' 天';
}

// 输入时即时约束：不小于前一次；后面的节点被推平后同步显示
function onIntervalInput(el) {
    const i = Number(el.dataset.index);
    let v = parseInt(el.value, 10);
    const min = i > 0 ? _draftIntervals[i - 1] : 1;
    if (!isFinite(v) || v < min) { v = min; el.value = String(v); }
    if (v > 365) { v = 365; el.value = '365'; }
    _draftIntervals[i] = v;
    for (let k = i + 1; k < _draftIntervals.length; k++) {
        if (_draftIntervals[k] < v) {
            _draftIntervals[k] = v;
            const next = document.querySelector('#dtIntervalInputs input[data-index="' + k + '"]');
            if (next) next.value = String(v);
        }
    }
    renderIntervalHint();
    renderPreview();
}

function addIntervalRow() {
    if (_draftIntervals.length >= 8) { showToast('最多 8 次复习', 'warning'); return; }
    _draftIntervals.push(_draftIntervals[_draftIntervals.length - 1] || 1);
    renderIntervals();
    renderPreview();
}

function removeIntervalRow() {
    if (_draftIntervals.length <= 1) { showToast('至少保留 1 次复习', 'warning'); return; }
    _draftIntervals.pop();
    renderIntervals();
    renderPreview();
}

async function saveIntervals() {
    _daily.intervals = normalizeIntervals(_draftIntervals);
    _draftIntervals = _daily.intervals.slice();
    if (!(await saveDailyTasks(_daily))) { showToast('保存失败，请重试', 'error'); return; }
    renderIntervals();
    renderAll();
    closeIntervalModal();
    showToast('已保存间隔，全部任务按新间隔重算', 'success');
}

// ---------- 清单渲染 ----------
function renderAll() {
    renderPreview();
    const collected = dtCollectByDate();
    renderToday(collected.todayItems);
    renderFuture(collected.futureItems);
    renderTasks();
}

function dtCollectByDate() {
    const today = dtToday();
    const listsMap = dtListsById();
    const todayItems = [], futureItems = [];
    _daily.tasks.forEach(task => {
        dtTaskOccurrences(task).forEach(occ => {
            if (occ.date < today) return; // 已过去的复习忽略，不再提示逾期
            const item = { task: task, occ: occ, list: listsMap[String(task.listId)] || null };
            if (occ.date === today) todayItems.push(item);
            else futureItems.push(item);
        });
    });
    const nameOf = it => (it.list ? it.list.name : it.task.listName || '');
    todayItems.sort((a, b) => nameOf(a).localeCompare(nameOf(b) || '') || a.occ.n - b.occ.n);
    futureItems.sort((a, b) => a.occ.date.localeCompare(b.occ.date) || a.occ.n - b.occ.n);
    return { todayItems: todayItems, futureItems: futureItems };
}

// 今日任务卡片
function dtItemHtml(item) {
    const task = item.task, occ = item.occ, list = item.list;
    const name = list ? list.name : (task.listName || '已删除的词表');
    const meta = (list ? ('共 ' + list.words.length + ' 词') : '词表已删除') + ' · 第 ' + occ.n + ' 次复习';

    return '<div class="dt-card' + (occ.done ? ' is-done' : '') + '">' +
        '<div class="dt-card-main">' +
            '<div class="dt-card-name">' + escapeHtml(name) + '</div>' +
            '<div class="dt-card-meta">' + escapeHtml(meta) + '</div>' +
        '</div>' +
        '<button type="button" class="dt-check' + (occ.done ? ' is-on' : '') + '" onclick="dtToggleDone(\'' +
            task.id + '\',' + occ.n + ')">' + (occ.done ? '已完成' : '完成') + '</button>' +
    '</div>';
}

function renderToday(items) {
    const box = document.getElementById('dtTodayList');
    const count = document.getElementById('dtTodayCount');
    if (!box) return;
    const undone = items.filter(it => !it.occ.done).length;
    if (count) count.textContent = items.length ? ('（' + undone + ' / ' + items.length + ' 待完成）') : '';
    box.innerHTML = items.length
        ? items.map(dtItemHtml).join('')
        : '<div class="dt-empty">今天没有复习任务。</div>';
}

// 未来安排：一行一天，右侧当天复习摘要，超出用省略号
function renderFuture(items) {
    const box = document.getElementById('dtFutureList');
    if (!box) return;
    if (!items.length) { box.innerHTML = '<div class="dt-empty">暂无后续安排。</div>'; return; }
    const groups = {}, order = [];
    items.forEach(it => {
        if (!groups[it.occ.date]) { groups[it.occ.date] = []; order.push(it.occ.date); }
        groups[it.occ.date].push(it);
    });
    box.innerHTML = order.map(date => {
        const summary = groups[date].map(it => {
            const name = it.list ? it.list.name : (it.task.listName || '已删除的词表');
            return name + ' 第' + it.occ.n + '次';
        });
        const text = summary.join(' · ');
        return '<div class="dt-future-row">' +
            '<span class="dt-future-date">' + escapeHtml(dtLabel(date)) + '</span>' +
            '<span class="dt-future-items" title="' + escapeHtml(text) + '">' + escapeHtml(text) + '</span>' +
        '</div>';
    }).join('');
}

function renderTasks() {
    const box = document.getElementById('dtTaskList');
    if (!box) return;
    if (!_daily.tasks.length) {
        box.innerHTML = '<div class="dt-empty">还没有任务。</div>';
        return;
    }
    const listsMap = dtListsById();
    box.innerHTML = _daily.tasks.slice().sort((a, b) => a.startDate.localeCompare(b.startDate)).map(task => {
        const list = listsMap[String(task.listId)];
        const name = list ? list.name : (task.listName || '已删除的词表');
        return '<div class="dt-task-row">' +
            '<div class="dt-task-main">' +
                '<span class="dt-task-name">' + escapeHtml(name) + (list ? '' : '<span class="dt-tag">词表已删除</span>') + '</span>' +
                '<span class="dt-task-meta">首次学习 ' + escapeHtml(task.startDate) + '</span>' +
            '</div>' +
            '<button type="button" class="dt-edit" onclick="openEditTask(\'' + task.id + '\')">修改</button>' +
            '<button type="button" class="dt-del" onclick="dtDeleteTask(\'' + task.id + '\')">删除</button>' +
        '</div>';
    }).join('');
}

// ---------- 修改首次学习日期 ----------
function openEditTask(taskId) {
    const task = _daily.tasks.find(t => t.id === taskId);
    if (!task) return;
    const list = dtListsById()[String(task.listId)];
    _editTaskId = taskId;
    const nameEl = document.getElementById('dtEditName');
    if (nameEl) nameEl.textContent = list ? list.name : (task.listName || '已删除的词表');
    const dateEl = document.getElementById('dtEditDate');
    if (dateEl) dateEl.value = task.startDate;
    openModal('editTaskModal');
}

function closeEditTask() {
    _editTaskId = null;
    closeModal('editTaskModal');
}

async function saveTaskDate() {
    const task = _daily.tasks.find(t => t.id === _editTaskId);
    if (!task) { closeEditTask(); return; }
    const dateEl = document.getElementById('dtEditDate');
    const v = dateEl ? dateEl.value : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { showToast('请选择有效的日期', 'warning'); return; }
    if (v === task.startDate) { closeEditTask(); return; }
    task.startDate = v;
    if (!(await saveDailyTasks(_daily))) {
        _daily = await loadDailyTasks();
        showToast('保存失败，请重试', 'error');
    }
    renderAll();
    closeEditTask();
    showToast('已改首次学习日期，复习节点按当前间隔重算', 'success');
}

// ---------- 完成 / 删除 ----------
async function dtToggleDone(taskId, n) {
    const task = _daily.tasks.find(t => t.id === taskId);
    if (!task) return;
    task.doneKeys = task.doneKeys || {};
    const key = String(n);
    if (task.doneKeys[key]) delete task.doneKeys[key];
    else task.doneKeys[key] = true;
    if (!(await saveDailyTasks(_daily))) {
        _daily = await loadDailyTasks();
        showToast('保存失败，请重试', 'error');
    }
    renderAll();
}

function dtDeleteTask(taskId) {
    const task = _daily.tasks.find(t => t.id === taskId);
    if (!task) return;
    const listsMap = dtListsById();
    const list = listsMap[String(task.listId)];
    const name = list ? list.name : (task.listName || '已删除的词表');
    showConfirm('删除「' + name + '」从 ' + task.startDate + ' 开始的这个任务？该任务的全部复习安排都会移除。', async () => {
        _daily.tasks = _daily.tasks.filter(t => t.id !== taskId);
        if (!(await saveDailyTasks(_daily))) {
            _daily = await loadDailyTasks();
            showToast('保存失败，请重试', 'error');
        }
        renderAll();
        showToast('任务已删除', 'success');
    });
}
