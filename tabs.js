// =====================================================
// tabs.js
// Tabs del planner
// - Sin localStorage
// - Siempre inicia en "main"
// - Tabs admin solo si la URL trae ?admin, ?admin=1 o #admin
// - Accesible con teclado
// =====================================================

(() => {
  const ADMIN_TABS = ["totals", "kpiMonth", "kpiYear", "details"];
  const DEFAULT_TAB = "main";

  const tabButtons = Array.from(document.querySelectorAll("[data-tab]"));
  const panels = Array.from(document.querySelectorAll("[data-panel]"));

  if (!tabButtons.length || !panels.length) return;

  function normalizeValue(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function isAdminEnabled() {
    const params = new URLSearchParams(window.location.search);
    const adminParam = normalizeValue(params.get("admin"));
    const hash = normalizeValue(window.location.hash);

    if (params.has("admin")) {
      if (!adminParam) return true;
      if (["1", "true", "yes", "ok", "admin"].includes(adminParam)) return true;
    }

    if (hash.includes("admin")) return true;

    return false;
  }

  const adminMode = isAdminEnabled();

  function isAdminTab(tabKey) {
    return ADMIN_TABS.includes(tabKey);
  }

  function getButtonTabKey(button) {
    return button?.getAttribute("data-tab") || "";
  }

  function getPanelTabKey(panel) {
    return panel?.getAttribute("data-panel") || "";
  }

  function getVisibleButtons() {
    return tabButtons.filter((button) => !button.hidden);
  }

  function getVisibleTabKeys() {
    return getVisibleButtons().map(getButtonTabKey);
  }

  function getButtonByTab(tabKey) {
    return tabButtons.find((button) => getButtonTabKey(button) === tabKey) || null;
  }

  function getPanelByTab(tabKey) {
    return panels.find((panel) => getPanelTabKey(panel) === tabKey) || null;
  }

  function setElementHidden(element, shouldHide) {
    if (!element) return;

    element.hidden = shouldHide;
    element.classList.toggle("isHidden", shouldHide);
    element.setAttribute("aria-hidden", shouldHide ? "true" : "false");
  }

  function configureAdminVisibility() {
    tabButtons.forEach((button) => {
      const tabKey = getButtonTabKey(button);
      const shouldHide = isAdminTab(tabKey) && !adminMode;
      setElementHidden(button, shouldHide);
    });

    panels.forEach((panel) => {
      const tabKey = getPanelTabKey(panel);
      const shouldHide = isAdminTab(tabKey) && !adminMode;
      setElementHidden(panel, shouldHide);
    });
  }

  function updateButtonState(activeTab, focusSelected = false) {
    tabButtons.forEach((button) => {
      if (button.hidden) return;

      const isActive = getButtonTabKey(button) === activeTab;

      button.classList.toggle("isActive", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      button.setAttribute("tabindex", isActive ? "0" : "-1");

      if (isActive && focusSelected) {
        button.focus();
      }
    });
  }

  function updatePanelState(activeTab) {
    panels.forEach((panel) => {
      const tabKey = getPanelTabKey(panel);
      const shouldShow = tabKey === activeTab;

      if (panel.hidden && shouldShow) {
        panel.hidden = false;
      }

      panel.classList.toggle("isHidden", !shouldShow);
      panel.hidden = !shouldShow;
      panel.setAttribute("aria-hidden", shouldShow ? "false" : "true");
    });
  }

  function setActiveTab(tabKey, options = {}) {
    const { focusSelected = false } = options;
    const visibleTabKeys = getVisibleTabKeys();
    const safeTab = visibleTabKeys.includes(tabKey) ? tabKey : DEFAULT_TAB;

    updateButtonState(safeTab, focusSelected);
    updatePanelState(safeTab);

    document.documentElement.setAttribute("data-active-tab", safeTab);
  }

  function activateByOffset(currentButton, offset) {
    const visibleButtons = getVisibleButtons();
    const currentIndex = visibleButtons.indexOf(currentButton);

    if (currentIndex === -1 || !visibleButtons.length) return;

    let nextIndex = currentIndex + offset;

    if (nextIndex < 0) nextIndex = visibleButtons.length - 1;
    if (nextIndex >= visibleButtons.length) nextIndex = 0;

    const nextButton = visibleButtons[nextIndex];
    const nextTab = getButtonTabKey(nextButton);

    if (!nextTab) return;
    setActiveTab(nextTab, { focusSelected: true });
  }

  function bindButtonEvents() {
    tabButtons.forEach((button) => {
      if (button.hidden) return;

      button.addEventListener("click", () => {
        const tabKey = getButtonTabKey(button);
        if (!tabKey) return;
        setActiveTab(tabKey);
      });

      button.addEventListener("keydown", (event) => {
        switch (event.key) {
          case "ArrowRight":
          case "Right":
            event.preventDefault();
            activateByOffset(button, 1);
            break;

          case "ArrowLeft":
          case "Left":
            event.preventDefault();
            activateByOffset(button, -1);
            break;

          case "Home": {
            event.preventDefault();
            const firstVisible = getVisibleButtons()[0];
            if (!firstVisible) return;
            setActiveTab(getButtonTabKey(firstVisible), { focusSelected: true });
            break;
          }

          case "End": {
            event.preventDefault();
            const visibleButtons = getVisibleButtons();
            const lastVisible = visibleButtons[visibleButtons.length - 1];
            if (!lastVisible) return;
            setActiveTab(getButtonTabKey(lastVisible), { focusSelected: true });
            break;
          }

          case "Enter":
          case " ":
          case "Spacebar":
            event.preventDefault();
            button.click();
            break;

          default:
            break;
        }
      });
    });
  }

  function syncInitialState() {
    configureAdminVisibility();
    setActiveTab(DEFAULT_TAB);
  }

  syncInitialState();
  bindButtonEvents();
})();