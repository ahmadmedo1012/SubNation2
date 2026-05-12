/* eslint-disable */
if (window.trustedTypes && trustedTypes.createPolicy) {
  try {
    trustedTypes.createPolicy("default", {
      createHTML: function (string) {
        return string;
      },
      createScriptURL: function (string) {
        return string;
      },
      createScript: function (string) {
        return string;
      },
    });
  } catch (e) {
    // Policy might already exist
  }
}

(function () {
  try {
    var t = localStorage.getItem("sn_theme");
    if (t === "light") document.documentElement.classList.add("light");
  } catch (e) {}
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  });
}
