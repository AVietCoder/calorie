
(function () {
  try {
    var token = localStorage.getItem("calorie_ai_token");
    if (!token) return;

    function inject() {
      var nav = document.querySelector(".side-nav");
      if (!nav || nav.querySelector("[data-admin-link]")) return;
      var el = document.createElement("div");
      el.className = "nav-item";
      el.setAttribute("data-admin-link", "1");
      el.setAttribute("title", "Quản trị tài liệu RAG");
      el.onclick = function () { location.href = "admin.html"; };
      el.innerHTML = '<i class="fa-solid fa-shield-halved"></i><span>ADMIN</span>';
      nav.appendChild(el);
    }

    var cached = sessionStorage.getItem("calorie_is_admin");
    if (cached === "true") { inject(); return; }
    if (cached === "false") return;

    fetch("/api/admin?action=whoami", { headers: { Authorization: "Bearer " + token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var isAdmin = !!(d && d.isAdmin);
        sessionStorage.setItem("calorie_is_admin", isAdmin ? "true" : "false");
        if (isAdmin) inject();
      })
      .catch(function () {});
  } catch (e) {}
})();
