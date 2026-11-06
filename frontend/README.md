# Autoloop 事项工作台

接入本机 Agent Autoloop 的独立 Web 客户端。当前版本 0.1.0，使用 Nest 仓库中的 Agent Autoloop 后端。

## 打开

本机地址：<http://127.0.0.1:3351>

在 Nest 仓库根目录使用 `npm start` 同时运行前后端，Ctrl+C 停止两端；用 `npm run service:install` 安装 macOS 登录常驻服务，关闭终端或 Codex 窗口后也会继续运行。启用常驻服务时，先运行根目录 `npm run service:stop`，再手动启动。

## 已实现

- 事项列表：全部、待你处理、进行中、排队、已完成；每 3 秒刷新，后台标签页暂停轮询。
- 事项聚合：按真实卡片的创建轮次、回答事件与后续轮次关联。共享规则名称或会话本身不会把不相关的工作合并。
- 待决策卡片：选项回答（API 使用从 0 开始的选项编号）、文字回答、填写原因结案。回答之后自动跟踪该事项。
- 执行详情：真实事件、领取、回执和回答时间线；查看每轮结论、用量与原会话链接。
- 停止任务：向中台请求停止，等待接单程序确认，不把“请求已发送”显示为“已停止”。
- 规则：只读展示当前生效的事件或定时规则。连接：Agent、通道在线状态与事件来源。
- 真实试跑入口：开始前说明会调用 Agent 并使用模型额度；使用现有本机来源与试跑规则。
- 历史分页：每页是中台返回的 60 轮及其关联事项；未处理卡片始终显示。
- 离线提示、草稿保留、重复提交禁用、过期卡片检测；没有上报的费用显示“未上报”。

## 启动与维护

需要 Node.js 24 或更新，不需要 npm install，也没有运行时依赖。

```sh
npm start                 # 在 frontend/ 内只启动工作台；根目录则同时启动前后端
npm run service:status    # macOS 服务状态
npm run service:install   # 安装或重启 macOS 常驻服务
npm run service:stop      # frontend/ 内只停止工作台，保留登录启动文件
npm run service:remove    # frontend/ 内停止工作台，并取消登录启动
```

以上命令在 `frontend/` 内运行。根目录 `npm run service:stop` 会停止两端并取消登录启动。前后端仍使用原来的服务名称和数据目录，安装根目录服务会将启动入口切换为当前仓库。

配置参数：

```sh
AUTOLOOP_WEB_PORT=3352 npm start
AGENT_AUTOLOOP_HOME=/你的中台数据目录 npm start
```

默认读取 `~/.agent-autoloop/config.json`，owner / source 密钥只在本机后端读取，页面、浏览器存储和日志不包含这些凭据。服务只监听 `127.0.0.1`，校验 Host / Origin，接口要求专用请求头，不提供跨域访问。

macOS 日志：`~/.agent-autoloop/web-logs/server.log`。

## 验证

```sh
npm run check
npm test
npm run test:integration
```

单元和 HTTP 测试覆盖事项归属、历史记录去重、过期回答、选项范围、跨站请求、DNS 重绑定 Host、凭据不外泄及 HTML 转义。

集成验收在临时数据目录启动**当前仓库的真实中台**，接入确定性的本地测试程序，验证“事件 → 提问 → 回答 → 继续 → 完成”、卡片结案和进程停止。不调用模型、不使用真实通知通道，不改你正在使用的规则或记录。引擎默认位于上一级 Nest 仓库，可通过 `AUTOLOOP_ENGINE_HOME` 指定其他引擎目录。

`node scripts/acceptance.mjs --serve` 会在随机本机端口保留隔离环境，供浏览器验收；Ctrl+C 会清理。

## 当前范围

- 这是本机单用户客户端，没有公网部署、登录账户或多人权限。
- 规则与连接仅查看；新增规则仍通过现有配置文件管理。
- 不读取或修改中台数据库，不变更中台代码。按 `/v1/state` 和 `/v1/runs/:id/why` 读取，按官方卡片与轮次接口操作。
- 使用 3 秒轮询；首版没有接入 SSE，也不展示 CLI 的流式生成文本。
- 事项计数属于当前页，用量汇总使用中台独立于分页的今天 / 最近 7 天数据。
- 历史卡片受中台 state 接口最近 20 张的限制；不在本页的关联轮次可能暂不展示，但待处理卡片仍可直接回答。
- 按卡片回答链聚合；定时复查和其他外部事件没有明确卡片关联时按独立事项展示。

## 项目结构

- `server.mjs`：本机 HTTP 服务、固定接口、请求校验与静态资源。
- `lib/hub.mjs`：服务端读取现有配置并调用中台。
- `lib/tasks.mjs`：事项关联和时间线整理。
- `public/`：原生浏览器 ES Modules 界面与响应式样式。
- `scripts/service.mjs`：工作台的 macOS LaunchAgent 管理。
- `../scripts/start.mjs`：同时启动仓库前后端，退出或任一端失败时停止另一端。
- `test/`、`scripts/acceptance.mjs`：行为测试和隔离验收。
