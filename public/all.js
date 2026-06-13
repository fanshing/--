// Thin bootstrap to keep backward compatibility with older clients that load /all.js
// and to avoid duplicating the main game logic.
//
// It dynamically loads /client.js with a cache-busting query so browsers don't keep
// running an old broken bundle.
(function () {
  try {
    var script = document.createElement('script');
    script.src = '/client.js?v=20260114';
    script.async = false;
    script.onerror = function () {
      var el = document.getElementById('status');
      if (el) el.textContent = '脚本加载失败：client.js（可尝试 Ctrl+F5 强刷）';
    };
    document.head.appendChild(script);
  } catch (e) {
    var el2 = document.getElementById('status');
    if (el2) el2.textContent = '脚本初始化失败（可尝试 Ctrl+F5 强刷）';
  }
})();
