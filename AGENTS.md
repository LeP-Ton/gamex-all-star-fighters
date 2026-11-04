# GameX《全明星格斗》

- 使用中文沟通、文档和注释。项目时区为 Asia/Shanghai。
- TypeScript + Phaser 3 + Vite；PC 浏览器优先，16:9 格斗场景。
- `src/core/` 为不依赖 Phaser 的 60 Hz 战斗逻辑；`src/data/` 为角色/招式数据；`src/render/` 为 Phaser 场景与音画；`src/ui/` 为界面与本地存档。
- `npm install` 安装；`npm run dev` 本地运行；`npm test` 战斗逻辑测试；`npm run build` 类型检查与生产构建。
- 先读 `.agentdocs/index.md` 和相关需求 README，再检索源码；阶段变更写入 `.agentdocs/workflow/`。
- 参考工程仅研究通用原理，不复制 GPL 源码或未经授权的角色/音画资源。
- 招式的起手、有效、恢复、取消与无敌窗口以固定帧定义；渲染帧率不能改变战斗结果。
- 原创资源放入 `public/assets/`，保留来源及生成提示词；不得将生成草案标为已通过正式美术验收。
- 角色动画与打击手感优先；首场质量门槛未通过前不批量制作后续 Boss。
