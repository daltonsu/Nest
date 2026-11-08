# Nest 的 fork 开发流程

Nest 是 `KKKKhazix/agent-autoloop` 的个人 fork，保留上游历史，在其上维护事项工作台、规则编辑等特色功能。

## 分支和远端

| 名称 | 用途 |
| --- | --- |
| `origin` | 个人仓库 `daltonsu/Nest`，已配置为 `git@github.com:daltonsu/Nest.git` |
| `upstream` | 原作者仓库 `KKKKhazix/agent-autoloop`，通过 HTTPS 获取上游更新 |
| `parent/main` | 上游原版镜像，跟踪 `upstream/main`，不承载个人定制 |
| `main` | 个人稳定版本，包含已验证的定制功能 |
| `codex/dev` | 临时本地开发分支，从 main 创建，完整合回 main 并验证后安全删除 |
| `dev` | 可选集成分支，只有需要集中测试时才使用 |
| `contrib/<改动描述>` | 上游贡献分支，每个 PR 一条，从上游原版创建 |

远端配置保存在本机 Git 配置中。新克隆的仓库若没有 upstream，核实 origin 指向自己的 fork 后再添加：

```sh
git remote add upstream https://github.com/KKKKhazix/agent-autoloop.git
```

## 个人功能开发

默认路线：`main → codex/dev → 本地 main`。

同一批开发尚未结束且已有 codex/dev 时，核对提交、未提交改动和 worktree 归属后继续复用；仅不存在时从 main 创建，不丢弃未完成工作。dev 不是必经环节。

开发完成后运行相关检查，将本次已验证、已授权交付的功能直接合入 main，再验证整合结果。本仓库默认普通 merge 或快进，保留开发提交的祖先关系，codex/dev 不推送。

完整合入 main 并通过验证后，切回 main，核实工作区干净、没有其他 worktree 占用开发分支，安全删除 codex/dev：

```sh
git switch main
git merge-base --is-ancestor codex/dev main
git branch -d codex/dev
```

以上各步检查通过才继续。收尾后只保留 parent/main 和 main，下次开发再从 main 创建 codex/dev。存在未交付提交、未提交内容或其他任务占用时保留并说明，不强删。用户另行要求 squash 时，先核对其对原始提交保留和安全删除的影响，不把非祖先的分支强删来凑足两条分支；其他未完成的贡献 PR 分支同样保留。

main 在开发期间接收了上游更新时，先将最新 main 合入 codex/dev，再处理冲突并验证正在开发的功能。

## 同步上游

默认路线：`upstream/main → parent/main → 本地 main`。先检查工作区和分支所在的 worktree，逐步执行并检查结果，不在有未处理改动的目录中强行切换。

```sh
git fetch --no-tags upstream
git switch parent/main
git merge --ff-only upstream/main
git switch main
git merge parent/main
```

新克隆尚无 parent/main 时，在 fetch 并核实上游后用 `git branch --track parent/main upstream/main` 建立镜像。镜像快进失败或含有个人提交时先核对来源，不重置、强推或将定制功能合入镜像。

parent/main 合入 main 使用普通 merge，保留上游祖先关系，不套用个人功能交付的 squash 流程。上游同步不经过包含未完成任务的 codex/dev；改动较大时，可从 main 单独建立临时验证分支，通过后以普通 merge 合回 main。

只更新 parent/main 不代表个人版本已经升级。用户指定版本时合入已核实的目标提交，不夹带镜像上更晚的更新。冲突处理应保留相关个人功能与上游修复，完成检查后再推送或部署。

## 向原仓库提交 PR

路线：`parent/main → contrib/<改动描述> → 自己的 fork → 原仓库 PR`。

先读取上游贡献指南及 PR 模板，确定目标分支。目标为上游 main 时，更新 parent/main 后从它创建贡献分支，例如：

```sh
git switch -c contrib/fix-rule-validation parent/main
```

如果贡献指南指定其他目标分支，从已更新的对应上游引用创建贡献分支。每个 PR 使用独立分支，跟进同一个 PR 时继续使用该分支；已有同名分支先核对，不覆盖。

贡献分支只包含本次要贡献的内容。功能若已在个人 main 或 codex/dev 实现，检查依赖后挑选相关提交或移植必要改动，不将整个个人分支合进去。对照实际上游目标检查全部新增提交和差异，完成相关测试。

用户明确要求提交 PR 后，将本地 contrib 分支推送到自己的 fork 同名分支，PR 的 head 为 `daltonsu/Nest:contrib/<改动描述>`，base 为 `KKKKhazix/agent-autoloop:main` 或贡献指南指定的目标分支。该流程不需要先将贡献合入个人 main，也不向 upstream 直接推送。

## 推送与本机运行

普通个人交付在获准后只将已验证的 main 推送到 origin/main，使用明确 refspec，不强推。贡献 PR 采用上面的独立流程；parent/main 或 dev 仅在明确要求时推送。仅本地开发、同步或分支调整不自动授权推送、创建 PR 或发布。

本机服务使用当前仓库路径中的文件，不会按 Git 分支自动隔离运行。切换到不含前端的 parent/main 或 contrib 分支会改变该目录的文件；准备在这些分支工作时，应使用独立工作目录，并保留正在使用的工作区和服务配置。普通改分支名称或移动引用无需重启服务。

前端和后端沿用现有的本机服务与 `~/.agent-autoloop` 数据目录。服务状态用 `npm run service:status` 查看；是否重启或部署按具体功能变更决定。
