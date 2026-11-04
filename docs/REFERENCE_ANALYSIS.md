# 参考工程研究与独立实现边界

关联需求：[REQ-20261104135500](../.agentdocs/workflow/REQ-20261104135500-首场格斗垂直切片/README.md)。研究日期：2026-11-04（Asia/Shanghai）。

## 研究依据与范围

实际读取 [5DPLAY 官方 BleachVsNaruto](https://github.com/5DPLAY-Game-Studio/BleachVsNaruto) 的 `master`，固定基线提交为 `d51f13dc36cac8e7622328bf4a9afc94156fb79f`。参考源码只在工作区外的临时目录阅读，不进入本项目或运行依赖。本研究没有运行 Flash/AIR 原作，也没有读取 Flash 美术子模块内全部人物时间轴。因此这里只确认源码机制，不宣称完成原作逐招帧数据、美术和操作手感对标。

## 可借鉴的通用原理

### 状态与动作许可

`FighterActionState` 区分攻击、技能、必杀、防御、受击、击飞、倒地、胜负等状态；`FighterAction` 另行记录当前动作允许执行的输入入口。`FighterActionLogic` 同时检查动作入口和输入，随后由时间轴控制器执行。

本项目采用独立 TypeScript 状态与招式帧数据：角色处于什么状态、状态持续多少帧、何时允许下一次输入，应当有可检查的明确规则。[状态常量](https://github.com/5DPLAY-Game-Studio/BleachVsNaruto/blob/d51f13dc36cac8e7622328bf4a9afc94156fb79f/CORE_Shared/src/net/play5d/game/bvn/data/fighter/FighterActionState.as)、[动作许可](https://github.com/5DPLAY-Game-Studio/BleachVsNaruto/blob/d51f13dc36cac8e7622328bf4a9afc94156fb79f/CORE_KernelLogic/src/net/play5d/game/bvn/fighter/ctrler/FighterActionLogic.as)。

### 判定与动画时间轴

`FighterMC` 按当前动画帧取得身体和攻击矩形，并缓存局部区域；`FighterCtrler` 将其转换到当前世界坐标；`GameMainLogicCtrl` 进行矩形相交、双方命中与受击派发。参考工程的身体区域不能直接等同于本项目将要分开的身体推挤框与受击框。

本项目的 Hitbox（攻击框）、Hurtbox（受击框）与身体碰撞框分别表示伤害范围、可被打中的范围与推挤空间。攻击帧由战斗核心控制，渲染只呈现核心状态；避免动画帧率或浏览器掉帧改变实际攻击时机。[动画判定缓存](https://github.com/5DPLAY-Game-Studio/BleachVsNaruto/blob/d51f13dc36cac8e7622328bf4a9afc94156fb79f/CORE_KernelLogic/src/net/play5d/game/bvn/fighter/FighterMC.as)、[碰撞检查](https://github.com/5DPLAY-Game-Studio/BleachVsNaruto/blob/d51f13dc36cac8e7622328bf4a9afc94156fb79f/CORE_KernelLogic/src/net/play5d/game/bvn/ctrler/game_ctrls/GameMainLogicCtrl.as)。

### 输入缓冲、连招与取消

`GameInputer.JUST_DOWN_DELAY` 为 0.1 秒，非经典模式采用延迟 just-down（新按下）输入。`FighterMcCtrler.setAttack`、`setBisha` 等入口可以由时间轴开放，形成当前动作允许的后续动作；这不是所有角色统一的一段固定取消区间。

本项目使用按逻辑帧计数、消费一次的输入缓冲，招式数据显式声明取消起止帧与可接续动作；命中确认、空挥和受击应分别处理。[输入缓存](https://github.com/5DPLAY-Game-Studio/BleachVsNaruto/blob/d51f13dc36cac8e7622328bf4a9afc94156fb79f/CORE_KernelLogic/src/net/play5d/game/bvn/input/GameInputer.as)、[时间轴动作入口](https://github.com/5DPLAY-Game-Studio/BleachVsNaruto/blob/d51f13dc36cac8e7622328bf4a9afc94156fb79f/CORE_KernelLogic/src/net/play5d/game/bvn/fighter/ctrler/FighterMcCtrler.as)。

### 命中停顿、硬直与击退

`HitVO` 保存伤害、破防、击退/击飞速度、硬直和慢放。`EffectCtrl.freeze` 将毫秒转为帧，暂停战斗，再在倒计时完成时恢复。`EffectModel` 将命中音效、闪光、屏幕震动及停顿组合为特效配置。

本项目的一次命中事件统一驱动伤害与音画反馈。Hitstop（命中停顿）、角色硬直、菜单暂停是三种不同状态，必须分别管理；攻击实例需要防止同一有效窗口每帧重复造成伤害。[伤害数据](https://github.com/5DPLAY-Game-Studio/BleachVsNaruto/blob/d51f13dc36cac8e7622328bf4a9afc94156fb79f/CORE_KernelLogic/src/net/play5d/game/bvn/fighter/models/HitVO.as)、[停顿执行](https://github.com/5DPLAY-Game-Studio/BleachVsNaruto/blob/d51f13dc36cac8e7622328bf4a9afc94156fb79f/CORE_KernelLogic/src/net/play5d/game/bvn/ctrler/EffectCtrl.as)。

### 技能、数值与资源

`FighterMcCtrler` 区分普通、空中与必杀动作并保存必杀消耗；`FighterMain` 限制气量范围并处理命中积气。`FighterVO` 关联角色资源文件、头像和音乐，`EffectModel` 按标识注册特效。原工程的 Flash 资源由单独子模块管理。

本项目用角色注册表、招式表、技能事件与动画清单组合角色。通用技能事件执行器负责弹体、预警、突进等事件；角色配置负责时间与参数。资产必须保持原创，并将资源版本、生成提示与未完成的美术工作单独记录。[角色资源定义](https://github.com/5DPLAY-Game-Studio/BleachVsNaruto/blob/d51f13dc36cac8e7622328bf4a9afc94156fb79f/CORE_KernelLogic/src/net/play5d/game/bvn/data/vos/FighterVO.as)、[特效注册](https://github.com/5DPLAY-Game-Studio/BleachVsNaruto/blob/d51f13dc36cac8e7622328bf4a9afc94156fb79f/CORE_KernelLogic/src/net/play5d/game/bvn/data/EffectModel.as)。

### AI 与固定步长

`FighterAILogicBase` 读取距离、攻击范围、对手当前状态并维护连招优先级；`FighterAILogic` 使用不同难度的概率表。`EnemyBossAICtrl` 主要限制父级 AI 的动作集合，不能直接满足本项目三位 Boss 的独立机制要求。

本项目采用读取当前局面、受冷却约束的技能选择；高伤害技能有前摇，结束有恢复窗口，不读取未来按键。参考工程默认逻辑 60 FPS、动画 30 FPS，说明视觉动画可以低于逻辑频率，关键是姿态、节奏和判定同步。[AI 逻辑](https://github.com/5DPLAY-Game-Studio/BleachVsNaruto/blob/d51f13dc36cac8e7622328bf4a9afc94156fb79f/CORE_KernelLogic/src/net/play5d/game/bvn/fighter/ctrler/ai/FighterAILogic.as)、[刷新率配置](https://github.com/5DPLAY-Game-Studio/BleachVsNaruto/blob/d51f13dc36cac8e7622328bf4a9afc94156fb79f/CORE_KernelLogic/src/net/play5d/game/bvn/GameConfig.as)。

## 许可证与素材边界

根目录 [LICENSE](https://github.com/5DPLAY-Game-Studio/BleachVsNaruto/blob/d51f13dc36cac8e7622328bf4a9afc94156fb79f/LICENSE) 为 GNU GPL 第 3 版；README 与源码头注明第 3 版或后续版本。本项目不复制或移植其源码，不分发其角色、SWF、Sprite Sheet、音频和特效，只参考上述通用设计原理。公开源码不代表其中所有动漫角色素材都获得本项目的使用授权。

## 李铁事实来源与游戏虚构

李铁曾任中国国家男子足球队主教练。2025 年 4 月 30 日，湖北省高级人民法院对其案件二审公开宣判，驳回上诉，维持有期徒刑二十年的原判。来源：[最高人民检察院刊载的二审消息](https://www.spp.gov.cn/spp/zdgz/202504/t20250430_694674.shtml)。

游戏内的足球弹道、红包强化、名单突袭和必杀演出均为虚构机制，不是现实事件复现。图鉴将已确认事实与虚构技能分开显示，不以技能描述补造新的现实犯罪情节。后续人物的事实文案应在其制作阶段单独核实。
