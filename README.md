# opensubtitles-proxy

利用 Vercel 反向代理 OpenSubtitles API，解决国内无法直连 `api.opensubtitles.com` / `dl.opensubtitles.org` 的问题。

## 路由

| 请求路径 | 实际转发到 |
| --- | --- |
| `/api/v1/...` | `https://api.opensubtitles.com/api/v1/...` |
| `/dl/...` | `https://dl.opensubtitles.org/...` |

## 用法

把客户端里的 OpenSubtitles API 地址替换成你的域名即可：

```
https://sub.example.com/api/v1/subtitles?imdb_id=0137523&languages=zh-cn
```

请求头带上自己的 `Api-Key`（以及登录后拿到的 `Authorization: Bearer <token>`），代理只透传，不保存任何密钥。

返回结果里的 `link` 字段会被重写成 `https://<你的域名>/dl/...`，字幕文件也走代理下载。

## 环境变量（可选）

- `PUBLIC_BASE`：下载链接重写用的公网地址，例如 `https://sub.example.com`。不设置则保留原始链接。
- `OS_UA`：转发时使用的 User-Agent，默认 `opensubtitles-proxy/1.0`。OpenSubtitles 要求请求带 UA。

## 注意

- 下载额度按 OpenSubtitles 账号计算，代理不会增加额度。
- 部署在 Vercel 免费版时每月 100GB 流量，公开域名可能被他人白嫖。
