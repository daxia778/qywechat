"""
平台驱动自动检测 + 统一接口
"""
import platform


class BaseDriver:
    """平台驱动基类"""

    def add_customer(self, contact: str) -> tuple[bool, str]:
        """通过手机号在企微中添加客户
        返回: (成功, 用户微信昵称)
        """
        raise NotImplementedError

    def check_wecom_running(self) -> bool:
        """检查企微桌面端是否在运行"""
        raise NotImplementedError

    def create_group(self, members: list[str], group_name: str = "") -> tuple[bool, str]:
        """创建企微群聊
        members: 成员显示名列表
        group_name: 群名
        返回: (成功, 结果描述)
        """
        raise NotImplementedError

    def invite_to_group(self, group_name: str, contact_name: str) -> tuple[bool, str]:
        """邀请联系人入已有群
        返回: (成功, 结果描述)
        """
        raise NotImplementedError


def get_driver() -> BaseDriver:
    system = platform.system()
    if system == "Darwin":
        from .macos_ax import MacOSDriver
        return MacOSDriver()
    elif system == "Windows":
        from .windows_uia import WindowsDriver
        return WindowsDriver()
    raise RuntimeError(f"不支持的平台: {system}")
