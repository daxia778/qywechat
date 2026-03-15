<script setup>
import { ref, reactive, onMounted } from 'vue';

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
  priceLocked: false,
  uploading: false,
  
  form: {
    customerContact: '',
    topic: '',
    pages: '',
    deadline: '',
    remark: ''
  },
  
  submitLoading: false,
  toastMsg: '',
  toastType: 'success',
  showToast: false
});

// ══ 初始化 ══
onMounted(async () => {
  try {
    state.macAddress = await window.go.main.App.GetMacAddress();
  } catch (e) {
    console.error("未能获取MAC地址", e);
  }
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

// ══ 功能 ══
const handleLogin = async () => {
  if (!state.activationCode.trim()) {
    state.loginError = '请输入激活码';
    return;
  }
  
  state.loginLoading = true;
  state.loginError = '';
  
  try {
    const res = await window.go.main.App.DeviceLogin(state.activationCode);
    if (res.success) {
      state.isLoggedIn = true;
      state.empName = res.name;
      state.wecomUid = res.wecom_uid;
      showToast('设备登录成功');
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
    
    state.uploading = true;
    showToast('正在通过大模型进行OCR图文解析...', 'success');
    
    const res = await window.go.main.App.UploadScreenshot(filePath);
    
    if (res.error) {
       showToast(res.error, 'error');
    } else {
       state.orderSn = res.order_sn;
       state.price = res.price;
       state.rawPrice = res.raw_price || (res.price / 100).toFixed(2);
       state.priceLocked = true;
       showToast('OCR 解析成功，金额已锁定');
    }
  } catch (err) {
    showToast('文件处理失败: ' + err, 'error');
  } finally {
    state.uploading = false;
  }
};

const submit = async () => {
  if (!state.priceLocked || !state.orderSn) {
    showToast('请先上传订单截图进行 OCR 解析锁定单价', 'error');
    return;
  }
  if (!state.form.customerContact || !state.form.topic) {
    showToast('请填写必填项(微信号/主题)', 'error');
    return;
  }
  
  state.submitLoading = true;
  
  try {
    const res = await window.go.main.App.SubmitOrder(
      state.orderSn,
      state.form.customerContact,
      state.form.topic,
      state.form.remark,
      state.form.deadline,
      state.price,
      parseInt(state.form.pages) || 0
    );
    
    if (res.success) {
      showToast('下单成功！订单已进入派单池');
      // 清空表单
      state.orderSn = '';
      state.price = null;
      state.rawPrice = '';
      state.priceLocked = false;
      state.form = { customerContact: '', topic: '', pages: '', deadline: '', remark: '' };
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
  <div class="drag-bar"></div>
  
  <div class="app-container">
    
    <!-- 登录页 -->
    <div v-if="!state.isLoggedIn" class="login-page">
      <div class="login-logo">🚀</div>
      <h1 class="login-title">PDD 派单助手</h1>
      <div class="login-subtitle">客服端专用系统</div>
      
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
      <div class="user-bar">
        <div class="user-info">
          <div class="user-avatar">{{ state.empName.charAt(0) }}</div>
          <div>
            <div class="user-name">{{ state.empName }}</div>
            <div class="user-role">客服坐席 (企微: {{ state.wecomUid }})</div>
          </div>
        </div>
        <div class="online-dot"></div>
      </div>
      
      <div class="app-header">
        <h1>新建派单</h1>
      </div>

      <!-- OCR 上传 -->
      <div class="card">
        <div class="card-title">1. 订单防伪截图 (PDD截图)</div>
        <div 
          class="upload-zone" 
          :class="{'has-file': state.priceLocked}"
          @click="triggerGoFileSelect"
        >
          <div v-if="state.uploading" class="spinner" style="border-top-color: var(--accent); margin-bottom: 10px;"></div>
          <div v-else class="upload-icon">📸</div>
          
          <div v-if="state.priceLocked" class="upload-text" style="color: var(--success)">
            OCR 解析成功 (单号: {{ state.orderSn }})
          </div>
          <div v-else class="upload-text">点击选择或拖拽截图上传</div>
          <div class="upload-hint">系统将自动提取价格并防篡改锁定</div>
        </div>
        
        <div class="form-row" style="margin-top: 12px;" v-if="state.priceLocked">
          <div class="form-group">
            <label class="form-label">锁定金额 (¥)</label>
            <input :value="state.rawPrice" class="form-input locked" readonly disabled />
          </div>
          <div class="form-group">
            <label class="form-label">防伪验证</label>
            <div style="padding: 10px 0;">
              <span class="status-badge success">✅ 智谱 AI 校验通过</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 需求信息 -->
      <div class="card">
        <div class="card-title">2. 顾客与需求信息</div>
        <div class="form-group">
          <label class="form-label">顾客微信号 / 手机号 <span style="color:red">*</span></label>
          <input v-model="state.form.customerContact" class="form-input" placeholder="输入顾客联系方式用于企微建群" />
        </div>
        
        <div class="form-group">
          <label class="form-label">PPT 主题 <span style="color:red">*</span></label>
          <input v-model="state.form.topic" class="form-input" placeholder="例如：某市第一季度政务汇报PPT" />
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">大约页数</label>
            <input v-model="state.form.pages" type="number" class="form-input" placeholder="0" />
          </div>
          <div class="form-group">
            <label class="form-label">交付时间</label>
            <input v-model="state.form.deadline" type="datetime-local" class="form-input" />
          </div>
        </div>
        
        <div class="form-group" style="margin-bottom: 0;">
          <label class="form-label">特殊备注 (直达设计师)</label>
          <textarea v-model="state.form.remark" class="form-textarea" placeholder="例如: 偏好深蓝色，不要套模板，极简风"></textarea>
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
</template>

<style scoped>
/* Scoped overrides if needed */
</style>
