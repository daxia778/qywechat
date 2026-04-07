"""
企微自动化 Agent 主服务
功能：轮询服务器任务队列 → 调度 UI 自动化执行 → 回写结果 → 心跳上报

用法：
    # 设置环境变量
    export AGENT_TOKEN="your-token-here"
    export AGENT_SERVER_URL="https://zhiyuanshijue.ltd"

    # 启动
    python3 -m agent.wecom_agent

    # 或直接运行
    python3 agent/wecom_agent.py
"""
import json
import logging
import platform
import random
import signal
import sys
import time
import uuid
from datetime import datetime

import requests

# 支持两种导入方式：作为包运行和直接运行
try:
    from agent import config
except ImportError:
    import os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from agent import config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("wecom-agent")


class WecomAutoAgent:
    def __init__(self):
        if not config.AGENT_TOKEN:
            log.error("AGENT_TOKEN 未设置，请设置环境变量 AGENT_TOKEN")
            sys.exit(1)

        self.server_url = config.SERVER_URL.rstrip("/")
        self.token = config.AGENT_TOKEN
        self.machine_id = self._get_machine_id()
        self.tasks_done = 0
        self.tasks_failed = 0
        self.last_heartbeat = 0
        self.running = True
        self.driver = None

        # 延迟加载驱动（允许在无 GUI 环境下导入模块）
        self._init_driver()

        log.info("=" * 50)
        log.info("企微自动化 Agent 启动")
        log.info(f"  服务器: {self.server_url}")
        log.info(f"  平台: {platform.system()} {platform.release()}")
        log.info(f"  机器ID: {self.machine_id[:16]}...")
        log.info(f"  工作时间: {config.WORK_HOUR_START}:00 - {config.WORK_HOUR_END}:00")
        log.info(f"  任务间隔: {config.TASK_INTERVAL}s ± {config.TASK_JITTER}s")
        log.info("=" * 50)

    def _init_driver(self):
        try:
            from agent.platforms import get_driver
            self.driver = get_driver()
            log.info(f"UI 驱动加载成功: {type(self.driver).__name__}")
        except Exception as e:
            log.error(f"UI 驱动加载失败: {e}")
            log.error("请确保企微桌面端正在运行，且已授予辅助功能权限")
            sys.exit(1)

    def _get_machine_id(self) -> str:
        """生成机器唯一标识"""
        import hashlib
        raw = f"{platform.node()}-{platform.machine()}-{platform.system()}"
        return hashlib.sha256(raw.encode()).hexdigest()[:32]

    def _api_url(self, path: str) -> str:
        return f"{self.server_url}{config.API_PREFIX}{path}"

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    # ─── API 调用 ──────────────────────────────────────

    def heartbeat(self):
        """心跳上报"""
        now = time.time()
        if now - self.last_heartbeat < config.HEARTBEAT_INTERVAL:
            return

        try:
            resp = requests.post(
                self._api_url("/heartbeat"),
                headers=self._headers(),
                json={
                    "platform": platform.system(),
                    "version": "1.0.0",
                    "machine_id": self.machine_id,
                    "tasks_done": self.tasks_done,
                    "tasks_failed": self.tasks_failed,
                },
                timeout=10,
            )
            if resp.status_code == 200:
                self.last_heartbeat = now
            else:
                log.warning(f"心跳上报失败: {resp.status_code} {resp.text[:100]}")
        except Exception as e:
            log.warning(f"心跳上报异常: {e}")

    def fetch_pending(self, task_type: str = "add_friend") -> tuple[dict | None, dict | None]:
        """拉取一条待执行任务，返回 (task, group_info)"""
        try:
            resp = requests.get(
                self._api_url("/pending"),
                headers=self._headers(),
                params={"task_type": task_type},
                timeout=10,
            )
            if resp.status_code != 200:
                log.warning(f"拉取任务失败: {resp.status_code}")
                return None, None

            data = resp.json().get("data", {})
            task = data.get("task")
            group_info = data.get("group_info")
            return task, group_info
        except Exception as e:
            log.warning(f"拉取任务异常: {e}")
            return None, None

    def report_result(self, task_id: int, status: str, result: str = ""):
        """回写任务执行结果"""
        try:
            resp = requests.put(
                self._api_url(f"/{task_id}/status"),
                headers=self._headers(),
                json={"status": status, "result": result},
                timeout=10,
            )
            if resp.status_code != 200:
                log.warning(f"回写结果失败: {resp.status_code} {resp.text[:100]}")
        except Exception as e:
            log.warning(f"回写结果异常: {e}")

    # ─── 任务执行 ──────────────────────────────────────

    def execute_add_friend(self, task: dict) -> tuple[bool, str]:
        """执行添加好友任务"""
        phone = task.get("phone", "")
        order_sn = task.get("order_sn", "")

        if not phone:
            return False, "手机号为空"

        log.info(f"执行添加好友: {phone} (订单: {order_sn})")

        if not self.driver.check_wecom_running():
            return False, "企业微信未运行"

        try:
            success, nickname = self.driver.add_customer(phone)
            if success:
                return True, f"已发送好友请求: {phone} (昵称: {nickname})"
            else:
                return False, "UI 操作未成功完成"
        except Exception as e:
            return False, f"执行异常: {str(e)}"

    def execute_create_group(self, task: dict, group_info: dict | None = None) -> tuple[bool, str]:
        """执行建群任务"""
        order_sn = task.get("order_sn", "")

        if not self.driver.check_wecom_running():
            return False, "企业微信未运行"

        # 从 group_info 获取成员显示名和群名
        if not group_info:
            return False, "缺少 group_info（成员名称等信息）"

        group_name = group_info.get("group_name", "")
        customer_nickname = group_info.get("customer_nickname", "")
        follow_name = group_info.get("follow_name", "")
        sales_name = group_info.get("sales_name", "")

        # 构建成员列表（当前登录账号会自动包含，不需要加入列表）
        members = []
        seen = set()
        for name in [customer_nickname, follow_name, sales_name]:
            if name and name not in seen:
                members.append(name)
                seen.add(name)

        if len(members) < 2:
            return False, f"有效成员不足2人: {members}"

        log.info(f"执行建群: {group_name} | 成员: {members} (订单: {order_sn})")

        try:
            success, result = self.driver.create_group(members, group_name)
            return success, result
        except Exception as e:
            return False, f"执行异常: {str(e)}"

    def execute_invite_to_group(self, task: dict, group_info: dict | None = None) -> tuple[bool, str]:
        """执行邀请入群任务"""
        if not self.driver.check_wecom_running():
            return False, "企业微信未运行"

        if not group_info:
            return False, "缺少 group_info"

        # 通过搜索群聊名称定位群，然后邀请联系人
        # group_chat_id 用于后端记录，UI 自动化通过群名搜索
        customer_nickname = group_info.get("customer_nickname", "")
        if not customer_nickname:
            return False, "缺少要邀请的联系人昵称"

        # 需要找到群聊 — 通过订单关联的群名搜索
        # 从 task 获取订单信息来定位群
        order_sn = task.get("order_sn", "")
        log.info(f"执行邀请入群: 联系人={customer_nickname} (订单: {order_sn})")

        try:
            success, result = self.driver.invite_to_group(
                group_name=order_sn,  # 用订单号部分搜索群聊
                contact_names=customer_nickname,
            )
            return success, result
        except Exception as e:
            return False, f"执行异常: {str(e)}"

    def execute_task(self, task: dict, group_info: dict | None = None):
        """分发并执行任务"""
        task_id = task.get("id")
        task_type = task.get("task_type", "add_friend")

        log.info(f"开始执行任务 #{task_id} (type={task_type})")

        if task_type == "add_friend":
            success, result = self.execute_add_friend(task)
        elif task_type == "create_group":
            success, result = self.execute_create_group(task, group_info)
        elif task_type == "invite_to_group":
            success, result = self.execute_invite_to_group(task, group_info)
        else:
            success, result = False, f"未知任务类型: {task_type}"

        status = "success" if success else "failed"
        log.info(f"任务 #{task_id} 结果: {status} — {result}")

        if success:
            self.tasks_done += 1
        else:
            self.tasks_failed += 1

        self.report_result(task_id, status, result)

    # ─── 主循环 ────────────────────────────────────────

    def is_work_hours(self) -> bool:
        hour = datetime.now().hour
        return config.WORK_HOUR_START <= hour < config.WORK_HOUR_END

    def run(self):
        """主循环"""
        task_types = ["add_friend", "create_group", "invite_to_group"]

        while self.running:
            try:
                # 心跳（不管是否工作时间都发）
                self.heartbeat()

                # 非工作时间休眠
                if not self.is_work_hours():
                    log.debug("非工作时间，休眠中...")
                    time.sleep(60)
                    continue

                # 轮询多种任务类型
                found_task = False
                for task_type in task_types:
                    task, group_info = self.fetch_pending(task_type)
                    if task:
                        self.execute_task(task, group_info)
                        found_task = True
                        break  # 每轮只执行一个任务

                if found_task:
                    # 任务执行后等待（防风控）
                    jitter = random.randint(0, config.TASK_JITTER)
                    wait = config.TASK_INTERVAL + jitter
                    log.info(f"等待 {wait}s 后继续...")
                    self._sleep(wait)
                else:
                    # 无任务，短暂等待后重试
                    self._sleep(config.POLL_INTERVAL)

            except KeyboardInterrupt:
                break
            except Exception as e:
                log.error(f"主循环异常: {e}", exc_info=True)
                self._sleep(30)

        log.info("Agent 已停止")

    def _sleep(self, seconds: float):
        """可中断的 sleep"""
        end = time.time() + seconds
        while time.time() < end and self.running:
            time.sleep(min(1, end - time.time()))

    def stop(self, *args):
        log.info("收到停止信号...")
        self.running = False


def main():
    agent = WecomAutoAgent()
    signal.signal(signal.SIGINT, agent.stop)
    signal.signal(signal.SIGTERM, agent.stop)
    agent.run()


if __name__ == "__main__":
    main()
