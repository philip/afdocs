<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vitepress';

const route = useRoute();
const showDropdown = ref(false);
const copied = ref(false);
const containerRef = ref(null);

const markdownPath = computed(() => {
  let path = route.path.replace(/\.html$/, '');
  if (path.endsWith('/')) return path + 'index.md';
  return path + '.md';
});

const pageUrl = computed(() => {
  if (typeof window === 'undefined') return '';
  return window.location.origin + route.path.replace(/\.html$/, '');
});

const claudeUrl = computed(() => {
  if (!pageUrl.value) return '#';
  return `https://claude.ai/new?q=${encodeURIComponent(pageUrl.value)}`;
});

const chatgptUrl = computed(() => {
  if (!pageUrl.value) return '#';
  return `https://chatgpt.com/?q=${encodeURIComponent(pageUrl.value)}`;
});

function toggleDropdown() {
  showDropdown.value = !showDropdown.value;
}

async function copyPage() {
  try {
    const textPromise = fetch(markdownPath.value)
      .then(async (res) => {
        if (res.ok) {
          const content = await res.text();
          const t = content.trimStart();
          if (!t.startsWith('<!') && !t.startsWith('<html') && !t.startsWith('import ')) {
            return content;
          }
        }
        return document.querySelector('.vp-doc')?.innerText || '';
      })
      .catch(() => document.querySelector('.vp-doc')?.innerText || '')
      .then((text) => new Blob([text], { type: 'text/plain' }));

    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': textPromise })]);
  } catch {
    const text = document.querySelector('.vp-doc')?.innerText || '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  copied.value = true;
  showDropdown.value = false;
  setTimeout(() => {
    copied.value = false;
  }, 2000);
}

function onClickOutside(e) {
  if (containerRef.value && !containerRef.value.contains(e.target)) {
    showDropdown.value = false;
  }
}

function onKeyDown(e) {
  if (e.key === 'Escape') showDropdown.value = false;
}

onMounted(() => {
  document.addEventListener('click', onClickOutside);
  document.addEventListener('keydown', onKeyDown);
});

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside);
  document.removeEventListener('keydown', onKeyDown);
});
</script>

<template>
  <div class="copy-page-wrapper" data-markdown-ignore>
    <div ref="containerRef" class="copy-page-container">
      <div class="copy-page-split-button">
        <button class="copy-main-btn" @click="copyPage">
          <svg
            v-if="copied"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="check-icon"
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <svg
            v-else
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span>{{ copied ? 'Copied!' : 'Copy page' }}</span>
        </button>
        <button
          class="copy-toggle-btn"
          @click="toggleDropdown"
          :aria-expanded="showDropdown"
          aria-haspopup="true"
          aria-label="More options"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            :class="{ rotated: showDropdown }"
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      </div>

      <Transition name="dropdown">
        <div v-if="showDropdown" class="copy-dropdown" role="menu">
          <button class="dropdown-item" role="menuitem" @click="copyPage">
            <svg
              class="dropdown-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <div class="dropdown-text">
              <strong>Copy page</strong>
              <span>Copy as Markdown for LLMs</span>
            </div>
          </button>

          <a
            class="dropdown-item"
            role="menuitem"
            :href="claudeUrl"
            target="_blank"
            rel="noopener"
            @click="showDropdown = false"
          >
            <svg
              class="dropdown-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polygon
                points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
              ></polygon>
            </svg>
            <div class="dropdown-text">
              <strong>Open in Claude <span class="external-arrow">&#8599;</span></strong>
              <span>Ask questions about this page</span>
            </div>
          </a>

          <a
            class="dropdown-item"
            role="menuitem"
            :href="chatgptUrl"
            target="_blank"
            rel="noopener"
            @click="showDropdown = false"
          >
            <svg
              class="dropdown-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <div class="dropdown-text">
              <strong>Open in ChatGPT <span class="external-arrow">&#8599;</span></strong>
              <span>Ask questions about this page</span>
            </div>
          </a>

          <a
            class="dropdown-item"
            role="menuitem"
            :href="markdownPath"
            target="_blank"
            rel="noopener"
            @click="showDropdown = false"
          >
            <svg
              class="dropdown-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
            <div class="dropdown-text">
              <strong>View as Markdown <span class="external-arrow">&#8599;</span></strong>
              <span>Open raw Markdown in a new tab</span>
            </div>
          </a>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.copy-page-wrapper {
  float: right;
  position: relative;
  z-index: 10;
  margin: 4px 0 0 16px;
}

.copy-page-container {
  position: relative;
}

.copy-page-split-button {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--vp-c-bg);
}

.copy-main-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border: none;
  background: none;
  color: var(--vp-c-text-2);
  font-size: 13px;
  font-weight: 500;
  font-family: var(--vp-font-family-base);
  cursor: pointer;
  transition:
    color 0.2s,
    background-color 0.2s;
  white-space: nowrap;
}

.copy-main-btn:hover {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
}

.check-icon {
  color: #16a34a;
}

.copy-toggle-btn {
  display: inline-flex;
  align-items: center;
  padding: 5px 8px;
  border: none;
  border-left: 1px solid var(--vp-c-border);
  background: none;
  color: var(--vp-c-text-3);
  cursor: pointer;
  transition:
    color 0.2s,
    background-color 0.2s;
}

.copy-toggle-btn:hover {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
}

.copy-toggle-btn svg {
  transition: transform 0.2s;
}

.copy-toggle-btn svg.rotated {
  transform: rotate(180deg);
}

.copy-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 280px;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  box-shadow: var(--vp-shadow-3);
  padding: 6px;
  z-index: 100;
}

.dropdown-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border: none;
  background: none;
  border-radius: 8px;
  cursor: pointer;
  text-decoration: none;
  color: inherit;
  width: 100%;
  text-align: left;
  font-family: var(--vp-font-family-base);
  transition: background-color 0.15s;
}

.dropdown-item:hover {
  background: var(--vp-c-default-soft);
}

.dropdown-item:hover .dropdown-icon {
  color: var(--vp-c-text-2);
}

.dropdown-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--vp-c-text-3);
}

.dropdown-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dropdown-text strong {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.dropdown-text span {
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.external-arrow {
  font-weight: 400;
  opacity: 0.6;
}

.dropdown-enter-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.dropdown-leave-active {
  transition:
    opacity 0.1s ease,
    transform 0.1s ease;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
