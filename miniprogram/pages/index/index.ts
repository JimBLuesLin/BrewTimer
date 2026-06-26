// index.ts - 咖啡冲煮计时器

interface PourStage {
  name: string;
  startSeconds: number;
  endSeconds: number;
  targetWater: number;
  hint: string;
}

let timerInterval: number | null = null;

/** 大师配方 BVID 映射 */
const PRESET_BVIDS: Record<number, string> = {
  1: 'BV1Ex411w7fN',  // 粕谷哲 4:6 法
  2: 'BV1E4411174J',  // James Hoffmann V60
  3: 'BV1mW411T7ZJ',  // Scott Rao 两段法
};

Component({
  data: {
    // ============ 参数配置 ============
    methods: ['手冲', '冷萃'],
    methodIndex: 0,

    beans: ['埃塞俄比亚', '肯尼亚', '哥伦比亚', '危地马拉', '曼特宁', '拼配', '其他'],
    beansIndex: 0,

    roasts: ['浅度', '中浅', '中度', '中深', '深度'],
    roastIndex: 0,

    grinds: ['面粉状', '细砂糖', '白砂糖', '海盐状', '粗砂糖'],
    grindIndex: 0,

    weight: 15,
    weightOptions: [8, 10, 12, 13, 14, 15, 16, 18, 20, 22, 25, 28, 30, 35, 40],
    weightIndex: 4, // 默认 15g (索引4)

    // ============ 大师配方预设 ============
    presets: ['自定义参数', '粕谷哲 4:6 法', 'James Hoffmann V60', 'Scott Rao 两段法'],
    presetIndex: 0,
    isPresetLocked: false,
    showRoastWarning: false,

    // ============ 自动计算结果 ============
    temperature: 93,
    ratio: 16,
    totalWater: 240,

    // ============ 注水手法 ============
    pourStyles: ['三段式', '一刀流', '十段法'],
    pourStyleIndex: 0,

    // ============ 视图状态 ============
    isBrewing: false,

    // ============ 计时器 ============
    timerDisplay: '00:00',
    elapsedSeconds: 0,

    // ============ 当前阶段 ============
    currentStageName: '',
    currentStageTimeRange: '',
    currentStageTarget: 0,
    currentStageHint: '',
    stages: [] as PourStage[],
  },

  methods: {
    // ============ 参数变更处理 ============

    /** 冲煮方式变更（大师配方激活时锁定为手冲） */
    onMethodChange(e: WechatMiniprogram.CustomEvent) {
      if (this.data.presetIndex > 0) return;
      this.setData({ methodIndex: parseInt(e.detail.value, 10) });
      this.recalculate();
      this.recalculateStages();
    },

    /** 咖啡品种变更 */
    onBeansChange(e: WechatMiniprogram.CustomEvent) {
      this.setData({ beansIndex: parseInt(e.detail.value, 10) });
    },

    /** 烘焙程度变更 */
    onRoastChange(e: WechatMiniprogram.CustomEvent) {
      this.setData({ roastIndex: parseInt(e.detail.value, 10) });
      this.recalculate();
      this.recalculateStages();
      this.evaluateRoastWarning();
    },

    /** 研磨度变更（大师配方激活时锁定） */
    onGrindChange(e: WechatMiniprogram.CustomEvent) {
      if (this.data.isPresetLocked) return;
      this.setData({ grindIndex: parseInt(e.detail.value, 10) });
    },

    /** 粉量变更 */
    onWeightChange(e: WechatMiniprogram.CustomEvent) {
      const idx = parseInt(e.detail.value, 10);
      const val = this.data.weightOptions[idx];
      this.setData({ weightIndex: idx, weight: val });
      this.recalculate();
      this.recalculateStages();
    },

    /** 注水手法变更 */
    onPourStyleChange(e: WechatMiniprogram.CustomEvent) {
      this.setData({ pourStyleIndex: parseInt(e.detail.value, 10) });
      this.recalculateStages();
    },

    /** 大师配方变更 */
    onPresetChange(e: WechatMiniprogram.CustomEvent) {
      const idx = parseInt(e.detail.value, 10);
      if (idx > 0) {
        // 锁定研磨度映射: 1=粕谷哲→粗(海盐状/3), 2=Hoffmann→中细(细砂糖/1), 3=Rao→中(白砂糖/2)
        const grindMap: Record<number, number> = { 1: 3, 2: 1, 3: 2 };
        const newGrind = grindMap[idx] !== undefined ? grindMap[idx] : 0;
        this.setData({
          presetIndex: idx,
          methodIndex: 0,  // 大师配方锁定为手冲
          grindIndex: newGrind,
          isPresetLocked: true,
        });
      } else {
        this.setData({
          presetIndex: idx,
          isPresetLocked: false,
          showRoastWarning: false,
        });
      }
      this.recalculate();
      this.recalculateStages();
      if (idx > 0) this.evaluateRoastWarning();
    },

    /** 评估是否显示深烘预警（Hoffmann/Rao + 深度烘焙） */
    evaluateRoastWarning() {
      const { presetIndex, roastIndex } = this.data;
      const isTriggerPreset = presetIndex === 2 || presetIndex === 3;
      const isDarkRoast = roastIndex === 4; // '深度'
      this.setData({ showRoastWarning: isTriggerPreset && isDarkRoast });
    },

    /** 跳转 B 站观看大师教学视频 */
    openBilibiliVideo() {
      const bvid = PRESET_BVIDS[this.data.presetIndex];
      if (!bvid) return;

      wx.navigateToMiniProgram({
        appId: 'wx7564fd5313d24844',
        path: `pages/video/video?bvid=${bvid}`,
        fail: () => {
          // 降级：复制链接到剪贴板
          const url = `https://www.bilibili.com/video/${bvid}`;
          wx.setClipboardData({
            data: url,
            success: () => {
              wx.showToast({
                title: '跳转失败，已复制视频链接，请在浏览器中打开',
                icon: 'none',
                duration: 3000,
              });
            },
          });
        },
      });
    },

    // ============ 自动计算逻辑 ============

    /**
     * 根据"冲煮方式"、"烘焙程度"和"粉量"联动计算水温、粉水比、总水量
     */
    recalculate() {
      const { presetIndex, methodIndex, roastIndex, weight } = this.data;

      let temperature = 5;
      let ratio = 12;

      // 大师配方预设优先
      if (presetIndex === 1) {
        // 粕谷哲 4:6 法
        temperature = 92;
        ratio = 15;
      } else if (presetIndex === 2) {
        // James Hoffmann V60
        temperature = 99;
        ratio = 16.6;
      } else if (presetIndex === 3) {
        // Scott Rao 两段法
        temperature = 95;
        ratio = 16;
      } else {
        // 自定义参数 — 根据冲煮方式和烘焙程度联动
        const method = this.data.methods[methodIndex];
        const roast = this.data.roasts[roastIndex];

        if (method === '冷萃') {
          temperature = 5;
          ratio = 12;
        } else if (method === '手冲') {
          if (roast === '浅度') {
            temperature = 93;
            ratio = 16;
          } else if (roast === '中浅') {
            temperature = 91;
            ratio = 16;
          } else if (roast === '中度') {
            temperature = 90;
            ratio = 15;
          } else if (roast === '中深') {
            temperature = 87;
            ratio = 15;
          } else if (roast === '深度') {
            temperature = 85;
            ratio = 14;
          }
        }
      }

      const totalWater = Math.round(weight * ratio);

      this.setData({
        temperature,
        ratio,
        totalWater,
      });
    },

    // ============ 注水阶段计算 ============

    /**
     * 根据当前选择的手法、粉量和总水量，动态计算所有阶段
     */
    recalculateStages() {
      const { presetIndex, pourStyleIndex, weight, totalWater } = this.data;

      let stages: PourStage[] = [];

      // 大师配方专属分段
      if (presetIndex === 1) {
        // 粕谷哲 4:6 法
        stages = [
          { name: '第1段 · 焖蒸', startSeconds: 0, endSeconds: 45, targetWater: Math.round(totalWater * 0.2), hint: '第一段焖蒸，决定咖啡甜度' },
          { name: '第2段 · 注水', startSeconds: 45, endSeconds: 90, targetWater: Math.round(totalWater * 0.4), hint: '第二段注水，决定咖啡酸度' },
          { name: '第3段 · 注水', startSeconds: 90, endSeconds: 135, targetWater: Math.round(totalWater * 0.6), hint: '第三段注水，调节总体浓度' },
          { name: '第4段 · 注水', startSeconds: 135, endSeconds: 165, targetWater: Math.round(totalWater * 0.8), hint: '第四段注水，调节总体浓度' },
          { name: '第5段 · 收尾', startSeconds: 165, endSeconds: Number.MAX_SAFE_INTEGER, targetWater: totalWater, hint: '最后一段注水，等待滴滤完成' },
        ];
      } else if (presetIndex === 2) {
        // James Hoffmann V60
        stages = [
          { name: '第1段 · 焖蒸', startSeconds: 0, endSeconds: 45, targetWater: Math.round(weight * 3.33), hint: '焖蒸阶段：快速注水后拿起滤杯轻摇(Swirl)，确保粉水充分混合' },
          { name: '第2段 · 主注水', startSeconds: 45, endSeconds: 75, targetWater: Math.round(totalWater * 0.6), hint: '第一阶段主注水：缓慢平稳绕圈注水' },
          { name: '第3段 · 主注水', startSeconds: 75, endSeconds: Number.MAX_SAFE_INTEGER, targetWater: totalWater, hint: '第二阶段主注水：注水完成后轻拨十字，待水位稍降再次轻摇滤杯(Swirl)' },
        ];
      } else if (presetIndex === 3) {
        // Scott Rao 两段法
        stages = [
          { name: '第1段 · 焖蒸', startSeconds: 0, endSeconds: 45, targetWater: Math.round(weight * 3), hint: '快速注水焖蒸，使用小勺翻搅(Excavation)确保底层无干粉' },
          { name: '第2段 · 主注水', startSeconds: 45, endSeconds: 105, targetWater: totalWater, hint: '匀速绕圈注水至目标水量' },
          { name: '第3段 · 收尾', startSeconds: 105, endSeconds: Number.MAX_SAFE_INTEGER, targetWater: totalWater, hint: '在水位下降一半时进行 Rao Spin (平稳水平摇晃滤杯)，确保粉床平整' },
        ];
      } else {
        // 自定义参数 — 根据手法选择生成分段
        const pourStyle = this.data.pourStyles[pourStyleIndex];

        if (pourStyle === '三段式') {
        stages = [
          {
            name: '第1段 · 焖蒸',
            startSeconds: 0,
            endSeconds: 30,
            targetWater: weight * 2,
            hint: '缓慢注水，充分浸润咖啡粉',
          },
          {
            name: '第2段 · 主注水',
            startSeconds: 30,
            endSeconds: 70,
            targetWater: Math.round(totalWater * 0.6),
            hint: '由中心向外画圈注水',
          },
          {
            name: '第3段 · 收尾',
            startSeconds: 70,
            endSeconds: Number.MAX_SAFE_INTEGER,
            targetWater: totalWater,
            hint: '保持水位，等待滴滤完成',
          },
        ];
      } else if (pourStyle === '一刀流') {
        stages = [
          {
            name: '第1段 · 焖蒸',
            startSeconds: 0,
            endSeconds: 30,
            targetWater: weight * 2,
            hint: '缓慢注水，充分浸润咖啡粉',
          },
          {
            name: '第2段 · 中心注水',
            startSeconds: 30,
            endSeconds: Number.MAX_SAFE_INTEGER,
            targetWater: totalWater,
            hint: '保持中心缓慢注水至目标水量',
          },
        ];
      } else if (pourStyle === '十段法') {
        const segmentWater = totalWater / 10;
        for (let i = 0; i < 10; i++) {
          const segStart = i * 20;
          const segEnd = (i + 1) * 20;
          stages.push({
            name: `第${i + 1}段`,
            startSeconds: segStart,
            endSeconds: i === 9 ? Number.MAX_SAFE_INTEGER : segEnd,
            targetWater: Math.round(segmentWater * (i + 1)),
            hint: i === 0 ? '焖蒸，缓慢注水浸润' : `均匀注水 ${Math.round(segmentWater)}g`,
          });
        }
        }
      }

      // 设置初始阶段信息（尚未开始冲煮时显示第一阶段）
      if (stages.length > 0) {
        const first = stages[0];
        this.setData({
          stages,
          currentStageName: first.name,
          currentStageTimeRange: this.formatTimeRange(first.startSeconds, first.endSeconds),
          currentStageTarget: first.targetWater,
          currentStageHint: first.hint,
        });
      }
    },

    // ============ 冲煮控制 ============

    /** 开始冲煮 */
    startBrewing() {
      // 构建阶段列表（基于最新的当前数据）
      this.recalculateStages();

      // 保持屏幕常亮
      wx.setKeepScreenOn({ keepScreenOn: true });

      // 震动反馈
      wx.vibrateShort({ type: 'medium' });

      this.setData({
        isBrewing: true,
        elapsedSeconds: 0,
        timerDisplay: '00:00',
      });

      // 更新阶段显示
      this.updateCurrentStage(0);

      // 启动计时器
      timerInterval = setInterval(() => {
        this.tick();
      }, 1000);
    },

    /** 结束冲煮 */
    endBrewing() {
      // 清除计时器
      if (timerInterval !== null) {
        clearInterval(timerInterval);
        timerInterval = null;
      }

      // 取消屏幕常亮
      wx.setKeepScreenOn({ keepScreenOn: false });

      // 震动反馈
      wx.vibrateShort({ type: 'medium' });

      this.setData({
        isBrewing: false,
        elapsedSeconds: 0,
        timerDisplay: '00:00',
      });

      // 重置阶段显示
      this.recalculateStages();
    },

    // ============ 计时器逻辑 ============

    /** 每秒 tick */
    tick() {
      const elapsed = this.data.elapsedSeconds + 1;
      const display = this.formatTime(elapsed);

      this.setData({
        elapsedSeconds: elapsed,
        timerDisplay: display,
      });

      this.updateCurrentStage(elapsed);
    },

    /** 根据已过秒数更新当前阶段 */
    updateCurrentStage(elapsedSeconds: number) {
      const { stages } = this.data;
      let foundIndex = -1;

      for (let i = stages.length - 1; i >= 0; i--) {
        if (
          elapsedSeconds >= stages[i].startSeconds &&
          elapsedSeconds < stages[i].endSeconds
        ) {
          foundIndex = i;
          break;
        }
      }

      // 如果所有阶段都已过，停留在最后一个阶段
      if (foundIndex === -1) {
        foundIndex = stages.length - 1;
      }

      const stage = stages[foundIndex];
      if (!stage) return;

      // 检测是否进入了新阶段（与上次不同）
      const prevStageName = this.data.currentStageName;
      if (prevStageName !== stage.name) {
        // 新阶段震动提醒
        wx.vibrateShort({ type: 'heavy' });
      }

      this.setData({
        currentStageName: stage.name,
        currentStageTimeRange: this.formatTimeRange(stage.startSeconds, stage.endSeconds),
        currentStageTarget: stage.targetWater,
        currentStageHint: stage.hint,
      });
    },

    // ============ 格式化工具 ============

    /** 格式化秒数为 mm:ss */
    formatTime(totalSeconds: number): string {
      const mins = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;
      return `${this.pad(mins)}:${this.pad(secs)}`;
    },

    /** 格式化时间范围 */
    formatTimeRange(start: number, end: number): string {
      const startStr = this.formatTime(start);
      if (end >= Number.MAX_SAFE_INTEGER / 2) {
        return `${startStr} - 结束`;
      }
      const endStr = this.formatTime(end);
      return `${startStr} - ${endStr}`;
    },

    /** 补零 */
    pad(n: number): string {
      return n < 10 ? '0' + n : '' + n;
    },
  },

  lifetimes: {
    attached() {
      // 初始化计算
      this.recalculate();
      this.recalculateStages();
    },
    detached() {
      // 组件销毁时清除计时器
      if (timerInterval !== null) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    },
  },
});
