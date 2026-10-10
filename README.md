# Chrome Geo Mask

让 Chrome 网页中的时区、IP 估算位置和语言跟随浏览器的实际代理出口变化，而不是固定在某个国家。

适合在 Clash 等代理客户端配合下进行跨地区页面展示、语言和定位测试。扩展只调整浏览器页面环境，不修改操作系统设置、Clash 配置或节点选择。

> **这是浏览器环境测试工具，不是完整的反指纹或匿名工具。** 它不会隐藏真实网络出口，也不保证所有浏览器 API、Worker、跨进程 iframe 或网站检测结果一致。

## 功能

- 检测 Chrome 实际公共出口 IP，约每 30 秒检查一次；页面导航也会触发限频检查。
- 出口 IP 变化时查询 IANA 时区、国家和经纬度，更新已打开的 HTTP/HTTPS 标签页。
- 同步时区、本地时间显示、语言环境、`navigator.language` / `navigator.languages` 和常见 HTTP 请求的 `Accept-Language`。
- 用 IP 数据库坐标覆盖网页 Geolocation API 返回的位置；仍需安全上下文与用户的定位授权。
- 同一出口 IP 的地理结果缓存 6 小时，减少地理查询服务的调用。
- IP 或地理查询失败时保留最近有效配置；首次查询尚未成功时，不强制设置默认国家。

## 安装

需要 **Chrome 120 或更新版本**。其他 Chromium 浏览器可能兼容，但尚未单独验证。使用扩展无需安装 Node.js、npm 或其他依赖。

1. [下载并解压源码 ZIP](https://github.com/uavicu/-chrome-geo-mask/archive/refs/heads/main.zip)，或克隆仓库。
2. 打开 `chrome://extensions`，启用右上角的 **开发者模式**。
3. 点击 **加载已解压的扩展程序**，选择包含 `manifest.json` 的项目根目录，而不是外层压缩包目录。
4. 确认 Chrome 的权限提示。确保 Chrome 流量确实经过期望的代理出口。
5. 等待第一次查询完成，再刷新需要测试的网页。

使用 Git 下载：

```bash
git clone https://github.com/uavicu/-chrome-geo-mask.git chrome-geo-mask
```

更新代码后，在扩展管理页点击 **重新加载**，然后刷新原有网页。扩展使用 `chrome.debugger`，Chrome 可能显示“已开始调试此浏览器”的提示，这是预期行为。

卸载或停用时，在扩展管理页禁用/移除扩展，再刷新原有页面，以清除已注入页面的语言覆盖。不需要恢复系统时区，因为扩展从不修改它。

## 与 Clash 配合

扩展**不会读取 Clash 控制接口、订阅、配置或节点名称**。它依赖 Chrome 自己的网络请求，适用于能够改变浏览器实际出口的代理工具。

在规则模式下，请检查以下域名是否走了预期代理：

```text
api.ipify.org
api64.ipify.org
ipwho.is
ipapi.co
```

- 如果出口检测域名被分流为 `DIRECT`，扩展会得到直连出口，而不是 Clash 界面选中的节点。
- 如果不同网站使用不同出口，一套全局配置无法同时匹配所有网站。请自行保持测试页面与检测服务的路由一致。
- 切换节点后通常需要等待下一次检测，加上外部服务查询耗时；不是即时切换。Chrome 休眠、API 限流、网络超时或旧连接复用都可能延迟更新。
- 网站如果缓存了之前的时间、语言或定位信息，需刷新页面再检查。

扩展不会替你修改上述路由规则。

## 工作原理

```text
启动 / 定时检查 / 页面导航
          |
          v
查询 Chrome 公共出口 IP（ipify，失败尝试备用端点）
          |
          v
IP 改变或缓存超过 6 小时？
    | 否                    | 是
    v                       v
复用有效配置          查询地理信息（ipwho.is，失败尝试 ipapi.co）
                            |
                            v
                  校验 IP、国家代码、时区和坐标
                            |
                            v
             更新请求语言规则、会话缓存和页面环境
```

时区和定位通过 Chrome DevTools Protocol 的 `Emulation` 命令设置。语言属性通过 MAIN world 脚本覆盖，后续新文档也会注入；请求语言通过 Manifest V3 的动态会话规则更新。

语言由出口国家代码和 `Intl.Locale` 的地区推断结果生成，再加入 `en-US` / `en` 作为回退。这是合理默认值，不代表该国家所有人的语言，也不是根据用户偏好选择的语言。

时区影响本地时间的表示方式，**不会改变 UTC 时间、系统时钟或 `Date.now()`**。位置来自 IP 数据库，不是 GPS；代码中使用的 10,000 米精度字段不代表数据库实际误差保证。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `debugger` | 附加网页标签页，设置时区、语言环境、位置和新文档脚本。属于高权限能力，安装前应审阅源码。 |
| `declarativeNetRequest` | 动态更新 HTTP 请求的 `Accept-Language`。 |
| `tabs` | 找到可更新的标签页，监听导航及关闭事件。 |
| `alarms` | 请求约 30 秒一次的周期检查；实际触发时间由 Chrome 调度。 |
| `storage` | 在 `chrome.storage.session` 中保存最近有效配置和地理查询时间。 |
| `scripting` | 在现有网页及允许注入的 frame 中更新语言属性。 |
| `<all_urls>`（网站访问权限） | 查询外部服务，并允许在不同网站的标签页注入/应用覆盖。当前后台仅筛选 HTTP/HTTPS 页面更新，Chrome 内部页面仍受浏览器限制。 |

代码没有页面内容采集、浏览记录上传、Cookie 读取或 Clash 配置读取功能。权限本身仍然较宽，请只安装可信来源的版本。

## 隐私与外部服务

| 服务 | 用途与可见信息 |
| --- | --- |
| [ipify](https://www.ipify.org/) | 返回请求的公共出口 IP，服务可见该请求来源。优先 IPv4 端点，失败回退 IPv4/IPv6 端点。 |
| [ipwho.is](https://ipwho.is/) | 根据请求 URL 中的出口 IP 返回国家、时区与坐标。 |
| [ipapi.co](https://ipapi.co/) | 地理查询备用服务，同样会收到被查询的出口 IP。 |

查询使用 HTTPS、`credentials: 'omit'`、禁用 HTTP 缓存并设置 8 秒请求超时。扩展不会向这些服务发送浏览页面 URL、Cookie、Clash 节点名称或配置。第三方服务仍可获得正常网络请求元数据，并可能有自己的日志、限额、隐私政策和使用条款。

最近有效的 IP、国家、时区、语言、坐标和查询时间只保存在扩展的会话存储中，不使用 Chrome 账号同步，不保存为永久配置。会话存储会随浏览器会话结束或扩展重新加载等情况清除。服务 worker 休眠后可以恢复当前会话的缓存。

免费服务可用性、数据库准确度、调用额度及商业使用条件由供应商决定。扩展不提供可用性保证；用于商业或大规模部署前，请自行确认服务条款。

## 验证与排查

推荐在 HTTPS 测试页中显示以下结果：

```js
Intl.DateTimeFormat().resolvedOptions().timeZone
new Date().toString()
navigator.language
navigator.languages
navigator.geolocation.getCurrentPosition(console.log, console.error)
```

**注意：打开网页 DevTools 可能占用同一个调试目标，使扩展断开附加。** 若出现时区未生效，关闭网页 DevTools 后重新导航，再用页面自身的测试界面验证。定位 API 还需要授予该网站的位置权限。

查看最近检测配置：在 `chrome://extensions` 中找到本扩展，点击 service worker 的检查链接，在扩展控制台执行：

```js
chrome.storage.session.get(['geoProfile', 'geoProfileCheckedAt']).then(console.log)
```

这里显示的 IP 属于你的网络信息，分享截图或日志前请自行遮盖。

| 现象 | 排查方向 |
| --- | --- |
| 切换 Clash 节点后仍是原地区 | 检查实际出口是否改变、检测域名是否 `DIRECT`；等待检测后刷新页面。 |
| 页面仍是系统时区 | 确认首次查询已成功；关闭网页 DevTools，再导航；Chrome 内部页面不支持这种覆盖。 |
| 定位被拒绝 | 使用安全上下文并授予网站定位权限；扩展不会代替用户授权。 |
| 定位城市不准确 | IP 数据库是估算，出口机房、数据库更新时间和供应商差异都会影响结果。 |
| 查询报 HTTP 错误或超时 | 检查网络、服务限额与控制台告警；失败后保留最近有效配置，之后继续尝试。 |
| 重启浏览器后暂时恢复系统值 | 会话缓存已清除，需等待新的首次查询成功。 |

## 开发与测试

项目为原生 JavaScript Manifest V3 扩展，无构建流程，也没有 npm 依赖。运行测试建议使用 Node.js 22 或 24。

```bash
node --check background.js
node --check geo-profile.js
node --check lang-override.js
node --check geo-mask.test.cjs
node --test geo-mask.test.cjs
```

目前有 **19 项回归测试**，覆盖配置校验、语言注入、首次查询、出口变化、缓存、错误回退、备用服务、并发刷新、标签页串行更新、debugger 断开重附加和存储失败。

测试通过模拟 Chrome API 与网络响应验证逻辑。**尚未完成真实 Chrome + Clash 节点切换的端到端验证**，单元测试不能替代真实浏览器兼容性检查。

```text
manifest.json       扩展声明及权限
background.js       出口检测、缓存、规则和标签页更新
geo-profile.js      IP / 地理响应校验、语言配置生成
lang-override.js    页面语言属性覆盖
geo-mask.test.cjs   Node.js 回归测试
README.md           安装、使用、权限与隐私说明
CONTRIBUTING.md     贡献指南
LICENSE             MIT 许可证
.github/workflows/  GitHub Actions 回归检查
```

## 贡献

欢迎[提交问题](https://github.com/uavicu/-chrome-geo-mask/issues)和小范围改进。请阅读 [贡献指南](CONTRIBUTING.md)，提供可复现步骤，并删除个人 IP、代理配置、凭证及私人路径等信息。

## 许可证

本项目采用 [MIT License](LICENSE)。使用、修改或分发时请保留版权和许可证声明；软件按“原样”提供，不作保证。第三方 IP 查询服务的使用仍受各自条款约束。
