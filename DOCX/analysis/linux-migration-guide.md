# Linux 迁移指南

## 一、结论：完全兼容 Linux

**项目完全可以迁移到 Linux 系统，没有任何平台依赖。**

---

## 二、兼容性分析

### ✅ 代码层面
1. **TypeScript/Node.js** - 完全跨平台
2. **Node.js 标准库** - 使用 `node:fs`、`node:path`、`node:sqlite` 等，全部跨平台
3. **路径处理** - 使用 `path.join()` 和 `path.resolve()`，自动处理路径分隔符
4. **文件操作** - 使用标准 fs 模块，跨平台
5. **SQLite** - 使用 Node 22 内置 `node:sqlite`，跨平台

### ✅ 依赖层面
1. **所有 npm 依赖** - 都是纯 JavaScript 或跨平台的原生模块
2. **没有 Windows 特定依赖** - 没有 `windows-build-tools`、`.bat` 文件等
3. **没有平台特定的编译** - 所有模块都是标准的 Node.js 模块

### ✅ 构建层面
1. **tsup** - 跨平台构建工具
2. **tsx** - 跨平台 TypeScript 运行时
3. **npm scripts** - 使用标准命令，跨平台

---

## 三、迁移步骤

### 3.1 环境准备

#### 安装 Node.js 22+
```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# CentOS/RHEL/Fedora
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo yum install -y nodejs

# 或使用 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 22
nvm use 22
```

#### 验证 Node.js 版本
```bash
node --version  # 应该 >= 22.0.0
npm --version
```

### 3.2 项目迁移

#### 方法 1：直接复制
```bash
# 在 Windows 上打包
cd A:\Github\codex_register
tar -czf codex_register.tar.gz --exclude=node_modules --exclude=data --exclude=bundle .

# 在 Linux 上解压
mkdir -p ~/codex_register
cd ~/codex_register
tar -xzf codex_register.tar.gz
```

#### 方法 2：使用 Git
```bash
# 如果项目在 Git 仓库中
git clone <your-repo-url> ~/codex_register
cd ~/codex_register
```

### 3.3 安装依赖
```bash
cd ~/codex_register
npm install
```

### 3.4 配置文件
```bash
# 复制配置文件（如果需要）
cp config.example.json config.json

# 编辑配置
nano config.json
```

### 3.5 构建项目
```bash
npm run build
```

### 3.6 测试运行
```bash
# 测试数据库功能
npm run dev -- --db-list-accounts

# 测试 workflow
npm run dev -- --workflow codex-cpa-register --count 1 --token-out tokens.txt
```

---

## 四、Linux 特定配置

### 4.1 文件权限
```bash
# 确保 data 目录可写
chmod 755 data/

# 确保配置文件安全
chmod 600 config.json
```

### 4.2 后台运行
```bash
# 使用 nohup
nohup npm run dev -- --workflow codex-cpa-register --count 100 --token-out tokens.txt > output.log 2>&1 &

# 或使用 screen/tmux
screen -S codex-register
npm run dev -- --workflow codex-cpa-register --count 100 --token-out tokens.txt
# Ctrl+A+D 分离

# 或使用 systemd
sudo nano /etc/systemd/system/codex-register.service
```

### 4.3 systemd 服务示例
```ini
[Unit]
Description=Codex Register Service
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/home/your-user/codex_register
ExecStart=/usr/bin/node bundle/index.cjs --workflow codex-cpa-register --count 100 --token-out tokens.txt
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable codex-register
sudo systemctl start codex-register
sudo systemctl status codex-register
```

---

## 五、路径差异

### Windows 路径
```
A:\Github\codex_register\
A:\Github\codex_register\data\codex-register.sqlite
A:\Github\codex_register\config.json
```

### Linux 路径
```
/home/user/codex_register/
/home/user/codex_register/data/codex-register.sqlite
/home/user/codex_register/config.json
```

**注意：** 代码使用 `path.join()` 和 `path.resolve()`，会自动处理路径分隔符，无需手动修改。

---

## 六、环境变量

### Linux 环境变量设置
```bash
# 临时设置
export CPA_BASE_URL="http://your-cpa-url"
export CPA_MANAGEMENT_KEY="your-key"

# 永久设置
echo 'export CPA_BASE_URL="http://your-cpa-url"' >> ~/.bashrc
echo 'export CPA_MANAGEMENT_KEY="your-key"' >> ~/.bashrc
source ~/.bashrc
```

### .env 文件（可选）
```bash
# 创建 .env 文件
cat > .env << EOF
CPA_BASE_URL=http://your-cpa-url
CPA_MANAGEMENT_KEY=your-key
HERO_SMS_API_KEY=your-key
EOF
```

---

## 七、数据库迁移

### 7.1 直接复制数据库
```bash
# Windows 上复制数据库
scp user@windows:/A/Github/codex_register/data/codex-register.sqlite ~/codex_register/data/

# 或使用 rsync
rsync -avz user@windows:/A/Github/codex_register/data/ ~/codex_register/data/
```

### 7.2 导出/导入数据
```bash
# Windows 上导出
npm run dev -- --db-export-tokens tokens_export.txt

# Linux 上导入（需要手动处理）
```

### 7.3 重新创建数据库
```bash
# 数据库会自动创建
npm run dev -- --workflow codex-cpa-register --count 1 --token-out tokens.txt
```

---

## 八、常见问题

### 8.1 Node.js 版本问题
**问题：** `node:sqlite` 模块不可用
**解决：** 确保使用 Node.js 22+

### 8.2 权限问题
**问题：** 无法写入 data 目录
**解决：**
```bash
chmod 755 data/
chown -R $USER:$USER data/
```

### 8.3 网络问题
**问题：** 无法访问外部 API
**解决：** 检查防火墙和代理设置

### 8.4 依赖问题
**问题：** npm install 失败
**解决：**
```bash
# 清除缓存
npm cache clean --force

# 删除 node_modules 重新安装
rm -rf node_modules package-lock.json
npm install
```

---

## 九、性能优化

### 9.1 Node.js 内存限制
```bash
# 增加内存限制
node --max-old-space-size=4096 bundle/index.cjs
```

### 9.2 并发优化
```bash
# 根据服务器性能调整并发数
npm run dev -- --workflow codex-cpa-register --count 100 --concurrency 10 --token-out tokens.txt
```

### 9.3 SQLite 优化
```bash
# 定期清理数据库
sqlite3 data/codex-register.sqlite "VACUUM;"
```

---

## 十、监控和日志

### 10.1 日志记录
```bash
# 输出到文件
npm run dev -- --workflow codex-cpa-register --count 100 --token-out tokens.txt 2>&1 | tee output.log

# 使用 systemd journal
sudo journalctl -u codex-register -f
```

### 10.2 进程监控
```bash
# 使用 htop
htop

# 使用 pm2
npm install -g pm2
pm2 start npm --name "codex-register" -- run dev -- --workflow codex-cpa-register --count 100 --token-out tokens.txt
pm2 status
pm2 logs
```

---

## 十一、备份策略

### 11.1 定期备份
```bash
# 创建备份脚本
cat > backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/backup/codex_register"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR
tar -czf $BACKUP_DIR/codex_register_$DATE.tar.gz \
  --exclude=node_modules \
  --exclude=data \
  --exclude=bundle \
  ~/codex_register/
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete
EOF

chmod +x backup.sh
```

### 11.2 定时备份
```bash
# 添加到 crontab
crontab -e

# 每天凌晨 2 点备份
0 2 * * * /home/user/backup.sh
```

---

## 十二、总结

### ✅ 完全兼容
- 代码完全跨平台
- 无需修改任何代码
- 所有依赖都是跨平台的

### ✅ 迁移简单
1. 复制项目文件
2. 安装 Node.js 22+
3. 运行 `npm install`
4. 运行 `npm run build`
5. 开始使用

### ✅ 生产就绪
- 可以使用 systemd 管理服务
- 可以使用 pm2 进行进程管理
- 可以配置日志和监控
- 可以设置定时备份

---

## 十三、快速开始（Linux）

```bash
# 1. 安装 Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 克隆项目
git clone <your-repo-url> ~/codex_register
cd ~/codex_register

# 3. 安装依赖
npm install

# 4. 构建
npm run build

# 5. 测试
npm run dev -- --db-list-accounts

# 6. 运行
npm run dev -- --workflow codex-cpa-register --count 1 --token-out tokens.txt
```
