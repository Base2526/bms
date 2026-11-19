(function () {
  const { applyAppLanguage, getAppLanguage, posText } = window.bmsPosLocale;

  /** Capture only authored local HTML, before any server/device data is rendered. */
  window.initializePosLanguage = function () {
    const originals = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    );
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (
        /[ก-๙]/.test(node.textContent) &&
        !node.parentElement.closest("script,select")
      ) {
        originals.push([node, node.textContent]);
      }
    }
    const attributes = [];
    for (const node of document.querySelectorAll(
      "[aria-label],[title],[placeholder]"
    )) {
      for (const key of ["aria-label", "title", "placeholder"]) {
        const source = node.getAttribute(key);
        if (source && /[ก-๙]/.test(source))
          attributes.push([node, key, source]);
      }
    }
    const title = document.title;
    const selector = document.querySelector("#language");
    let revision = 0;
    let pendingSaves = 0;
    function apply(value) {
      applyAppLanguage(value);
      document.documentElement.lang = getAppLanguage();
      selector.value = getAppLanguage();
      document.title = posText(title);
      for (const [node, source] of originals) {
        const core = source.trim();
        node.textContent = source.replace(core, posText(core));
      }
      for (const [node, key, source] of attributes)
        node.setAttribute(key, posText(source));
      window.dispatchEvent(new Event("pos-language-changed"));
    }
    apply(new URLSearchParams(location.search).get("language"));
    const start = revision;
    void window.bmsDesktop
      .getLanguage?.()
      ?.then((value) => {
        if (revision === start) apply(value);
      })
      .catch(() => undefined);
    window.bmsDesktop.onLanguageChanged?.((value) => {
      if (pendingSaves) return;
      revision += 1;
      document.querySelector("#language-status").textContent = "";
      apply(value);
    });
    selector.addEventListener("change", async () => {
      const selectedRevision = ++revision;
      document.querySelector("#language-status").textContent = "";
      apply(selector.value);
      pendingSaves += 1;
      try {
        const result = await window.bmsDesktop.setLanguage(getAppLanguage());
        if (!result?.ok) throw new Error("save failed");
      } catch {
        if (revision !== selectedRevision) return;
        document.querySelector("#language-status").textContent =
          getAppLanguage() === "en"
            ? "Language changed for this session; could not save preference."
            : "เปลี่ยนภาษาในรอบนี้แล้ว แต่บันทึกภาษาไม่สำเร็จ";
      } finally {
        pendingSaves -= 1;
      }
    });
  };
})();
