// Load saved profile picture on page load
window.addEventListener('DOMContentLoaded', () => {
  const savedPicture = localStorage.getItem('profilePicture');
  const profilePicture = document.getElementById('profilePicture');
  if (savedPicture && profilePicture) {
    profilePicture.src = savedPicture;
  }
});

// 显示错误提示并聚焦到指定元素
function showError(message, elementId) {
  // 使用自定义 Toast 而非 alert，避免阻塞
  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #ff4444;
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    z-index: 9999;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);

  // 重新聚焦到输入框
  if (elementId) {
    const element = document.getElementById(elementId);
    if (element) {
      element.focus();
      element.select(); // 选中文本方便用户重新输入
    }
  }
}

// Form submission handler
const loginForm = document.getElementById('loginForm');
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();

  // Get form data
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const email = emailInput.value;
  const password = passwordInput.value;

  // Validate form
  if (!email || !password) {
    showError('请填写邮箱和密码', email ? 'password' : 'email');
    return;
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showError('请输入有效的邮箱地址', 'email');
    return;
  }

  // Check if user exists in localStorage (in a real app, this would be a server request)
  const userData = localStorage.getItem('userData');
  if (userData) {
    const user = JSON.parse(userData);
    if (user.email === email && user.password === password) {
      // Email and password match

      // 显示成功提示
      const successToast = document.createElement('div');
      successToast.textContent = '登录成功！';
      successToast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #4CAF50;
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        z-index: 9999;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      `;
      document.body.appendChild(successToast);

      setTimeout(() => {
        successToast.remove();
        // Redirect to main page
        window.location.href = '../main/main.html';
      }, 1000);

      console.log('Login successful for:', email);
    } else {
      // 密码错误时清空密码框并聚焦
      passwordInput.value = '';
      showError('邮箱或密码错误', 'password');
    }
  } else {
    showError('未找到该账户，请先注册', null);
  }
});

// Back button handler
const backButton = document.getElementById('backButton');
backButton.addEventListener('click', () => {
  window.location.href = '../index.html';
});

// New Account button handler
const newAccountButton = document.getElementById('newAccountButton');
newAccountButton.addEventListener('click', () => {
  window.location.href = '../register/register.html';
});