---
name: frontend
description: 前端 React 应用，基于 Next.js + TypeScript
submodules:
  - name: components
    path: components
    description: 可复用的 UI 组件库
  - name: pages
    path: pages
    description: 页面组件和路由
  - name: hooks
    path: hooks
    description: 自定义 React Hooks
  - name: styles
    path: styles
    description: 全局样式和主题配置
---

# 前端应用

## 模块说明

基于 Next.js 14 的前端应用，使用 React 18、TypeScript 和 Tailwind CSS。支持服务端渲染 (SSR)、静态站点生成 (SSG) 和客户端渲染三种模式。集成状态管理 (Zustand)、数据请求 (TanStack Query) 和国际化 (i18n)。
