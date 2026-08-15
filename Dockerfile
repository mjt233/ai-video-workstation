# syntax=docker/dockerfile:1
# ai-video-workstation 生产镜像（多阶段构建，基于 node:24-bookworm）
# 阶段 1：构建前端 Vite 产物；阶段 2：安装服务端依赖；阶段 3：精简运行时
#
# npm 包缓存策略（依赖 Docker BuildKit，Docker Desktop / Docker 23+ 默认开启）：
# 1. 层缓存：先只复制 package.json / package-lock.json 再 npm ci，
#    源码变更不会触发依赖重装；
# 2. 构建缓存：--mount=type=cache,target=/root/.npm 将 npm 下载缓存
#    持久化在构建器上，换依赖版本或清层缓存后二次构建也能直接复用已下载的包。

# ---------- 阶段 1：构建前端 ----------
FROM node:24-bookworm AS frontend-builder

WORKDIR /build
# frontend/tsconfig.json 与 server/tsconfig.json 均继承根目录基配置
COPY tsconfig.base.json ./

WORKDIR /build/frontend

# 先复制依赖清单，利用 Docker 层缓存
COPY frontend/package.json frontend/package-lock.json ./
# npm 包缓存挂载：重复构建直接复用 /root/.npm
RUN --mount=type=cache,target=/root/.npm npm ci

# 复制源码并构建（产物输出到 frontend/dist）
COPY frontend/ ./
RUN npm run build

# ---------- 阶段 2：安装服务端依赖 ----------
FROM node:24-bookworm AS server-deps

# apt 源使用中国大陆镜像（默认清华 TUNA），可用 --build-arg APT_MIRROR=... 覆盖
# 可选：阿里云 mirrors.aliyun.com / 中科大 mirrors.ustc.edu.cn / 腾讯 mirrors.cloud.tencent.com
ARG APT_MIRROR=mirrors.tuna.tsinghua.edu.cn

# better-sqlite3 原生模块编译兜底：bookworm(glibc) 下通常有预编译产物，
# 仅在预编译下载失败时才会真正执行编译；该工具链只存在于本阶段，不进最终镜像
RUN sed -i "s|deb.debian.org|${APT_MIRROR}|g; s|security.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i "s|deb.debian.org|${APT_MIRROR}|g; s|security.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list 2>/dev/null; \
    apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build
# 供 server/tsconfig.json 继承（npm ci 不读 tsconfig，这里仅为保持构建上下文一致）
COPY tsconfig.base.json ./

WORKDIR /build/server

COPY server/package.json server/package-lock.json ./
# 完整安装（含 tsx 等 devDependencies：生产环境用 tsx 直接运行 TypeScript）
RUN --mount=type=cache,target=/root/.npm npm ci

# ---------- 阶段 3：运行时 ----------
FROM node:24-bookworm AS runtime

# apt 源使用中国大陆镜像（默认清华 TUNA），可用 --build-arg APT_MIRROR=... 覆盖
ARG APT_MIRROR=mirrors.tuna.tsinghua.edu.cn

# ffmpeg：视频抽帧/拼接、音频混音等工作流依赖
RUN sed -i "s|deb.debian.org|${APT_MIRROR}|g; s|security.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i "s|deb.debian.org|${APT_MIRROR}|g; s|security.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list 2>/dev/null; \
    apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

# 根目录基配置：server/tsconfig.json 继承它，tsx 运行时会读取
COPY tsconfig.base.json ./

# 服务端源码 + 依赖
COPY server/ ./server/
COPY --from=server-deps /build/server/node_modules ./server/node_modules

# 前端构建产物（Express 静态托管 frontend/dist）
COPY --from=frontend-builder /build/frontend/dist ./frontend/dist

# 运行时数据目录（docker-compose 通过 bind mount 持久化，见 docker-compose.yml）
RUN mkdir -p /app/design /app/data /app/server/config

EXPOSE 3001

WORKDIR /app/server
# 等价于根目录 npm start：tsx 运行 TS 服务端入口
CMD ["npm", "start"]
