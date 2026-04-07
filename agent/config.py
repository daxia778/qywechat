"""
企微自动化 Agent 配置
"""
import os

# 服务器地址（Go 后端）
SERVER_URL = os.getenv("AGENT_SERVER_URL", "https://zhiyuanshijue.ltd")

# Agent 认证 Token（与后端 AUTO_ADD_AGENT_TOKEN 一致）
AGENT_TOKEN = os.getenv("AGENT_TOKEN", "")

# 轮询间隔（秒）- 无任务时的等待时间
POLL_INTERVAL = int(os.getenv("AGENT_POLL_INTERVAL", "10"))

# 任务执行间隔（秒）- 完成一个任务后的等待，防风控
TASK_INTERVAL = int(os.getenv("AGENT_TASK_INTERVAL", "45"))

# 任务间隔随机抖动范围（秒）
TASK_JITTER = int(os.getenv("AGENT_TASK_JITTER", "15"))

# 心跳间隔（秒）
HEARTBEAT_INTERVAL = int(os.getenv("AGENT_HEARTBEAT_INTERVAL", "60"))

# 工作时间范围
WORK_HOUR_START = int(os.getenv("AGENT_WORK_HOUR_START", "9"))
WORK_HOUR_END = int(os.getenv("AGENT_WORK_HOUR_END", "22"))

# API 路径
API_PREFIX = "/api/v1/agent/automation"
