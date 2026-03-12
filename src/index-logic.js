/**
 * 登录状态检查脚本
 * 检查 localStorage 中的用户数据，显示相应的 UI 状态
 */
document.addEventListener('DOMContentLoaded', () => {
  const userData = localStorage.getItem('userData');
  const profilePicture = localStorage.getItem('profilePicture');
  const loggedOutActions = document.getElementById('loggedOutActions');
  const loggedInActions = document.getElementById('loggedInActions');

  if (userData) {
    try {
      const user = JSON.parse(userData);
      // 已登录：显示用户信息
      loggedOutActions.style.display = 'none';
      loggedInActions.style.display = 'block';

      // 设置用户名
      const userNameEl = document.getElementById('userName');
      if (userNameEl) {
        userNameEl.textContent = user.name || user.email || '用户';
      }

      // 设置头像
      const userAvatarEl = document.getElementById('userAvatar');
      if (userAvatarEl && profilePicture) {
        userAvatarEl.src = profilePicture;
      }

      // 退出登录按钮
      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
          localStorage.removeItem('userData');
          localStorage.removeItem('profilePicture');
          location.reload();
        });
      }
    } catch (e) {
      console.error('解析用户数据失败:', e);
    }
  }
});