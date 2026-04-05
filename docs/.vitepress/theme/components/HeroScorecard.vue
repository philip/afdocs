<template>
  <div class="hero-scorecard">
    <pre><code><span class="header">Agent-Friendly Docs Scorecard</span>
<span class="divider">==============================</span>

  Overall Score: <span class="score-c">72 / 100 (C)</span>

  Category Scores:
    Content Discoverability       <span class="score-c">72 / 100 (C)</span>
    Markdown Availability         <span class="score-d">60 / 100 (D)</span>
    Page Size &amp; Truncation Risk   <span class="score-f">45 / 100 (F)</span>
    Content Structure             <span class="score-b">82 / 100 (B)</span>
    URL Stability                 <span class="score-a">93 / 100 (A)</span>
    Observability                 <span class="score-c">71 / 100 (C)</span>
    Authentication                <span class="score-a">100 / 100 (A+)</span></code></pre>
  </div>
</template>

<style scoped>
.hero-scorecard {
  width: 100%;
  max-width: 440px;
  margin: 0 auto;
}

.hero-scorecard pre {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  padding: 20px 24px;
  font-size: 13px;
  line-height: 1.6;
  overflow-x: auto;
  margin: 0;
}

.hero-scorecard code {
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-1);
}

.header {
  font-weight: 700;
  color: var(--vp-c-brand-1);
}

.divider {
  color: var(--vp-c-text-3);
}

.score-a {
  color: var(--vp-c-green-1);
  font-weight: 600;
}

.score-b {
  color: var(--vp-c-green-2);
  font-weight: 600;
}

.score-c {
  color: var(--vp-c-yellow-1);
  font-weight: 600;
}

.score-d {
  color: var(--vp-c-yellow-2);
  font-weight: 600;
}

.score-f {
  color: var(--vp-c-red-1);
  font-weight: 600;
}
</style>
