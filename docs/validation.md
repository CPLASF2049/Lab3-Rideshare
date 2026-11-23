# Lab 3 验证记录

首次验证日期：2026-11-15（Asia/Shanghai）。首次运行环境：Windows、Node.js v24.21.0。第 1 至 5 节保留首次验证结果，2026-11-23 的增量结果见[第 6 节](#6-2026-11-23-代码复核与增量验证)。应用与后端测试无需第三方 npm 包。

本页汇总实际执行结果；原始时间、用例、订单 ID 和错误注入日志保存在对应证据文件中。测试耗时仅供复现，不是性能或容量结论。

## 1. 自动化测试

执行：

```powershell
node --test --test-isolation=none --test-reporter=tap tests/*.test.mjs services/*/*.test.mjs
```

结果：**68 项通过，0 失败、0 取消、0 跳过**（Node TAP 统计包含网关子测试）。[原始 TAP 输出](evidence/tests.tap)保留全部用例与结构化业务日志。

| 范围 | 代码 | 验证内容 |
| --- | --- | --- |
| Order 单元 | [order.unit.test.mjs](../tests/order.unit.test.mjs) | 状态机、归属、首次有效时间、取消阶段、迟到确认、报价和幂等 |
| 前端单元 | [frontend.unit.test.mjs](../tests/frontend.unit.test.mjs) | 版本不倒退、创建请求复用、接单失败、ASSIGNING 恢复、轮询与异步竞态 |
| Order 组件 | [order.component.test.mjs](../tests/order.component.test.mjs) | 真实 Order HTTP / SQLite、独立测试库、事务回滚、重启、取消竞争、响应丢失 |
| Query 组件 | [query.component.test.mjs](../tests/query.component.test.mjs) | 重复 / 乱序 / 跨版本投影、最低版本、组合降级、权限和持久化 |
| Gateway 组件 | [gateway.component.test.mjs](../tests/gateway.component.test.mjs) | 认证、白名单、真实路由目标、响应状态、幂等头、内部接口隔离、静态资源 |
| Driver / Dispatch / Pricing | 各服务的 `service.test.mjs` | 独占占用、墓碑、派单期限、重试、事件版本、报价与费率 |
| 跨服务竞态回归 | [races.test.mjs](../services/dispatch/races.test.mjs) | ASSIGNING 后 claim 过期、丢失占用成功响应、取消越过迟到 reserve、迟到 resolve |

Order 的单元测试使用替身仓储/依赖；组件测试使用独立 SQLite 文件和可模拟外部接口，不需要启动五服务平台。测试目录位于被 Git 忽略的 `.runtime`，不会复用演示数据库。

## 2. 真实 HTTP 服务协作

执行：

```powershell
node scripts/acceptance.mjs
```

结果：**11 组 PASS，0 组 FAIL**。见[结构化验收结果](evidence/acceptance.json)和[完整请求 / 事件 / 恢复日志](evidence/acceptance.log)。

1. 五个业务服务健康、四个身份、网关隔离。
2. 叫车 → 接单 → 到达 → 上车 → 完成；忙时下线仍能完成；9 公里为 2700 分，重复结束不改费用。
3. 已到达后取消并重新叫车；旧接单被拒绝，旧释放不解除新占用。
4. 两名司机顺序拒绝后结束匹配。
5. 等待派单时重启 Dispatch，原期限到期；迟到接单被拒绝。
6. 无司机可用时明确失败。
7. 两个乘客的订单竞争同一司机，只有一份有效占用。
8. 发出派单后司机下线，最终资源预占拒绝确认。
9. Driver 已提交占用后故意丢失 HTTP 响应，Order 重启后以原 assignment 恢复。
10. Query 停机期间状态写入、Outbox 保留事件，Order / Query 重启后补投追上版本。
11. Driver 停机时详情返回部分信息，订单完成后保留释放任务；Order / Driver 重启后完成释放。

运行器在一个 Node 进程中构建服务 factories，每个服务绑定独立真实 HTTP 端口和独立文件数据库；没有将函数 Stub 当作服务调用，也没有将该运行器记为六个系统进程。为缩短等待，验收将 offer 期限设为 800ms、总体 5000ms，正常配置仍为 15s / 45s。故障代理只存在于验收脚本。

## 3. 真浏览器、地图与移动端

执行：

```powershell
node scripts/browser-smoke.mjs
```

结果：**7 组检查 PASS，未捕获 JavaScript 异常 0 个**，见[浏览器执行结果](evidence/browser.json)。该次使用真实 Edge / CDP、两个独立浏览器上下文，连接实际运行在 8083 的多进程平台；有意阻断 OSM 瓦片请求。

| 检查 | 实际结果 |
| --- | --- |
| 地图底图失败 | 仍显示起终点、连线与 WGS84 坐标，叫车和行程按钮可使用 |
| 双角色流程 | 乘客真实叫车，司机看到真实 offer 并接受 |
| 上车后状态 | 乘客轮询看到进行中，不再显示普通取消按钮 |
| 最终计费 | 司机提交 9 公里，乘客看到后端返回 27.00 元 |
| 刷新恢复 | 标签页保留身份，从持久读模型恢复已完成历史 |
| 移动端 | 390 × 844 视口无页面横向溢出 |
| JavaScript | 未捕获异常列表为空 |

截图：[登录](images/login.png)、[乘客报价](images/rider-booking.png)、[司机接单](images/driver-accepted.png)、[完成订单](images/rider-completed.png)、[手机视口](images/mobile.png)。截图里的无底图状态来自刻意阻断，证明降级仍可操作，并非假地图截图。

## 4. 独立进程与部署检查

实际运行：

```powershell
node scripts/dev.mjs
node scripts/diagnose.mjs --save
```

[运行证据](evidence/runtime.json)记录了 **5 个健康业务进程和 1 个健康网关进程，6 个 PID 各不相同**，以及没有待处理 job / Outbox 的采集时状态。该记录是一次运行快照，不保证 PID 在未来重启后不变。

公开入口：`http://localhost:8083`；业务端口为 3101–3105。各服务只打开自己的数据库，诊断接口不会经网关暴露。

```powershell
docker compose config --quiet
node scripts/check.mjs
```

Compose 配置校验通过。源码语法、必要交付物、18 个公开 API operationId 与 `$ref` 完整性由检查脚本验证。

本次 Docker 引擎没有运行，**未把镜像构建或容器启动记为通过**。本地 Node 等价一键启动已真实运行并完成浏览器验证，符合实验部署选项。运行镜像前还需在有 Docker 引擎的环境执行 Compose 启动命令。

## 5. 结果边界

本次验证覆盖课程的单节点、每服务单实例实现和列出的错误窗口；没有执行容量压测、跨机网络分区、数据库介质丢失或生产安全验收。恢复依赖持久文件保留和相关服务最终恢复。长期不可用时保留待处理记录并持续重试，可通过内部诊断与日志查看。

CodeArts 远程仓库创建、推送和课程平台提交未执行。本地源码、报告、图、测试与实际证据均已准备，成员分工需要组员按真实工作安排确认。

## 6. 2026-11-23 代码复核与增量验证

运行环境为 Windows、Node.js v24.22.3。修改基于 GitHub 仓库提交 `ad25564`，在本地分支 `fix/input-boundaries-and-team` 完成。README 与报告均新增李金正（26113050066），并明确其负责的公共接口、事件契约、查询恢复、回归测试与联调文档范围。

### 修复内容

| 问题及触发条件 | 修改后的行为 | 代码与验证 |
| --- | --- | --- |
| 一个中文字符的 UTF-8 字节分散在两次请求分包中，逐块转字符串导致乱码 | 收齐字节后统一解码，中文和表情保持完整 | [公共请求解析](../common/body.mjs)、[HTTP 组件测试](../tests/http.component.test.mjs) |
| 无效 UTF-8 被替换字符掩盖，网关允许数组等 JSON 值进入后端 | 网关和业务服务统一拒绝无效 UTF-8、数组、空值及其他非对象 JSON，并保留 64 KiB 请求上限 | [网关组件测试](../tests/gateway.component.test.mjs) |
| 业务服务遇到无法解码的 URL 路径时返回 500 | 返回 `400 INVALID_PATH` | [HTTP 入口](../common/http.mjs)、[HTTP 组件测试](../tests/http.component.test.mjs) |
| Query 和 Dispatch 对事件类型、标识、时间及快照的校验不同 | 两端共用校验，错误事件返回 `400 INVALID_EVENT`，不消耗事件 ID | [订单事件校验](../common/order-event.mjs)、[双消费者组件测试](../tests/events.component.test.mjs) |
| 司机资料为空或 ID 不符时，组合查询可能返回正常标记或错误档案 | 保留订单，返回 `partial=true`、空司机资料及警告，当前订单查询也可降级 | [Query 服务](../services/query/service.mjs)、[查询组件测试](../tests/query.component.test.mjs) |
| 司机服务不可用且存在多条滞后的有效订单投影时，以跨订单版本号排序可能选中旧单 | 按订单创建时间选取最近记录，并保留降级提示 | [查询组件测试](../tests/query.component.test.mjs) |

原有 68 项自动化测试在修改前全部通过。新增测试在原实现上复现了中文分包、路径错误、事件校验、资料降级和旧单选择问题。修复后新增 9 项测试，全部共 77 项通过。Dispatch 原有测试中的事件类型也同步改为契约规定的类型。

### 本次执行结果

| 检查 | 结果与证据 |
| --- | --- |
| 全部自动化测试 | 77 项通过，0 失败、0 取消、0 跳过。[TAP 日志](evidence/review-20261123/tests.tap) |
| 真实服务协作 | 11 组通过，0 失败。[结构化结果](evidence/review-20261123/acceptance.json)、[请求与恢复日志](evidence/review-20261123/acceptance.log) |
| JavaScript 语法、OpenAPI 引用与交付物 | [检查日志](evidence/review-20261123/check.log) |
| 文档链接及 Python 脚本语法 | [检查日志](evidence/review-20261123/docs-check.log) |

复现命令如下。`test:component` 已改用组件测试文件通配符，新增的 HTTP 和事件测试会随服务级测试一起运行。

```powershell
node --test --test-isolation=none --test-reporter=tap tests/*.test.mjs services/*/*.test.mjs
node scripts/acceptance.mjs
node scripts/check.mjs
python scripts/check_docs.py
```

本次未重跑浏览器检查，也未运行 Docker 容器。首次验收的测试、浏览器、运行进程记录与图片保持原样，新增日志单独保存在 `docs/evidence/review-20261123`。新增服务验收仍使用测试专用的 800ms 派单期限和 5000ms 总期限，正常配置保持 15s 与 45s。
