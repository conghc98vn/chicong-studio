// Keep this entry independent of the module graph: a failed import must be visible.
(() => {
 const status=document.getElementById('startup-status');
 const root=document.getElementById('root');
 const message=status.querySelector('[data-startup-message]');
 const retry=status.querySelector('[data-startup-retry]');
 retry.addEventListener('click',()=>location.reload());
 const show=text=>{message.textContent=text;retry.hidden=false;};
 const timer=setTimeout(()=>show('Giao diện đang tải lâu hơn dự kiến. Bạn có thể chờ thêm hoặc tải lại trang.'),8000);
 import('./main.js').then(app=>app.ready).then(()=>{
  clearTimeout(timer);
  root.hidden=false;
  status.remove();
 }).catch(error=>{
  clearTimeout(timer);
  console.error('Website startup failed:',error);
  status.querySelector('.loader').hidden=true;
  show('Chưa tải được giao diện. Vui lòng kiểm tra kết nối rồi tải lại trang.');
 });
})();
