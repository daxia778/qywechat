<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';

// ══ 缩放相关 ══
const zoomImageRef = ref(null);
const modalContentRef = ref(null);
const modalOverlayRef = ref(null);
const zoomState = reactive({
  scale: 1,
  translateX: 0,
  translateY: 0,
  isDragging: false,
  hasDragged: false,
  dragStartX: 0,
  dragStartY: 0,
  lastTranslateX: 0,
  lastTranslateY: 0,
});

const zoomImageStyle = computed(() => ({
  transform: `translate(${zoomState.translateX}px, ${zoomState.translateY}px) scale(${zoomState.scale})`,
  transformOrigin: '0 0',
  cursor: zoomState.scale > 1 ? (zoomState.isDragging ? 'grabbing' : 'grab') : 'zoom-in',
  transition: zoomState.isDragging ? 'none' : 'transform 0.15s ease-out',
}));

const handleZoomWheel = (e) => {
  const img = zoomImageRef.value;
  if (!img) return;

  const rect = img.getBoundingClientRect();
  // 鼠标在图片上的相对位置（考虑当前变换）
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  // 鼠标在原始图片坐标系中的位置
  const imgX = mouseX / zoomState.scale;
  const imgY = mouseY / zoomState.scale;

  const delta = e.deltaY > 0 ? -1 : 1;
  const factor = 1 + delta * 0.15;
  const newScale = Math.min(Math.max(zoomState.scale * factor, 0.5), 8);

  // 基于鼠标落点进行缩放：保持鼠标指向的图片内容点不动
  zoomState.translateX = e.clientX - imgX * newScale - (rect.left - zoomState.translateX);
  zoomState.translateY = e.clientY - imgY * newScale - (rect.top - zoomState.translateY);
  zoomState.scale = newScale;
};

const startDrag = (e) => {
  if (zoomState.scale <= 1) return;
  e.preventDefault();
  zoomState.isDragging = true;
  zoomState.hasDragged = false;
  zoomState.dragStartX = e.clientX;
  zoomState.dragStartY = e.clientY;
  zoomState.lastTranslateX = zoomState.translateX;
  zoomState.lastTranslateY = zoomState.translateY;
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
};

const onDrag = (e) => {
  if (!zoomState.isDragging) return;
  const dx = e.clientX - zoomState.dragStartX;
  const dy = e.clientY - zoomState.dragStartY;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
    zoomState.hasDragged = true;
  }
  zoomState.translateX = zoomState.lastTranslateX + dx;
  zoomState.translateY = zoomState.lastTranslateY + dy;
};

const stopDrag = () => {
  zoomState.isDragging = false;
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
};

// 点击 overlay 关闭弹窗（拖拽过则不关闭）
const closePreviewIfNotDragged = () => {
  if (!zoomState.hasDragged) {
    state.showPreviewModal = false;
  }
  zoomState.hasDragged = false;
};
const onOverlayWheel = (e) => {
  e.preventDefault();
  e.stopPropagation();
  handleZoomWheel(e);
};

// ══ 状态 ══
const state = reactive({
  isLoggedIn: false,
  empName: '',
  wecomUid: '',
  macAddress: '',
  
  // 登录表单
  activationCode: '',
  loginLoading: false,
  loginError: '',
  
  // 订单表单
  orderSn: '',
  price: null,
  rawPrice: '',
  orderTime: '',        // 下单时间（OCR 识别）
  priceLocked: false,
  uploading: false,
  ocrRetryCount: 0,     // OCR 重试计数
  screenshotUrl: '',    // OCR 截图 URL（上传后由后端返回）
  screenshotHash: '',   // OCR 截图 SHA256 哈希（防篡改）
  previewUrl: '',       // 图片预览 URL
  showPreviewModal: false, // 是否显示大图弹窗
  
  form: {
    customerContact: '',
    followStaffUID: '',
  },
  followStaffList: [],
  followStaffLoading: false,

  // AI 文本解析
  noteText: '',            // 原始输入文本
  parsedResult: null,      // AI 解析结果 {contact, theme, pages, deadline, remark, ...}
  parseLoading: false,     // 正在解析中
  parsedConfirmed: false,  // 用户已确认解析结果
  lastParsedHash: '',      // 上次解析的文本哈希（防重复调用）
  // 确认后的可编辑字段
  editFields: {
    contact: '',
    theme: '',
    pages: '',
    deadline: '',
    remark: '',
  },

  // 备注图片附件
  attachments: [],        // [{url: '服务端URL', preview: 'base64预览'}]
  attachmentUploading: false,
  mouseOverAttachment: false,  // 鼠标是否在附件区域内（用于粘贴路由）

  submitLoading: false,
  toastMsg: '',
  toastType: 'success',
  showToast: false,

  // OTA Update
  updateInfo: null,
  showUpdateModal: false,

  // 平台检测
  isMac: true, // 默认 macOS, 启动时更新
});

// ══ 缩放弹窗 watch（必须在 state 定义之后）══
watch(() => state.showPreviewModal, (val) => {
  if (val) {
    zoomState.scale = 1;
    zoomState.translateX = 0;
    zoomState.translateY = 0;
    zoomState.isDragging = false;
    nextTick(() => {
      const el = modalOverlayRef.value;
      if (el) {
        el.addEventListener('wheel', onOverlayWheel, { passive: false });
      }
    });
  } else {
    const el = modalOverlayRef.value;
    if (el) {
      el.removeEventListener('wheel', onOverlayWheel);
    }
  }
});

// ══ 初始化 ══
onMounted(async () => {
  try {
    state.macAddress = await window.go.main.App.GetMacAddress();

    // 检测平台
    try {
      const platform = await window.go.main.App.GetPlatform();
      state.isMac = platform === 'darwin';
    } catch(e) { state.isMac = navigator.platform.includes('Mac'); }
    // 先检查内存中是否有会话（Go 层 loadSession 恢复的）
    const loggedIn = await window.go.main.App.IsLoggedIn();
    if (loggedIn) {
      state.empName = await window.go.main.App.GetEmployeeName();
      state.isLoggedIn = true;
      showToast('已自动恢复登录');
    } else {
      // 尝试用设备指纹静默登录（空激活码 → 服务端按 machine_id 匹配）
      const res = await window.go.main.App.DeviceLogin('');
      if (res.success) {
        state.isLoggedIn = true;
        state.empName = res.name;
        state.wecomUid = res.wecom_uid;
        showToast('设备已识别，自动登录');
      }
    }

    // 登录成功后加载跟单客服列表
    if (state.isLoggedIn) {
      loadFollowStaff();
    }

    // 检查版本更新
    checkAppUpdate();
  } catch (e) {
    console.error('初始化失败', e);
  }

  // 监听全局粘贴事件
  document.addEventListener('paste', handleGlobalPaste);
});

onUnmounted(() => {
  document.removeEventListener('paste', handleGlobalPaste);
});

// ══ 辅助 ══
const showToast = (msg, type = 'success') => {
  state.toastMsg = msg;
  state.toastType = type;
  state.showToast = true;
  setTimeout(() => {
    state.showToast = false;
  }, 3000);
};

const APP_VERSION = "1.0.0"; // 当前版本号

const checkAppUpdate = async () => {
  try {
    const info = await window.go.main.App.CheckUpdate(APP_VERSION);
    if (info && info.has_update) {
      state.updateInfo = info;
      state.showUpdateModal = true;
    }
  } catch (e) {
    console.error("检查更新失败: ", e);
  }
};

// ══ 功能 ══

const loadFollowStaff = async () => {
  state.followStaffLoading = true;
  try {
    const list = await window.go.main.App.GetFollowStaffList();
    state.followStaffList = list || [];
  } catch (e) {
    console.error('加载跟单客服列表失败', e);
    state.followStaffList = [];
  } finally {
    state.followStaffLoading = false;
  }
};

const handleLogout = async () => {
  // 清除 Go 后端状态和本地会话文件
  try { await window.go.main.App.ClearSession(); } catch(e) {}
  state.isLoggedIn = false;
  state.empName = '';
  state.wecomUid = '';
  state.activationCode = '';

  // 立即尝试设备指纹静默重新登录
  try {
    const res = await window.go.main.App.DeviceLogin('');
    if (res.success) {
      state.isLoggedIn = true;
      state.empName = res.name;
      state.wecomUid = res.wecom_uid;
      showToast('设备已识别，自动重新登录');
      loadFollowStaff();
      return;
    }
  } catch(e) {}

  showToast('已退出登录');
};

const handleLogin = async () => {
  state.loginLoading = true;
  state.loginError = '';

  try {
    // 允许空激活码 — 此时走设备指纹静默登录
    const res = await window.go.main.App.DeviceLogin(state.activationCode);
    if (res.success) {
      state.isLoggedIn = true;
      state.empName = res.name;
      state.wecomUid = res.wecom_uid;
      showToast('设备登录成功');
      loadFollowStaff();
    } else {
      state.loginError = res.message;
    }
  } catch (err) {
    state.loginError = '登录异常: ' + err;
  } finally {
    state.loginLoading = false;
  }
};

const handleFileDrop = async (e) => {
  e.preventDefault();
  const files = e.dataTransfer.files;
  if (files.length > 0) processFile(files[0]);
};

const handleFileSelect = (e) => {
  const files = e.target.files;
  if (files.length > 0) processFile(files[0]);
};

// Mock 模拟浏览器原生文件选择拿不到具体桌面路径给Go，真正的wails实现应该是调用Go的SelectFile，
// 这里简略处理为一个提示，真实使用时修改Go层弹出文件选择框。
const processFile = async (file) => {
  // 注意：Wails 默认不直接允许前端读取用户磁盘绝对路径传给Go。
  // 正确的做法是前端调用 Go 方法弹出选文件框，Go 直接读取处理 OCR，返回结果。
  // 但为了快速演示，我们这里假装前端拿到路径或者用 Wails 特有机制。
  showToast('因安全限制，请在实际版本中点击触发系统选择框', 'error');
};

const triggerGoFileSelect = async () => {
  try {
    const filePath = await window.go.main.App.SelectScreenshotFile();
    if (!filePath) return; // User canceled
    
    // 桌面端无法直接在网页中通过绝对路径显示图片 (安全限制)
    // 所以这里的 filePath 暂不拿来做即时预览，或者等 OCR 成功后标记已选
    state.previewUrl = ''; 
    
    state.uploading = true;
    showToast('正在通过大模型进行OCR图文解析...', 'success');
    
    const res = await window.go.main.App.UploadScreenshot(filePath);
    handleOCRResponse(res);
  } catch (err) {
    showToast('文件处理失败: ' + err, 'error');
  } finally {
    state.uploading = false;
  }
};

const handleGlobalPaste = async (e) => {
  if (!state.isLoggedIn) return;

  // 如果焦点在备注 textarea 内，交给 handleAttachmentPaste 处理
  if (e.target && e.target.tagName === 'TEXTAREA') return;

  const items = e.clipboardData?.items;
  if (!items) return;

  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      e.preventDefault();
      const file = items[i].getAsFile();
      if (!file) continue;

      // ★ 核心路由逻辑：鼠标在附件区域内 → 无条件走附件
      if (state.mouseOverAttachment) {
        uploadClipboardAsAttachment(file);
        return;
      }

      // OCR 已锁定或已有截图：全局粘贴走备注附件
      if (state.priceLocked || state.previewUrl) {
        uploadClipboardAsAttachment(file);
        return;
      }

      // OCR 完全未开始：走 OCR 识别
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Data = event.target.result;
        state.previewUrl = base64Data;
        state.uploading = true;
        showToast('检测到剪贴板图片，正在OCR解析...', 'success');
        try {
          const res = await window.go.main.App.UploadScreenshotBase64(base64Data);
          handleOCRResponse(res);
        } catch (err) {
          showToast('剪贴板解析失败: ' + err, 'error');
        } finally {
          state.uploading = false;
        }
      };
      reader.readAsDataURL(file);
      break;
    }
  }
};

// 通用的剪贴板图片上传为备注附件
const uploadClipboardAsAttachment = (file) => {
  if (state.attachments.length >= 5) {
    showToast('最多添加 5 张备注图片', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = async (event) => {
    const base64Data = event.target.result;
    state.attachmentUploading = true;
    showToast('正在上传备注图片...', 'success');
    try {
      const res = await window.go.main.App.UploadAttachmentBase64(base64Data);
      if (res.error) {
        showToast('图片上传失败: ' + res.error, 'error');
      } else {
        state.attachments.push({ url: res.url, preview: base64Data });
        showToast('备注图片已添加');
      }
    } catch (err) {
      showToast('图片上传异常: ' + err, 'error');
    } finally {
      state.attachmentUploading = false;
    }
  };
  reader.readAsDataURL(file);
};

// 附件区域独立粘贴处理器：无论 OCR 状态如何，粘贴到此区域的图片都走附件
const handleAttachmentZonePaste = async (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      e.preventDefault();
      e.stopPropagation();
      const file = items[i].getAsFile();
      if (!file) continue;
      uploadClipboardAsAttachment(file);
      break;
    }
  }
};

const handleOCRResponse = (res) => {
  if (res.error) {
     state.ocrRetryCount++;
     const remainRetries = 3 - state.ocrRetryCount;
     if (remainRetries > 0) {
       showToast(`${res.error} (剩余 ${remainRetries} 次重试机会)`, 'error');
     } else {
       showToast('多次识别失败，请手动输入订单号和金额后提交', 'error');
       // 超过3次失败，解锁手动输入（降级方案）
       state.priceLocked = false;
     }
  } else {
     state.orderSn = res.order_sn;
     state.rawPrice = res.raw_price || (res.price / 100).toFixed(2);
     state.price = res.price;
     state.orderTime = res.order_time || '';
     state.screenshotUrl = res.screenshot_url || '';
     state.screenshotHash = res.screenshot_hash || '';
     state.ocrRetryCount = 0; // 成功后重置计数
     
     if (res.price === 0 && !res.order_sn) {
       // 完全没识别到有效信息
       showToast('截图未识别到订单信息，请重新截图或手动输入', 'error');
     } else if (res.price === 0 || !res.order_sn) {
       // 部分识别 → 锁定已识别的部分
       state.priceLocked = true;
       showToast('⚠️ 部分识别成功，缺失项请联系管理员核实', 'error');
     } else {
       // 完全识别成功 → 全部锁定
       state.priceLocked = true;
       showToast('🔒 OCR 校验完成，订单号与金额已锁定', 'success');
     }
  }
};

const resetOCR = () => {
  state.orderSn = '';
  state.rawPrice = '';
  state.price = null;
  state.orderTime = '';
  state.priceLocked = false;
  state.ocrRetryCount = 0;
  state.previewUrl = '';
  showToast('已撤销，可重新截图或粘贴');
};

// ══ 备注图片附件 ══
const handleAttachmentPaste = async (e) => {
  // 仅在备注区域聚焦时触发（由模板 @paste 绑定）
  const items = e.clipboardData?.items;
  if (!items) return;

  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      e.preventDefault();
      e.stopPropagation();
      const file = items[i].getAsFile();
      if (!file) continue;

      if (state.attachments.length >= 5) {
        showToast('最多添加 5 张备注图片', 'error');
        return;
      }

      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Data = event.target.result;
        state.attachmentUploading = true;
        try {
          const res = await window.go.main.App.UploadAttachmentBase64(base64Data);
          if (res.error) {
            showToast('图片上传失败: ' + res.error, 'error');
          } else {
            state.attachments.push({ url: res.url, preview: base64Data });
            showToast('备注图片已添加');
          }
        } catch (err) {
          showToast('图片上传异常: ' + err, 'error');
        } finally {
          state.attachmentUploading = false;
        }
      };
      reader.readAsDataURL(file);
      break;
    }
  }
};

const selectAttachmentFile = async () => {
  if (state.attachments.length >= 5) {
    showToast('最多添加 5 张备注图片', 'error');
    return;
  }
  try {
    const filePath = await window.go.main.App.SelectAttachmentFile();
    if (!filePath) return;

    state.attachmentUploading = true;
    const res = await window.go.main.App.UploadAttachmentFile(filePath);
    if (res.error) {
      showToast('图片上传失败: ' + res.error, 'error');
    } else {
      // 文件选择模式没有本地预览，用服务端 URL 作为预览源
      state.attachments.push({ url: res.url, preview: '' });
      showToast('备注图片已添加');
    }
  } catch (err) {
    showToast('图片上传异常: ' + err, 'error');
  } finally {
    state.attachmentUploading = false;
  }
};

const removeAttachment = (index) => {
  state.attachments.splice(index, 1);
};

// ══ AI 文本智能解析 ══
const simpleHash = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
};

const handleParseText = async () => {
  const text = state.noteText.trim();
  if (!text) {
    showToast('请先输入订单备注信息', 'error');
    return;
  }

  // 防止重复解析相同文本
  const hash = simpleHash(text);
  if (hash === state.lastParsedHash && state.parsedResult) {
    showToast('文本未变化，使用上次解析结果', 'success');
    return;
  }

  state.parseLoading = true;
  state.parsedConfirmed = false;
  try {
    const res = await window.go.main.App.ParseOrderText(text);
    if (res.error) {
      showToast('AI 解析失败: ' + res.error, 'error');
      return;
    }
    state.parsedResult = res;
    state.lastParsedHash = hash;
    // 填充可编辑字段
    state.editFields = {
      contact: res.contact || '',
      theme: res.theme || '',
      pages: res.pages > 0 ? String(res.pages) : '',
      deadline: res.deadline || '',
      remark: res.remark || '',
    };
    if (res.from_cache) {
      showToast('✅ 已从缓存加载解析结果（节省 Token）');
    } else {
      showToast('✅ AI 智能解析完成，请确认信息');
    }
  } catch (err) {
    showToast('解析异常: ' + err, 'error');
  } finally {
    state.parseLoading = false;
  }
};

const confirmParsedResult = () => {
  state.parsedConfirmed = true;
  // 将确认后的联系方式同步到 form.customerContact（可选，客户可能只发了二维码图片）
  state.form.customerContact = state.editFields.contact || '';
  showToast('✅ 信息已确认');
};

const resetParsedResult = () => {
  state.parsedResult = null;
  state.parsedConfirmed = false;
  state.lastParsedHash = '';
  state.editFields = { contact: '', theme: '', pages: '', deadline: '', remark: '' };
  state.form.customerContact = '';
};

const submit = async () => {
  const manualMode = state.ocrRetryCount >= 3;
  if (!state.priceLocked && !manualMode) {
    showToast('请先上传订单截图进行 OCR 解析锁定单价', 'error');
    return;
  }
  if (manualMode && (!state.orderSn || !state.rawPrice)) {
    showToast('手动模式下请填写完整订单号和金额', 'error');
    return;
  }
  // 确保已有联系方式（通过 AI 解析或手动输入）
  if (!state.form.customerContact && !state.noteText.trim()) {
    showToast('请填写订单备注信息', 'error');
    return;
  }
  // P0 防护：如果填了备注文本且 AI 解析了，但未确认，强制要求确认
  if (state.parsedResult && !state.parsedConfirmed) {
    showToast('请先确认 AI 解析结果，或点击「重新编辑」修改', 'error');
    return;
  }
  if (!state.form.followStaffUID) {
    showToast('请选择跟单客服', 'error');
    return;
  }

  state.submitLoading = true;

  // 构造 customerContact：仅使用结构化联系方式，不再用整段备注文本填充
  let customerContact = '';
  if (state.parsedConfirmed && state.editFields.contact) {
    customerContact = state.editFields.contact;
  } else if (state.form.customerContact) {
    customerContact = state.form.customerContact;
  } else {
    // 兜底：从备注文本中尝试提取手机号或 wxid
    const text = state.noteText.trim();
    const phoneMatch = text.match(/1[3-9]\d{9}/);
    const wxidMatch = text.match(/wxid_[\w]{6,30}/);
    if (wxidMatch) {
      customerContact = wxidMatch[0];
    } else if (phoneMatch) {
      customerContact = phoneMatch[0];
    }
    // 如果仍然提取不到，留空而非塞入全文（服务端允许空联系方式）
  }

  try {
    // 提取结构化数据
    const topic = state.parsedConfirmed ? (state.editFields.theme || '') : '';
    const pages = state.parsedConfirmed ? (parseInt(state.editFields.pages) || 0) : 0;
    const deadline = state.parsedConfirmed ? (state.editFields.deadline || '') : '';
    const remark = state.parsedConfirmed ? (state.editFields.remark || '') : state.noteText.trim();

    const res = await window.go.main.App.SubmitOrder(
      state.orderSn,
      customerContact,
      state.form.followStaffUID,
      state.price,
      state.attachments.map(a => a.url),
      state.screenshotUrl,
      state.screenshotHash,
      topic,
      pages,
      deadline,
      remark
    );

    if (res.success) {
      showToast('下单成功！订单已进入派单池');
      // 清空表单
      state.orderSn = '';
      state.price = null;
      state.rawPrice = '';
      state.priceLocked = false;
      state.attachments = [];
      state.previewUrl = '';
      state.screenshotUrl = '';
      state.screenshotHash = '';
      state.orderTime = '';
      state.ocrRetryCount = 0;
      state.noteText = '';
      state.parsedResult = null;
      state.parsedConfirmed = false;
      state.lastParsedHash = '';
      state.editFields = { contact: '', theme: '', pages: '', deadline: '', remark: '' };
      state.form = { customerContact: '', followStaffUID: '' };
    } else {
      showToast(res.message, 'error');
    }
  } catch (err) {
    showToast('提交异常: ' + err, 'error');
  } finally {
    state.submitLoading = false;
  }
};
</script>

<template>
  <!-- 顶部标题栏（纯拖拽区） -->
  <div class="drag-bar"></div>
  
  <div class="app-container">
    
    <!-- 登录页 -->
    <div v-if="!state.isLoggedIn" class="login-page">
      <div class="login-logo">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      </div>
      <h1 class="login-title">单管家</h1>
      <div class="login-subtitle">客服坐席专用高频效能终端</div>
      
      <div class="login-form">
        <div class="form-group">
          <label class="form-label">设备激活码 (首次需要)</label>
          <input 
            v-model="state.activationCode" 
            type="password" 
            class="form-input" 
            placeholder="请输入激活码..."
            @keyup.enter="handleLogin"
          />
          <div v-if="state.loginError" class="login-error">{{ state.loginError }}</div>
        </div>
        <button class="btn btn-primary" @click="handleLogin" :disabled="state.loginLoading">
          <span v-if="state.loginLoading" class="spinner"></span>
          <span v-else>设备安全登录</span>
        </button>
      </div>
      
      <div class="login-mac">
        MAC: {{ state.macAddress }} <br/>
        由系统自动绑定识别，防窃取代签
      </div>
    </div>

    <!-- 主界面 -->
    <div v-else>
      <!-- 用户欢迎条 -->
      <div class="welcome-row">
        <div class="welcome-left">
          <div class="welcome-avatar">{{ state.empName.charAt(0) }}</div>
          <span class="welcome-text">{{ state.empName }}，开始派单吧</span>
        </div>
        <button class="btn-logout-text" @click="handleLogout">退出</button>
      </div>

      <!-- OCR 上传 -->
      <div class="card">
        <div class="card-title">
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          订单智能解析提取
        </div>
        <div 
          class="upload-zone" 
          :class="{'has-file': state.priceLocked || state.previewUrl}"
          @click="!state.previewUrl && triggerGoFileSelect()"
        >
          <div v-if="state.uploading" class="spinner" style="border-top-color: var(--accent); margin-bottom: 10px;"></div>
          
          <!-- 有图片时显示带放大镜的缩略图 -->
          <div v-else-if="state.previewUrl" class="preview-container" @click.stop="state.showPreviewModal = true">
            <img :src="state.previewUrl" class="image-preview" />
            <div class="zoom-overlay">🔍 点击放大</div>
          </div>
          
          <!-- 无图片时显示默认提示 -->
          <div v-else>
            <div class="upload-icon">📸</div>
            <div class="upload-text">点击选择、或直接 <kbd>{{ state.isMac ? 'Cmd' : 'Ctrl' }}+V</kbd> 粘贴截图</div>
            <div class="upload-hint">支持从剪贴板直接粘贴图片自动识别</div>
          </div>
        </div>
        
        <div class="form-row" style="margin-top: 12px;" v-if="state.priceLocked || state.orderSn || state.rawPrice">
          <div class="form-group" style="flex: 2;">
            <label class="form-label">淘宝/PDD单号 (必填) <span v-if="state.priceLocked" style="color: #10B981;">🔒</span></label>
            <input v-model="state.orderSn" class="form-input" :class="{ 'input-locked': state.priceLocked }" :readonly="state.priceLocked" placeholder="输入订单号" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label class="form-label">实付金额 (¥) <span v-if="state.priceLocked" style="color: #10B981;">🔒</span></label>
            <input v-model="state.rawPrice" @input="!state.priceLocked && (state.price = Math.round(parseFloat(state.rawPrice || '0') * 100))" class="form-input" :class="{ 'input-locked': state.priceLocked }" :readonly="state.priceLocked" placeholder="0.00" />
          </div>
        </div>
        <div class="form-group" style="margin-top: 8px;" v-if="state.orderTime">
          <label class="form-label">下单时间 <span style="color: #10B981;">🔒</span></label>
          <input :value="state.orderTime" class="form-input input-locked" readonly />
        </div>
        
        <div style="margin-top: 14px; display: flex; justify-content: space-between; align-items: center;" v-if="state.priceLocked">
          <span class="status-badge success">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            AI 校验成功 · 防篡改已锁定
          </span>
          <button class="btn btn-secondary" style="width: auto; padding: 6px 12px; font-size: 13px;" @click="resetOCR">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            撤销重选
          </button>
        </div>
        <div style="margin-top: 14px; display: flex; justify-content: space-between; align-items: center;" v-else-if="state.ocrRetryCount >= 3">
          <span class="status-badge error">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            多次解析失败 · 手动输入模式
          </span>
          <button class="btn btn-secondary" style="width: auto; padding: 6px 12px; font-size: 13px;" @click="resetOCR">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            清空重新截图
          </button>
        </div>
        <div style="margin-top: 14px; display: flex; justify-content: flex-end;" v-else-if="state.previewUrl">
          <button class="btn btn-secondary" style="width: auto; padding: 6px 12px; font-size: 13px;" @click="resetOCR">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            清空截图
          </button>
        </div>
      </div>

      <!-- 需求信息 -->
      <div class="card">
        <div class="card-title">
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
          顾客与建群信息
        </div>

        <!-- ═══ Step 1: 原始文本输入 ═══ -->
        <div class="form-group" v-if="!state.parsedResult">
          <label class="form-label">订单备注信息 <span style="color:red">*</span></label>
          <textarea v-model="state.noteText" class="form-textarea" rows="4" placeholder="直接粘贴客户沟通内容，例如：&#10;客户微信 wxid_abc123 做一个喜茶风格路演PPT 20页 后天要&#10;&#10;输入完成后点击下方「AI 智能提取」按钮" @paste="handleAttachmentPaste"></textarea>
          <button class="btn btn-ai-parse" @click="handleParseText" :disabled="state.parseLoading || !state.noteText.trim()">
            <span v-if="state.parseLoading" class="spinner" style="width: 14px; height: 14px; border-width: 2px; border-top-color: #fff;"></span>
            {{ state.parseLoading ? 'AI 正在识别...' : '✦ AI 智能提取' }}
          </button>
        </div>

        <!-- ═══ Step 2: AI 解析结果 ═══ -->
        <template v-if="state.parsedResult">
          <div class="parsed-status-bar">
            <span class="parsed-badge" :class="state.parsedResult.confidence">
              {{ state.parsedResult.confidence === 'high' ? '● AI 高置信度' : state.parsedResult.confidence === 'medium' ? '● 正则提取' : '● 低置信度' }}
            </span>
            <span v-if="state.parsedResult.from_cache" class="parsed-cache-tag">已缓存</span>
          </div>

          <div class="form-group">
            <label class="form-label">联系方式 <span style="color:#999;font-size:12px">(选填，可用备注图片代替)</span></label>
            <input v-model="state.editFields.contact" class="form-input" placeholder="微信号/手机号，若客户发了二维码图片可留空" :disabled="state.parsedConfirmed" />
          </div>

          <div class="form-group">
            <label class="form-label">PPT 主题</label>
            <input v-model="state.editFields.theme" class="form-input" placeholder="设计需求描述" :disabled="state.parsedConfirmed" />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">页数</label>
              <input v-model="state.editFields.pages" class="form-input" placeholder="页数" type="number" :disabled="state.parsedConfirmed" />
            </div>
            <div class="form-group">
              <label class="form-label">交付时间</label>
              <input v-model="state.editFields.deadline" class="form-input" placeholder="如: 明天、后天" :disabled="state.parsedConfirmed" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">备注</label>
            <input v-model="state.editFields.remark" class="form-input" placeholder="其他补充信息" :disabled="state.parsedConfirmed" />
          </div>

          <div class="parsed-actions">
            <button v-if="!state.parsedConfirmed" class="btn btn-secondary" @click="resetParsedResult">重新编辑</button>
            <button v-if="!state.parsedConfirmed" class="btn btn-primary" @click="confirmParsedResult">确认信息</button>
            <div v-else class="parsed-confirmed-badge">
              ✓ 信息已确认
              <button class="btn-link" @click="state.parsedConfirmed = false">修改</button>
            </div>
          </div>
        </template>

        <!-- 选择跟单客服建群 -->
        <div class="form-group section-divider">
          <label class="form-label">
            确认后台在线的跟单客服 <span style="color:red">*</span>
            <button class="btn-refresh-staff" @click="loadFollowStaff" :disabled="state.followStaffLoading" title="刷新列表">
              <svg :class="{ 'spin': state.followStaffLoading }" width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
          </label>
          <div class="staff-select-list" v-if="state.followStaffList.length > 0">
            <div
              v-for="staff in state.followStaffList"
              :key="staff.wecom_userid"
              class="staff-option"
              :class="{
                'selected': state.form.followStaffUID === staff.wecom_userid,
                'offline': !staff.is_online
              }"
              @click="state.form.followStaffUID = staff.wecom_userid"
            >
              <div class="staff-avatar">{{ staff.name.charAt(0) }}</div>
              <div class="staff-info">
                <div class="staff-name">{{ staff.name }}</div>
                <div class="staff-meta">
                  <span class="online-dot" :class="staff.is_online ? 'on' : 'off'"></span>
                  {{ staff.is_online ? '在线' : '离线' }}
                  <span v-if="staff.active_orders > 0" style="margin-left: 6px; color: #f59e0b;">{{ staff.active_orders }}单进行中</span>
                </div>
              </div>
              <svg v-if="state.form.followStaffUID === staff.wecom_userid" class="staff-check" width="18" height="18" fill="none" stroke="#10B981" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" /></svg>
            </div>
          </div>
          <div v-else-if="state.followStaffLoading" class="staff-empty">
            <div class="spinner" style="width: 18px; height: 18px; border-width: 2px; border-top-color: var(--accent);"></div>
            <span>加载中...</span>
          </div>
          <div v-else class="staff-empty">
            <span>暂无跟单客服，请联系管理员添加</span>
          </div>
        </div>

        <!-- 备注图片附件 -->
        <div class="form-group attachment-section" style="margin-bottom: 0; margin-top: 12px;"
             @mouseenter="state.mouseOverAttachment = true"
             @mouseleave="state.mouseOverAttachment = false">
          <label class="form-label">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="vertical-align: -2px; margin-right: 4px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
            备注图片 ({{ state.attachments.length }}/5)
            <span style="color: #94a3b8; font-weight: 400; margin-left: 6px;">在此区域粘贴客户二维码等图片</span>
          </label>
          <div class="attachment-zone" tabindex="0" @paste="handleAttachmentZonePaste">
            <!-- 已上传的图片缩略图 -->
            <div v-for="(att, idx) in state.attachments" :key="idx" class="attachment-thumb">
              <img :src="att.preview || att.url" class="attachment-img" />
              <button class="attachment-remove" @click="removeAttachment(idx)" title="删除">
                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <!-- 上传中 -->
            <div v-if="state.attachmentUploading" class="attachment-thumb attachment-loading">
              <div class="spinner" style="width: 20px; height: 20px; border-width: 2px; border-top-color: var(--accent);"></div>
            </div>
            <!-- 添加按钮 -->
            <div v-if="state.attachments.length < 5 && !state.attachmentUploading" class="attachment-add" @click="selectAttachmentFile">
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
            </div>
          </div>
          <div class="attachment-hint">按 <kbd>Ctrl+V</kbd> / <kbd>Cmd+V</kbd> 可直接粘贴图片</div>
        </div>
      </div>
      
      <button class="btn btn-primary" style="margin-top: 8px; padding: 14px;" @click="submit" :disabled="state.submitLoading">
        <span v-if="state.submitLoading" class="spinner"></span>
        <span v-else>🚀 一键提交工单并通知全员</span>
      </button>
    </div>
    
  </div>

    <!-- Toast -->
  <div class="toast" :class="[state.toastType, { 'show': state.showToast }]">
    {{ state.toastMsg }}
  </div>

  <!-- 图片放大弹窗 -->
  <div v-if="state.showPreviewModal" class="modal-overlay" ref="modalOverlayRef" @click="closePreviewIfNotDragged">
    <div class="modal-content" ref="modalContentRef" @click.stop>
      <img
        :src="state.previewUrl"
        class="modal-image"
        ref="zoomImageRef"
        :style="zoomImageStyle"
        @mousedown.prevent="startDrag"
      />
      <div class="zoom-indicator">{{ Math.round(zoomState.scale * 100) }}%</div>
      <button class="modal-close" @click.stop="state.showPreviewModal = false">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="24" height="24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
      <div class="zoom-hint" v-if="zoomState.scale === 1">滚轮缩放 · 拖拽移动</div>
    </div>
  </div>

  <!-- OTA 更新弹窗 -->
  <div v-if="state.showUpdateModal" class="modal-overlay">
    <div class="update-modal" @click.stop>
      <div class="update-header">
        <h2>🚀 发现新版本 {{ state.updateInfo?.version }}</h2>
      </div>
      <div class="update-body">
        <p class="update-subtitle">更新内容：</p>
        <pre class="update-notes">{{ state.updateInfo?.release_notes }}</pre>
      </div>
      <div class="update-footer">
        <button v-if="!state.updateInfo?.force_update" class="btn btn-secondary" @click="state.showUpdateModal = false">暂不更新</button>
        <a :href="state.updateInfo?.download_url" target="_blank" class="btn btn-primary" style="text-decoration:none; display:inline-block; text-align:center;">立即下载并覆盖</a>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 预览区相关样式 */
.preview-container {
  position: relative;
  width: 100%;
  max-height: 120px;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 8px;
  overflow: hidden;
  cursor: zoom-in;
}
.image-preview {
  max-width: 100%;
  max-height: 120px;
  object-fit: contain;
}
.zoom-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  color: white;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 14px;
  font-weight: 500;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.preview-container:hover .zoom-overlay {
  opacity: 1;
}

/* 放大弹窗样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
  backdrop-filter: blur(5px);
  cursor: zoom-out;
}
.modal-content {
  position: relative;
  max-width: 90%;
  max-height: 90%;
  display: flex;
  justify-content: center;
  align-items: center;
}
.modal-image {
  max-width: 100%;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  user-select: none;
  -webkit-user-drag: none;
}
.modal-close {
  position: absolute;
  top: -40px;
  right: -10px;
  background: none;
  border: none;
  color: white;
  font-size: 24px;
  cursor: pointer;
  padding: 10px;
}
.modal-close:hover {
  color: var(--accent);
}
.zoom-indicator {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.6);
  color: white;
  padding: 4px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  pointer-events: none;
  backdrop-filter: blur(4px);
  font-variant-numeric: tabular-nums;
}
.zoom-hint {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.5);
  color: rgba(255, 255, 255, 0.8);
  padding: 6px 16px;
  border-radius: 20px;
  font-size: 12px;
  pointer-events: none;
  white-space: nowrap;
  backdrop-filter: blur(4px);
}

/* 更新弹窗样式 */
.update-modal {
  background: white;
  width: 400px;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.3);
  overflow: hidden;
}
.update-header {
  background: linear-gradient(135deg, var(--accent), var(--accent-hover));
  padding: 16px 20px;
  color: white;
}
.update-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.update-body {
  padding: 20px;
}
.update-subtitle {
  margin: 0 0 10px 0;
  font-weight: 600;
  color: #333;
}
.update-notes {
  background: #f8fafc;
  padding: 12px;
  border-radius: 6px;
  margin: 0;
  font-size: 13px;
  color: #475569;
  white-space: pre-wrap;
  max-height: 150px;
  overflow-y: auto;
}
.update-footer {
  padding: 16px 20px;
  border-top: 1px solid #e2e8f0;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
/* 备注图片附件区域 */
.attachment-zone {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  min-height: 56px;
  align-items: center;
  transition: border-color 0.2s, background-color 0.2s;
  outline: none;
  cursor: pointer;
}
.attachment-zone:focus,
.attachment-zone:hover {
  border-color: var(--accent);
  border-style: solid;
  background: #f0fdf4;
}
.attachment-thumb {
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.attachment-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.attachment-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  background: rgba(239, 68, 68, 0.9);
  border: none;
  border-radius: 50%;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.attachment-thumb:hover .attachment-remove {
  opacity: 1;
}
.attachment-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f1f5f9;
}
.attachment-add {
  width: 56px;
  height: 56px;
  border-radius: 6px;
  border: 1px dashed #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #94a3b8;
  transition: all 0.15s ease;
  flex-shrink: 0;
}
.attachment-add:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(99, 102, 241, 0.05);
}
.attachment-hint {
  margin-top: 6px;
  font-size: 11px;
  color: #94a3b8;
}
.attachment-hint kbd {
  background: #e2e8f0;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 10px;
  font-family: inherit;
}

/* 跟单客服选择列表 */
.btn-refresh-staff {
  background: none;
  border: none;
  cursor: pointer;
  color: #94a3b8;
  padding: 2px;
  margin-left: 6px;
  vertical-align: -3px;
  transition: color 0.15s ease;
}
.btn-refresh-staff:hover {
  color: var(--accent);
}
.btn-refresh-staff:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.btn-refresh-staff .spin {
  animation: spin 0.8s linear infinite;
}
.staff-select-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 200px;
  overflow-y: auto;
}
.staff-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1.5px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  position: relative;
}
.staff-option:hover {
  border-color: var(--accent);
  background: rgba(99, 102, 241, 0.03);
}
.staff-option.selected {
  border-color: #10B981;
  background: rgba(16, 185, 129, 0.05);
}
.staff-option.offline {
  opacity: 0.55;
}
.staff-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--accent-hover));
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}
.staff-info {
  flex: 1;
  min-width: 0;
}
.staff-name {
  font-size: 14px;
  font-weight: 500;
  color: #1e293b;
}
.staff-meta {
  font-size: 12px;
  color: #94a3b8;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
}
.online-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}
.online-dot.on {
  background: #10B981;
  box-shadow: 0 0 4px rgba(16, 185, 129, 0.5);
}
.online-dot.off {
  background: #cbd5e1;
}
.staff-check {
  flex-shrink: 0;
}
.staff-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: #94a3b8;
  font-size: 13px;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px dashed #e2e8f0;
}

/* ═══ AI 解析 ═══ */
.btn-ai-parse {
  width: 100%;
  margin-top: 10px;
  padding: 12px;
  background: linear-gradient(135deg, #1A1A2E, #16213E);
  color: white;
  border: none;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.2s ease;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
}
.btn-ai-parse:hover:not(:disabled) {
  background: linear-gradient(135deg, #16213E, #0F3460);
  transform: translateY(-1px);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.2);
}
.btn-ai-parse:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.parsed-status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}
.parsed-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.3px;
}
.parsed-badge.high {
  background: rgba(7, 193, 96, 0.1);
  color: var(--accent);
  border: 1px solid rgba(7, 193, 96, 0.2);
}
.parsed-badge.medium {
  background: rgba(255, 152, 0, 0.1);
  color: #e68a00;
  border: 1px solid rgba(255, 152, 0, 0.2);
}
.parsed-badge.low {
  background: rgba(250, 81, 81, 0.1);
  color: var(--danger);
  border: 1px solid rgba(250, 81, 81, 0.15);
}
.parsed-cache-tag {
  font-size: 11px;
  color: var(--text-muted);
  padding: 3px 8px;
  background: var(--bg-input);
  border-radius: 10px;
}
.field-required {
  color: var(--danger);
  font-size: 12px;
  font-weight: 500;
}
.input-warning {
  border-color: var(--warning) !important;
  background: #FFFAF0 !important;
}
.parsed-actions {
  display: flex;
  gap: 10px;
  margin-top: 2px;
}
.parsed-actions .btn {
  flex: 1;
}
.parsed-confirmed-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1;
  padding: 10px;
  background: rgba(7, 193, 96, 0.08);
  color: var(--accent);
  border: 1px solid rgba(7, 193, 96, 0.15);
  border-radius: 24px;
  font-size: 14px;
  font-weight: 600;
}
.btn-link {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
  font-weight: 500;
}
.btn-link:hover {
  color: var(--text-primary);
  text-decoration: underline;
}

/* 区域分隔线 */
.section-divider {
  margin-top: 6px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}




</style>
