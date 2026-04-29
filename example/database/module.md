---
name: database
description: 数据库管理模块，PostgreSQL + Knex.js
---

# 数据库管理

## 模块说明

管理 PostgreSQL 数据库的版本迁移、种子数据、备份恢复。使用 Knex.js 作为查询构建器和迁移工具。支持多环境配置（开发、测试、生产）。

## 子模块

- `migrations/` - 数据库迁移脚本，版本化数据库结构变更
- `seeds/` - 测试种子数据
