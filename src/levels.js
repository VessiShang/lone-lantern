// 关卡与单位定义
window.LL = window.LL || {};
(function (LL) {
  'use strict';

  // 身位 = 44 世界像素
  LL.UNITS = {
    U: 44,            // 一个小人身位
    corridor: 5,      // 通道净宽（两墙之间）= 5 身位
    wall: 0.5,        // 墙厚 = 0.5 身位
    playerR: 0.5,     // 小人半径
    lanternR: 1.5,    // 提灯亮池半径（视觉参考）
    lightR: 4,        // 提灯照明硬边界 = 4 身位
    viewR: 10,        // 玩家视野半径（摄像机半高）= 10 身位
    pitR: 1.5,        // 陷阱坑洞半径（直径 3 身位）
    exitR: 1.35       // 出口触发半径
  };

  LL.LEVELS = [
    {
      id: 1,
      chapter: '第一章',
      name: '浅梦',
      difficulty: '简单',
      difficultyEn: 'EASY',
      desc: '低矮的石廊，风里只有灯芯的轻响。',
      cols: 7, rows: 7,
      seed: 20261111,
      pits: 5,
      emitters: 2,
      braid: 0.70,          // 死胡同被打通概率（越高越少岔路）
      arrowInterval: 3.0,   // 弓箭口发射周期（秒）
      arrowWindup: 0.60,    // 预瞄时长
      arrowSpeed: 11,       // 箭速（身位/秒）
      memory: 0,            // 已探索区域记忆亮度（关掉：大视野下会变成灰色污渍）
      lanternR: 1.5,
      lightR: 4,
      viewR: 10,            // 视野半径（摄像机半高）= 10 身位
      unlocked: true
    },
    {
      id: 2,
      chapter: '第二章',
      name: '回声',
      difficulty: '困难',
      difficultyEn: 'HARD',
      desc: '长廊长得不像话，箭矢会在石壁上回响。',
      cols: 13, rows: 13,
      seed: 20261112,
      pits: 24,
      emitters: 6,
      braid: 0.32,
      arrowInterval: 2.2,
      arrowWindup: 0.55,
      arrowSpeed: 13,
      memory: 0,
      lanternR: 1.5,
      lightR: 4,
      viewR: 10,
      unlocked: true
    },
    {
      id: 3,
      chapter: '第三章',
      name: '无归',
      difficulty: '地狱',
      difficultyEn: 'HELL',
      desc: '灯还会亮多久？没人知道这条路有没有尽头。',
      cols: 19, rows: 19,
      seed: 20261113,
      pits: 46,
      emitters: 11,
      braid: 0.12,
      arrowInterval: 1.9,
      arrowWindup: 0.50,
      arrowSpeed: 15,
      memory: 0,
      lanternR: 1.5,
      lightR: 4,
      viewR: 10,
      unlocked: true
    }
  ];
})(window.LL);
