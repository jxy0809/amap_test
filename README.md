# 高德客资上线前三项确认

静态页，部署到 GitHub Pages 后给联调用。三项对应归档里的 R-008、R-021、R-009。

| 项 | 页上怎么确认 |
| --- | --- |
| R-008 网关能否带路径 | 只把「域名 + `/tsk_amap_xxxxxxxx`」填进**测试**网关，生效后刷新，看回显还在不在。本站记不住高德的 POST 正文。 |
| R-021 成功应答 | 对照 `data.result=true` 和参数表那套带 `advertiserId` 的结构，贴联调响应，并记下高德有没有重推。 |
| R-009 生产网关不可改 | 复制给前端的说明，勾选确认详情/编辑会讲清楚锁死。不要用生产网关做路径实验。 |

记录在浏览器 `localStorage`，点「导出记录」得到 markdown。

## 发布

本仓库不在 github.com，本机也没有 `gh`。在 GitHub 新建空仓库（例如 `amap-release-gate`）后：

```bash
cd tools/amap-release-gate
git init
git add index.html 404.html app.js app.css README.md
git commit -m "Add Gaode pre-release confirmation page"
git branch -M main
git remote add origin https://github.com/<you>/amap-release-gate.git
git push -u origin main
```

仓库 Settings → Pages → Deploy from branch → `main` / `/ (root)`。

项目页地址形如 `https://<you>.github.io/amap-release-gate/`。打开后复制第一行测试网关，路径里会带当前仓库名和探针编号。

`404.html` 与 `index.html` 相同。高德或浏览器若打开 `.../tsk_amap_xxx` 这种多出来的路径，Pages 会落到 404，页顶会留下实际 pathname。

本地预览（未知路径会像 Pages 一样返回本页，地址栏保持原路径）：

```bash
cd tools/amap-release-gate
python3 serve.py
```

打开 http://127.0.0.1:8765/ 。
