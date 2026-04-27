---
name: server
description: 后端 API 服务，基于 Express + TypeScript，提供 RESTful 接口
source:
  type: git
  url: https://github.com/example/my-app-server.git
  branch: develop
---

# 后端 API 服务

## 模块说明

基于 Express.js 的 RESTful API 服务，使用 TypeScript 编写。包含 JWT 认证、请求验证、文件上传、WebSocket 实时通信等功能。采用分层架构设计，API 层、服务层、数据模型层分离。

## 子模块

- `api/` - API 路由和控制层，定义所有 REST 端点
- `models/` - 数据模型和 ORM 映射定义
- `services/` - 核心业务逻辑服务层
- `middleware/` - 中间件（认证、日志、错误处理）
