/* Transfado — persistent, non-dismissible SANDBOX notice on every page.
   Self-contained (no dependencies) so it can be included on any page. */
(function () {
  function inject() {
    if (!document.body || document.getElementById('tf-demo-banner')) return;
    var H = '36px';
    var style = document.createElement('style');
    style.textContent =
      'body{padding-top:' + H + ' !important;}' +
      '#tf-demo-banner{position:fixed;top:0;left:0;right:0;height:' + H + ';z-index:100000;' +
      'display:flex;align-items:center;justify-content:center;gap:8px;' +
      'background:linear-gradient(90deg,#FBBF24,#F59E0B);color:#1c1400;' +
      'font-family:Inter,system-ui,sans-serif;font-size:12.5px;font-weight:600;line-height:1.2;' +
      'padding:0 14px;text-align:center;box-shadow:0 1px 6px rgba(0,0,0,.25);}' +
      '#tf-demo-banner svg{width:15px;height:15px;flex:none}' +
      '#tf-demo-banner b{font-weight:700}' +
      '#tf-demo-banner .tf-bn-sub{opacity:.85;font-weight:600}' +
      /* push sticky chrome below the banner so nothing is hidden */
      '.topbar,.nav,.legal-nav,.doc-nav{top:' + H + ' !important;}' +
      '.sidebar{top:' + H + ' !important;height:calc(100vh - ' + H + ') !important;}' +
      '@media (max-width:560px){#tf-demo-banner .tf-bn-sub{display:none}}';
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'tf-demo-banner';
    bar.setAttribute('role', 'alert');
    bar.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' +
      '<span><b>Demo / sandbox</b> — do not enter real card numbers. <span class="tf-bn-sub">No real payments are processed.</span></span>';
    document.body.insertBefore(bar, document.body.firstChild);
  }
  if (document.body) inject();
  else document.addEventListener('DOMContentLoaded', inject);
})();
