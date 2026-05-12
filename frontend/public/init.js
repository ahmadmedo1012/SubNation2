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
    var fontLink = document.getElementById("font-stylesheet");
    if (fontLink) {
      fontLink.addEventListener("load", function() {
        this.rel = "stylesheet";
      });
      // Fallback in case it's already loaded or cached
      setTimeout(function() {
        if (fontLink.rel !== "stylesheet") fontLink.rel = "stylesheet";
      }, 500);
    }
    
    var t = localStorage.getItem("sn_theme");
    if (t === "light") document.documentElement.classList.add("light");
  } catch (e) {}
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  });
}
