// Profile Picture Upload
const profilePicture = document.getElementById('profilePicture');
const uploadButton = document.getElementById('uploadButton');
const deleteButton = document.getElementById('deleteButton');
const fileInput = document.getElementById('fileInput');

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

// Upload button click handler
uploadButton.addEventListener('click', () => {
  fileInput.click();
});

// File input change handler
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        profilePicture.src = event.target.result;
        // Store the image data in localStorage for persistence
        localStorage.setItem('profilePicture', event.target.result);
      };
      reader.readAsDataURL(file);
    } else {
      showError('请选择图片文件', null);
    }
  }
});

// Delete button click handler
deleteButton.addEventListener('click', () => {
  if (confirm('确定要删除头像吗？')) {
    profilePicture.src = 'https://via.placeholder.com/120/cccccc/666666?text=头像';
    localStorage.removeItem('profilePicture');
    fileInput.value = '';
  }
});

// Load saved profile picture on page load
window.addEventListener('DOMContentLoaded', () => {
  const savedPicture = localStorage.getItem('profilePicture');
  if (savedPicture) {
    profilePicture.src = savedPicture;
  }
});

// Form submission handler
const registerForm = document.getElementById('registerForm');
registerForm.addEventListener('submit', (e) => {
  e.preventDefault();

  // Get form data
  const formData = {
    username: document.getElementById('username').value,
    identity: document.getElementById('identity').value,
    field: document.getElementById('field').value,
    birthday: document.getElementById('birthday').value,
    email: document.getElementById('email').value,
    password: document.getElementById('password').value,
    profilePicture: profilePicture.src
  };

  // Validate form - 检查必填字段
  if (!formData.username) {
    showError('请填写用户名', 'username');
    return;
  }
  if (!formData.identity) {
    showError('请选择您的身份', 'identity');
    return;
  }
  if (!formData.field) {
    showError('请选择学科领域', 'field');
    return;
  }
  if (!formData.birthday) {
    showError('请选择生日', 'birthday');
    return;
  }
  if (!formData.email) {
    showError('请填写邮箱', 'email');
    return;
  }
  if (!formData.password) {
    showError('请填写密码', 'password');
    return;
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(formData.email)) {
    showError('请输入有效的邮箱地址', 'email');
    return;
  }

  // Password validation
  if (formData.password.length < 6) {
    showError('密码长度不能少于 6 位', 'password');
    return;
  }

  // Save to localStorage (in a real app, this would be sent to a server)
  localStorage.setItem('userData', JSON.stringify(formData));

  // 显示成功提示
  const successToast = document.createElement('div');
  successToast.textContent = '注册成功！';
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

  console.log('Registration data:', formData);
});

// Back button handler
const backButton = document.getElementById('backButton');
backButton.addEventListener('click', () => {
  window.location.href = '../index.html';
});

// Cancel button handler
const cancelButton = document.getElementById('cancelButton');
cancelButton.addEventListener('click', () => {
  if (confirm('确定要取消注册吗？未保存的数据将丢失。')) {
    window.location.href = '../index.html';
  }
});

// Date input formatting (for better UX)
const birthdayInput = document.getElementById('birthday');
const today = new Date();
const maxDate = new Date(today.getFullYear(), today.getMonth(), today.getDate()); // At least 13 years old
const minDate = new Date(today.getFullYear() - 100, today.getMonth(), today.getDate()); // Max 100 years old

birthdayInput.setAttribute('max', maxDate.toISOString().split('T')[0]);
birthdayInput.setAttribute('min', minDate.toISOString().split('T')[0]);
