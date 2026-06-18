(function () {
  "use strict";

  /**
   * Builds the FAQ accordion from the parsed JSON data.
   * @param {Array<{question: string, answer: string}>} data
   * @param {HTMLElement} container
   */
  function renderFaq(data, container) {
    const fragment = document.createDocumentFragment();

    data.forEach((item, index) => {
      const details = document.createElement("details");
      details.className = "faq__item";

      if (index === 0) {
        details.open = true;
      }

      const summary = document.createElement("summary");
      summary.className = "faq__question";
      summary.textContent = item.question;

      const answer = document.createElement("div");
      answer.className = "faq__answer";
      answer.innerHTML = item.answer;

      details.appendChild(summary);
      details.appendChild(answer);
      fragment.appendChild(details);
    });

    container.appendChild(fragment);
  }

  /**
   * Fetches FAQ data and renders the accordion.
   */
  function loadContent() {
    const container = document.getElementById("faq-accordion");
    if (!container) return;

    fetch("./data/faq.json")
      .then((response) => {
        if (!response.ok) throw new Error("FAQ data unavailable.");
        return response.json();
      })
      .then((data) => renderFaq(data, container))
      .catch(() => {
        // Silently fail — FAQ is supplementary content, not critical UI.
      });
  }

  if (document.readyState === "complete") {
    loadContent();
  } else {
    window.addEventListener("load", loadContent, { once: true });
  }
})();
