(function () {
  if (!window.clay || window.clay.platform !== 'win32') {
    document.write('<script src="vendor/grapes.min.js"><\/script>');
    return;
  }

  let pending = null;
  window.ClayEditorRuntime = {
    load() {
      if (window.grapesjs) return Promise.resolve();
      if (pending) return pending;
      pending = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'vendor/grapes.min.js';
        script.async = true;
        const timeout = setTimeout(() => finish(new Error('Editor runtime timed out')), 15000);
        function finish(error) {
          clearTimeout(timeout);
          script.onload = null;
          script.onerror = null;
          if (error) {
            script.remove();
            pending = null;
            reject(error);
          } else {
            resolve();
          }
        }
        script.onload = () => finish(window.grapesjs ? null : new Error('Editor runtime is unavailable'));
        script.onerror = () => finish(new Error('Unable to load the local editor runtime'));
        document.head.appendChild(script);
      });
      return pending;
    },
  };
})();
