(() => {
  if (window.studioAuthInstalled) return;
  window.studioAuthInstalled = true;
  const key = 'studio-session';
  const nativeFetch = window.studioNativeFetch || window.fetch.bind(window);
  window.studioNativeFetch = nativeFetch;
  const fragment = new URLSearchParams(location.hash.slice(1));
  const bootstrap = fragment.get('studio_bootstrap');
  const anchor = fragment.get('anchor') || '';
  if (bootstrap) history.replaceState(null, '', location.pathname + location.search + (anchor ? '#' + anchor : ''));
  const ready = (async () => {
    if (bootstrap) {
      const response = await nativeFetch('/api/studio/session', {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({bootstrap}), redirect:'error'});
      if (!response.ok) throw Error('Open Studio from its desktop app or run studio open.');
      sessionStorage.setItem(key, (await response.json()).session);
    }
  })();
  window.fetch = async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    if (url.origin !== location.origin) return nativeFetch(input, options);
    await ready;
    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
    const token = sessionStorage.getItem(key);
    if (token) headers.set('X-Studio-Session', token);
    const method = (options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') headers.set('X-Studio-Action', '1');
    // Never forward Studio authority across a redirect, even to another local port.
    return nativeFetch(input, {...options, headers, redirect:'error', cache:'no-store'});
  };
  const isAction = path => path === '/stop-all' || /^\/(apps|services)\/[^/]+\/(open|stop)$/.test(path) || /^\/apps\/[^/]+\/folder$/.test(path) || /^\/links\/[^/]+\/open$/.test(path);
  window.studioAction = async (input, target = '_self') => {
    const url = new URL(input, location.href);
    if (url.origin !== location.origin || !isAction(url.pathname)) throw Error('Invalid Studio action.');
    if (navigator.userAgent.includes('ProjectStudioNative')) target = '_self';
    const destination = target === '_self' ? window : window.open('/studio-window', target);
    try {
      const response = await fetch(url.href, {method:'POST'});
      if (!response.ok) throw Error('Please reopen Studio and try again.');
      const body = await response.text();
      const win = destination || window;
      if (win !== window) {
        await new Promise((resolve, reject) => {
          const deadline = Date.now() + 8000;
          const check = () => {
            try { if (win.location.pathname === '/studio-window' && win.document.readyState === 'complete') { resolve(); return; } } catch (_) {}
            if (Date.now() > deadline || win.closed) { reject(Error('The app window could not open. Try again in Studio.')); return; }
            setTimeout(check, 25);
          };
          check();
        });
      }
      const currentSession = sessionStorage.getItem(key);
      if (currentSession) win.sessionStorage.setItem(key, currentSession);
      win.history.replaceState(null, '', url.pathname + url.search);
      win.studioAuthInstalled = false;
      win.document.open(); win.document.write(body); win.document.close();
      win.focus();
    } catch (error) {
      if (destination && destination !== window) destination.close();
      alert(error.message);
    }
  };
  document.addEventListener('click', event => {
    const control = event.target.closest('[data-studio-action],a[href]');
    if (!control) return;
    const url = new URL(control.dataset.studioAction || control.href, location.href);
    if (url.origin !== location.origin) return;
    if (!isAction(url.pathname)) {
      if (control.target === '_blank') {
        event.preventDefault();
        if (navigator.userAgent.includes('ProjectStudioNative')) { location.href = url.href; return; }
        const win = window.open('about:blank', '_blank');
        if (win) {
          const token = sessionStorage.getItem(key);
          if (token) win.sessionStorage.setItem(key, token);
          win.opener = null;
          win.location.href = url.href;
        }
      }
      return;
    }
    // Existing card handlers own their selection/version/capture behavior.
    if (control.hasAttribute('data-launch-control')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    window.studioAction(url.href, control.target || '_self');
  }, true);
  const load = async () => {
    if (!document.body.hasAttribute('data-studio-load')) return;
    try {
      await ready;
      if (!sessionStorage.getItem(key)) throw Error('Open Studio from its desktop app, or run studio open in your terminal.');
      const response = await fetch(location.pathname + location.search);
      if (!response.ok) { sessionStorage.removeItem(key); throw Error('Your Studio session expired. Reopen the desktop app or run studio open.'); }
      const body = await response.text();
      window.studioAuthInstalled = false;
      document.open(); document.write(body); document.close();
    } catch (error) { document.getElementById('studio-unlock').textContent = error.message; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load, {once:true}); else load();
})();
