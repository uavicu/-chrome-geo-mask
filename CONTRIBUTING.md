# 贡献指南

## 提交问题

请说明 Chrome 版本、操作系统、扩展版本、复现步骤、预期结果和实际结果。涉及代理时，说明浏览器是否走系统代理，以及检测域名与测试页面是否走相同出口即可。

不要提交个人公共 IP、Cookie、访问令牌、代理订阅、节点配置、私人路径或完整浏览历史。日志和截图请先脱敏。

## 修改代码

1. Fork 项目，在独立分支上作出小范围修改。
2. 保持原生 JavaScript、Manifest V3 和无构建依赖的结构；新增权限或外部服务时同步说明原因与隐私影响。
3. 给行为变化补充 `geo-mask.test.cjs` 测试，不依赖真实网络请求来执行回归测试。
4. 在项目根目录运行：

   ```bash
   node --check background.js
   node --check geo-profile.js
   node --check lang-override.js
   node --check geo-mask.test.cjs
   node --test geo-mask.test.cjs
   ```

5. 若涉及 Chrome API 或注入时机，在真实浏览器中重新加载扩展并检查新页面和已有页面；说明测试版本及未验证的场景。
6. 提交 Pull Request，简要说明原因、改动和验证结果。

不要承诺绕过网站检测，也不要把系统时区或 Clash 配置的修改加入扩展行为。当前仓库没有单独的 lint / 类型检查工具，JavaScript 语法检查、回归测试和编辑器诊断是现有检查方式。
