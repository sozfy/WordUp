// 预设词表汇总入口：8 套词表分别由 data/preset_<tag>.js 提供
// 加载顺序：preset_zk/gk/cet4/cet6/ky/ielts/toefl/gre.js → 本文件
window.PRESET_LISTS = [
    window.PRESET_zk,
    window.PRESET_gk,
    window.PRESET_cet4,
    window.PRESET_cet6,
    window.PRESET_ky,
    window.PRESET_ielts,
    window.PRESET_toefl,
    window.PRESET_gre,
].filter(Boolean);
