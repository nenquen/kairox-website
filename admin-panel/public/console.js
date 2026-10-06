(function () {
  var pre = document.querySelector('pre.con');
  if (!pre) return;
  var form = document.querySelector('form[action="/console/send"]');
  var input = form ? form.querySelector('input[name=cmd]') : document.querySelector('input[name=cmd]');
  var csrf = form ? form.querySelector('input[name=csrf]') : null;
  async function tick() {
    try {
      var atBottom = (pre.scrollHeight - pre.scrollTop - pre.clientHeight) < 60;
      var r = await fetch('/logtail', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return;
      var t = await r.text();
      if (t !== pre.textContent) {
        pre.textContent = t;
        if (atBottom) pre.scrollTop = pre.scrollHeight;
      }
    } catch (e) {}
  }
  var timer = setInterval(tick, 2000);
  if (form && input) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var cmd = input.value.trim();
      if (!cmd || !csrf) return;
      var body = 'csrf=' + encodeURIComponent(csrf.value) + '&cmd=' + encodeURIComponent(cmd);
      fetch('/console/send', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body, credentials: 'same-origin' })
        .then(function () { input.value = ''; input.focus(); setTimeout(tick, 800); })
        .catch(function () { form.submit(); });
    });
  }
  pre.scrollTop = pre.scrollHeight;
  tick();
})();
