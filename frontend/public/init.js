/* eslint-disable */
// Early theme boot — prevents a light/dark flash before React mounts.
// (Service-worker registration lives in the Workbox build output injected
// by vite-plugin-pwa; a second hand-rolled register() here raced it.)
(function () {
  try {
    var t = localStorage.getItem("sn_theme");
    if (t === "light") document.documentElement.classList.add("light");
  } catch (e) {}
})();
