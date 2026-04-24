<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';

// ══ 员工选择弹窗 ══
const showStaffDropdown = ref(false);
const isPinned = ref(false);
async function togglePin() {
  isPinned.value = !isPinned.value;
  try {
    await window.go.main.App.SetAlwaysOnTop(isPinned.value);
  } catch (e) {
    console.warn('SetAlwaysOnTop failed:', e);
  }
}
let staffPollTimer = null;

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

  // 后台每 30 秒静默刷新员工在线状态
  staffPollTimer = setInterval(() => {
    if (state.isLoggedIn) loadFollowStaff();
  }, 30000);

  // 恢复上次选择的员工
  const lastUID = localStorage.getItem('lastFollowStaffUID');
  if (lastUID) {
    state.form.followStaffUID = lastUID;
  }
});

onUnmounted(() => {
  document.removeEventListener('paste', handleGlobalPaste);
  if (staffPollTimer) clearInterval(staffPollTimer);
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

const selectStaff = (staff) => {
  state.form.followStaffUID = staff.wecom_userid;
  localStorage.setItem('lastFollowStaffUID', staff.wecom_userid);
  localStorage.setItem('lastFollowStaffName', staff.name);
  showStaffDropdown.value = false;
};

const selectedStaffName = computed(() => {
  const found = state.followStaffList.find(s => s.wecom_userid === state.form.followStaffUID);
  if (found) return found.name;
  return localStorage.getItem('lastFollowStaffName') || '选择员工';
});

const selectedStaffOnline = computed(() => {
  const found = state.followStaffList.find(s => s.wecom_userid === state.form.followStaffUID);
  return found ? found.is_online : false;
});

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
  <!-- 顶部拖拽区 -->
  <div class="drag-bar"></div>

  <div class="app-container">

    <!-- ═══ 登录页 ═══ -->
    <div v-if="!state.isLoggedIn" class="login-page">
      <div class="login-logo">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      </div>
      <h1 class="login-title">单管家</h1>
      <div class="login-subtitle">客服坐席专用高频效能终端</div>
      <div class="login-form">
        <div class="form-group">
          <label class="form-label">设备激活码 (首次需要)</label>
          <input v-model="state.activationCode" type="password" class="form-input" placeholder="请输入激活码..." @keyup.enter="handleLogin" />
          <div v-if="state.loginError" class="login-error">{{ state.loginError }}</div>
        </div>
        <button class="btn btn-primary" style="width:100%;padding:12px;" @click="handleLogin" :disabled="state.loginLoading">
          <span v-if="state.loginLoading" class="spinner"></span>
          <span v-else>设备安全登录</span>
        </button>
      </div>
      <div class="login-mac">MAC: {{ state.macAddress }}<br/>由系统自动绑定识别，防窃取代签</div>
    </div>

    <!-- ═══ 主界面 ═══ -->
    <div v-else>

      <!-- 顶栏 -->
      <div class="top-bar">
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="top-bar-brand">单管家</span>
          <button class="btn-pin" :class="{pinned: isPinned}" @click="togglePin" :title="isPinned ? '取消置顶' : '窗口置顶'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" :stroke="isPinned ? 'var(--accent)' : 'currentColor'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
          </button>
        </div>
        <div class="top-bar-right">
          <div class="top-bar-user">
            <div class="top-bar-avatar">{{ state.empName.charAt(0) }}</div>
            <span class="top-bar-name">{{ state.empName }}</span>
          </div>
          <button class="btn-logout-top" @click="handleLogout">退出</button>
        </div>
      </div>

      <!-- ═══ 模块一：图片卡片（左 OCR + 右 二维码） ═══ -->
      <div class="module-card card-image">

        <!-- 订单信息行（OCR 完成后显示） -->
        <div v-if="state.priceLocked || state.orderSn" class="order-info-row">
          <div class="ticket-order-sn">
            <span v-if="state.priceLocked" class="lock-icon">🔒</span>
            <span class="sn-text">{{ state.orderSn || '—' }}</span>
          </div>
          <div class="ticket-price-row">
            <span class="ticket-price">¥{{ state.rawPrice || '0.00' }}</span>
            <button class="btn-reset-ocr" @click="resetOCR" title="重新选择">
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
          </div>
        </div>

        <!-- 两栏图片区 -->
        <div class="image-slots">
          <!-- 左：OCR 截图 -->
          <div class="img-slot ocr-slot" :class="{'has-image': state.previewUrl}" @click="state.previewUrl ? (state.showPreviewModal = true) : triggerGoFileSelect()">
            <div class="slot-content">
              <img v-if="state.previewUrl" :src="state.previewUrl" />
              <div v-else-if="state.uploading"><div class="spinner" style="width:20px;height:20px;border-width:2px;"></div></div>
              <template v-else>
                <div class="slot-placeholder-icon"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg></div>
                <div class="slot-placeholder-text">点击或粘贴<br/>订单截图</div>
              </template>
            </div>
            <button v-if="state.previewUrl" class="slot-close" @click.stop="resetOCR">✕</button>
          </div>

          <!-- 右：客户二维码 / 附件 -->
          <div class="img-slot qr-slot" :class="{'has-image': state.attachments.length > 0}"
               @click="selectAttachmentFile"
               @paste.stop="handleAttachmentZonePaste"
               @mouseenter="state.mouseOverAttachment = true"
               @mouseleave="state.mouseOverAttachment = false"
               tabindex="0">
            <div class="slot-content">
              <template v-if="state.attachments.length > 0">
                <div class="qr-thumbs">
                  <div v-for="(att, idx) in state.attachments" :key="idx" class="qr-thumb-item">
                    <img :src="att.preview || att.url" />
                    <button class="qr-remove" @click.stop="removeAttachment(idx)">✕</button>
                  </div>
                  <button v-if="state.attachments.length < 5" class="qr-add" @click.stop="selectAttachmentFile">+</button>
                </div>
              </template>
              <div v-else-if="state.attachmentUploading"><div class="spinner" style="width:20px;height:20px;border-width:2px;"></div></div>
              <template v-else>
                <div class="slot-placeholder-icon"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg></div>
                <div class="slot-placeholder-text">点击或粘贴<br/>客户二维码</div>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ 模块二：需求信息卡片（两态切换） ═══ -->
      <div class="module-card card-info">

        <!-- ━━ 状态 B：AI 提取完成 → 结构化表单 ━━ -->
        <template v-if="state.parsedResult">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
            <span style="font-size:16px;font-weight:700;color:var(--text-primary);display:inline-flex;align-items:center;gap:7px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>需求信息</span>
            <button class="btn-edit-link" @click="resetParsedResult">重新录入</button>
          </div>

          <div class="form-row-labeled">
            <span class="inline-label">主题</span>
            <input v-model="state.editFields.theme" class="form-input" placeholder="设计需求描述" :disabled="state.parsedConfirmed" />
          </div>

          <div class="form-row" style="margin-top:12px;">
            <div class="form-row-labeled">
              <span class="inline-label">页数</span>
              <input v-model="state.editFields.pages" class="form-input" placeholder="页数" type="number" :disabled="state.parsedConfirmed" />
            </div>
            <div class="form-row-labeled">
              <span class="inline-label">交付</span>
              <input v-model="state.editFields.deadline" class="form-input" placeholder="交付时间" :disabled="state.parsedConfirmed" />
            </div>
          </div>
          <div v-if="state.editFields.remark || !state.parsedConfirmed" class="form-row-labeled" style="margin-top:12px;">
            <span class="inline-label">备注</span>
            <textarea v-model="state.editFields.remark" class="form-input" style="resize:vertical;min-height:32px;font-size:13px;line-height:1.5;" rows="1" placeholder="其他补充信息" :disabled="state.parsedConfirmed"></textarea>
          </div>

          <div v-if="!state.parsedConfirmed" style="margin-top:16px;">
            <button class="btn btn-primary" style="width:100%;padding:10px;" @click="confirmParsedResult">✓ 确认信息</button>
          </div>
          <div v-else class="confirmed-badge">✓ 信息已确认 <button class="btn-edit-link" style="margin-left:8px;" @click="state.parsedConfirmed = false">修改</button></div>
        </template>

        <!-- ━━ 状态 A：未提取 → 文本输入 + AI 按钮 ━━ -->
        <template v-else>
          <div class="section-title" style="margin-bottom:8px;display:flex;align-items:center;gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M7 11h10"/><path d="M7 15h6"/><path d="M7 7h8"/></svg>订单备注</div>
          <textarea v-model="state.noteText" class="form-textarea" rows="3" placeholder="粘贴客户沟通内容，AI 自动提取结构化信息" @paste="handleAttachmentPaste"></textarea>
          <button class="btn-ai-parse" @click="handleParseText" :disabled="state.parseLoading || !state.noteText.trim()">
            <span v-if="state.parseLoading" class="spinner" style="width:14px;height:14px;border-width:2px;border-top-color:#fff;"></span>
            {{ state.parseLoading ? 'AI 正在识别...' : '✦ AI 智能提取' }}
          </button>
        </template>

      </div>

      <!-- 底栏：员工选择 + 提交按钮（始终可见） -->
      <div class="ticket-bottom-bar">
        <div class="staff-pill" @click="showStaffDropdown = !showStaffDropdown">
          <span class="dot" :style="{ background: selectedStaffOnline ? 'var(--accent)' : '#D1D5DB' }"></span>
          <span>{{ selectedStaffName }}</span>
          <span class="arrow">▾</span>
        </div>
        <button class="btn-submit" @click="submit" :disabled="state.submitLoading">
          <span v-if="state.submitLoading" class="spinner" style="border-top-color:#fff;width:16px;height:16px;border-width:2px;"></span>
          <template v-else>✓ 提交工单</template>
        </button>
      </div>

      <!-- 员工选择弹窗 -->
      <div v-if="showStaffDropdown" class="dropdown-overlay" @click="showStaffDropdown = false"></div>
      <div v-if="showStaffDropdown" class="staff-dropdown">
        <div v-for="staff in state.followStaffList" :key="staff.wecom_userid"
             class="staff-option" :class="{ selected: state.form.followStaffUID === staff.wecom_userid, offline: !staff.is_online }"
             @click="selectStaff(staff)">
          <div class="staff-avatar">{{ staff.name.charAt(0) }}</div>
          <div class="staff-info">
            <div class="staff-name">{{ staff.name }}</div>
            <div class="staff-meta">
              <span class="online-dot" :class="staff.is_online ? 'on' : 'off'"></span>
              {{ staff.is_online ? '在线' : '离线' }}
              <span v-if="staff.active_orders > 0" style="margin-left:6px;color:#f59e0b;">{{ staff.active_orders }}单</span>
            </div>
          </div>
          <svg v-if="state.form.followStaffUID === staff.wecom_userid" class="staff-check" width="18" height="18" fill="none" stroke="#16A34A" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
        </div>
        <div v-if="state.followStaffList.length === 0" class="staff-option" style="justify-content:center;color:var(--text-muted);">
          {{ state.followStaffLoading ? '加载中...' : '暂无跟单客服' }}
        </div>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div class="toast" :class="[state.toastType, { 'show': state.showToast }]">{{ state.toastMsg }}</div>

  <!-- 图片放大弹窗 -->
  <div v-if="state.showPreviewModal" class="modal-overlay" ref="modalOverlayRef" @click="closePreviewIfNotDragged">
    <div class="modal-content" ref="modalContentRef" @click.stop>
      <img :src="state.previewUrl" class="modal-image" ref="zoomImageRef" :style="zoomImageStyle" @mousedown.prevent="startDrag" />
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
      <div class="update-header"><h2>🚀 发现新版本 {{ state.updateInfo?.version }}</h2></div>
      <div class="update-body">
        <p class="update-subtitle">更新内容：</p>
        <pre class="update-notes">{{ state.updateInfo?.release_notes }}</pre>
      </div>
      <div class="update-footer">
        <button v-if="!state.updateInfo?.force_update" class="btn btn-secondary" @click="state.showUpdateModal = false">暂不更新</button>
        <a :href="state.updateInfo?.download_url" target="_blank" class="btn btn-primary" style="text-decoration:none;text-align:center;">立即下载</a>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 固定底栏 — 始终吸附在窗口底部 */
.ticket-bottom-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: var(--bg-card);
  border-top: 1px solid var(--border);
  z-index: 90;
  box-shadow: 0 -2px 10px rgba(0,0,0,0.04);
}
</style>
