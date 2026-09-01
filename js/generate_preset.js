// 本地脚本：解析 ecdict.csv，按 tag 分类生成预设词表静态文件
// 运行：node generate_preset.js
const fs = require('fs');
const path = require('path');

function parseCSV(text) {
    const rows = [];
    let cur = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else { inQuotes = false; }
            } else { field += c; }
        } else {
            if (c === '"') { inQuotes = true; }
            else if (c === ',') { cur.push(field); field = ''; }
            else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
            else if (c === '\r') { /* ignore */ }
            else { field += c; }
        }
    }
    if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
    return rows;
}

const TAGS = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'ielts', 'toefl', 'gre'];
const TAG_NAMES = {
    'zk': '中考',
    'gk': '高考',
    'cet4': '大学英语四级',
    'cet6': '大学英语六级',
    'ky': '考研',
    'ielts': '雅思',
    'toefl': '托福',
    'gre': '美国研究生入学考试'
};

const csvPath = path.join(__dirname, '..', 'data', 'ecdict.csv');
console.log('读取 ecdict.csv...');
const text = fs.readFileSync(csvPath, 'utf8');
console.log('解析 CSV...');
const rows = parseCSV(text);
const headers = rows[0].map(h => h.trim());
const wordIdx = headers.indexOf('word');
const transIdx = headers.indexOf('translation');
const tagIdx = headers.indexOf('tag');

const tagMap = {};
TAGS.forEach(t => tagMap[t] = []);

console.log('按 tag 分类中...');
for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const word = row[wordIdx];
    const translation = row[transIdx] || '';
    const tag = row[tagIdx] || '';
    if (!word || !tag) continue;
    const tags = tag.split(/\s+/);
    tags.forEach(t => {
        if (tagMap[t]) {
            tagMap[t].push({ word, translation });
        }
    });
}

const result = TAGS.map(t => ({
    tag: t,
    name: TAG_NAMES[t],
    count: tagMap[t].length,
    words: tagMap[t]
}));

console.log('\n生成结果：');
result.forEach(r => console.log('  ' + r.name + ': ' + r.count + ' 词'));

const totalWords = result.reduce((s, r) => s + r.count, 0);
console.log('\n总计: ' + totalWords + ' 词条（含重复）');

// 按词表拆分输出：每个词表一个 preset_<tag>.js，另写汇总入口 preset_data.js
const outDir = path.join(__dirname, '..', 'data');
const entryLines = [
    '// 预设词表汇总入口：8 套词表分别由 data/preset_<tag>.js 提供',
    '// 加载顺序：preset_zk/gk/cet4/cet6/ky/ielts/toefl/gre.js → 本文件',
    'window.PRESET_LISTS = ['
];
result.forEach(r => {
    const fp = path.join(outDir, 'preset_' + r.tag + '.js');
    fs.writeFileSync(fp, 'window.PRESET_' + r.tag + ' = ' + JSON.stringify(r) + ';\n', 'utf8');
    console.log('  已写入 ' + path.relative(path.join(__dirname, '..'), fp));
    entryLines.push('    window.PRESET_' + r.tag + ',');
});
entryLines.push('].filter(Boolean);');
fs.writeFileSync(path.join(outDir, 'preset_data.js'), entryLines.join('\n') + '\n', 'utf8');
console.log('\n已生成 8 个词表文件 + 汇总入口 preset_data.js');
