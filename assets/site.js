// Sign-up: posts to Kit without leaving the page, and falls back to a normal form post.
(function () {
  // Wide words (M, W) can run past the column: shrink to fit.
  var word = document.querySelector(".keyword");
  function fit() {
    word.style.fontSize = "";
    if (word.scrollWidth > word.clientWidth) {
      word.style.fontSize = (parseFloat(getComputedStyle(word).fontSize) * word.clientWidth / word.scrollWidth) + "px";
    }
  }
  if (word) { document.fonts.ready.then(fit); window.addEventListener("resize", fit); }

  var form = document.getElementById("signup");
  if (form && form.dataset.state === "live") {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = form.querySelector("button");
      btn.disabled = true;
      fetch(form.action, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.status !== "success") throw new Error(j.status);
          form.hidden = true;
          document.getElementById("done").hidden = false;
        })
        .catch(function () { btn.disabled = false; form.submit(); });
    });
  }
  document.querySelectorAll(".code").forEach(function (block) {
    if (!navigator.clipboard) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "copy";
    b.textContent = "Copy";
    b.addEventListener("click", function () {
      navigator.clipboard.writeText(block.querySelector("code").textContent).then(function () {
        b.textContent = "Copied";
        setTimeout(function () { b.textContent = "Copy"; }, 1500);
      });
    });
    block.appendChild(b);
  });
})();
